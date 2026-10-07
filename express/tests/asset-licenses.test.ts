import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { notifyExpiring } from "../src/jobs/notify-expiring.js";
import { decryptString } from "../src/lib/laravel-crypt.js";
import { putSetting } from "../src/services/settings.js";
import { sentMail } from "../src/services/mail.js";
import { as, day, fakePdf, makeAsset, makeUser } from "./helpers.js";

/** Software license ของสินทรัพย์ — ตรงกับ AssetLicenseTest ของ Laravel */
const software = (license: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  asset_tag: "SW-001",
  name: "Microsoft 365 Business",
  category: "SOFTWARE",
  brand: "Microsoft",
  model: "365 Business Standard",
  license,
  ...extra,
});

const yearly = { billing: "yearly", start_date: day(0), expires_at: day(364), seats: 25, vendor: "Reseller Co.", license_key: "AAAA-BBBB-CCCC" };

describe("software licenses", () => {
  it("SOFTWARE requires license data with valid dates; key is encrypted and never returned", async () => {
    const api = await as(await makeUser({ role: "manager" }), "th");

    const missing = await api.post("/api/v1/assets").send({ ...software({}), license: undefined });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.license[0]).toBe("กรุณากรอกข้อมูล license");

    const bad = await api.post("/api/v1/assets").send(software({ billing: "yearly", start_date: day(10), expires_at: day(5) }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors["license.expires_at"][0]).toBe("วันหมดอายุต้องไม่ก่อนวันเริ่มใช้งาน");
    expect((await api.post("/api/v1/assets").send(software({ billing: "custom", start_date: day(0) }))).body.errors["license.expires_at"]).toBeDefined();

    const res = await api.post("/api/v1/assets").send(software(yearly));
    expect(res.status).toBe(201);
    expect(res.body.data.license).toEqual({
      billing: "yearly", start_date: day(0), expires_at: day(364), days_left: 364, seats: 25, vendor: "Reseller Co.", notify_days_before: null, has_key: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("AAAA-BBBB-CCCC");
    const stored = await scalar<string>("SELECT license_key FROM asset_licenses");
    expect(stored).not.toContain("AAAA");
    expect(decryptString(stored!)).toBe("AAAA-BBBB-CCCC");

    // ถาวร = ไม่มีวันหมดอายุ
    const perpetual = await api.post("/api/v1/assets").send(software({ billing: "perpetual", start_date: day(0), expires_at: day(30) }, { asset_tag: "SW-002" }));
    expect(perpetual.body.data.license).toMatchObject({ billing: "perpetual", expires_at: null, days_left: null, has_key: false });

    // หมวดอื่นไม่มี license
    const hw = await api.post("/api/v1/assets").send({ asset_tag: "PC-1", name: "PC", category: "IT" });
    expect(hw.body.data.license).toBeNull();
  });

  it("update keeps the key when blank, can clear it, and switching category removes the license", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const id = (await api.post("/api/v1/assets").send(software(yearly))).body.data.id;

    const kept = await api.patch(`/api/v1/assets/${id}`).send({ license: { ...yearly, license_key: "", seats: 30 } });
    expect(kept.body.data.license).toMatchObject({ seats: 30, has_key: true });
    expect((await api.patch(`/api/v1/assets/${id}`).send({ name: "แก้ชื่อ" })).body.data.license.seats).toBe(30); // ไม่ส่ง license = คงเดิม
    expect((await api.patch(`/api/v1/assets/${id}`).send({ license: { ...yearly, license_key: "", clear_license_key: true } })).body.data.license.has_key).toBe(false);

    const moved = await api.patch(`/api/v1/assets/${id}`).send({ category: "IT" });
    expect(moved.body.data.license).toBeNull();
    expect(Number(await scalar("SELECT COUNT(*) FROM asset_licenses"))).toBe(0);
    // เปลี่ยนกลับเป็น SOFTWARE ต้องส่งข้อมูล license
    expect((await api.patch(`/api/v1/assets/${id}`).send({ category: "SOFTWARE" })).status).toBe(422);
  });

  it("license key reveal is limited to asset managers and IT", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const id = (await manager.post("/api/v1/assets").send(software(yearly))).body.data.id;

    expect((await (await as(await makeUser())).post(`/api/v1/assets/${id}/license-key`)).status).toBe(403);
    // ค่าเริ่มต้น: ยืนยันรหัสผ่านซ้ำก่อนเปิดดู (tests/secret-guard.test.ts)
    await manager.post("/api/v1/auth/reauth").send({ password: "password" });
    expect((await manager.post(`/api/v1/assets/${id}/license-key`)).body.data.license_key).toBe("AAAA-BBBB-CCCC");
    const staff = await as(await makeUser({ is_it_staff: true }));
    await staff.post("/api/v1/auth/reauth").send({ password: "password" });
    expect((await staff.post(`/api/v1/assets/${id}/license-key`)).body.data.license_key).toBe("AAAA-BBBB-CCCC");
  });

  it("license files: upload several, preview/download, validate type, delete", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const viewer = await as(await makeUser({ is_it_staff: true })); // เห็นสินทรัพย์ทั้งหมด แต่ไม่มีสิทธิ์จัดการ
    const id = (await manager.post("/api/v1/assets").send(software(yearly))).body.data.id;

    expect((await viewer.post(`/api/v1/assets/${id}/files`).attach("files[]", fakePdf(5), "a.pdf")).status).toBe(403);
    const bad = await manager.post(`/api/v1/assets/${id}/files`).attach("files[]", Buffer.from([0, 1, 2, 3, 0, 255]), "x.bin");
    expect(bad.status).toBe(422);
    expect(bad.body.errors["files.0"]).toBeDefined();

    const up = await manager
      .post(`/api/v1/assets/${id}/files`)
      .attach("files[]", fakePdf(5), "ใบอนุญาต.pdf")
      .attach("files[]", Buffer.from("LICENSE-KEY=XYZ\nexpires=2027\n"), "product.lic");
    expect(up.status).toBe(201);
    expect(up.body.data.files.map((f: { name: string; mime: string }) => [f.name, f.mime])).toEqual([
      ["ใบอนุญาต.pdf", "application/pdf"],
      ["product.lic", "text/plain"],
    ]);
    const [pdf, lic] = up.body.data.files;
    expect(pdf.url).toBe(`/assets/${id}/files/${pdf.id}`);

    // ผู้ที่ดูสินทรัพย์ได้ เปิดไฟล์ได้: pdf/ข้อความแสดงในเบราว์เซอร์, ?download=1 ดาวน์โหลด
    const view = await viewer.get(`/api/v1/assets/${id}/files/${pdf.id}`);
    expect(view.status).toBe(200);
    expect(view.headers["content-disposition"]).toMatch(/^inline;/);
    expect(view.headers["content-disposition"]).toContain(`filename*=utf-8''${encodeURIComponent("ใบอนุญาต.pdf")}`);
    expect((await viewer.get(`/api/v1/assets/${id}/files/${lic.id}?download=1`)).headers["content-disposition"]).toMatch(/^attachment;/);
    expect((await viewer.get(`/api/v1/assets/${id}/files/999`)).status).toBe(404);

    expect((await viewer.delete(`/api/v1/assets/${id}/files/${pdf.id}`)).status).toBe(403);
    expect((await manager.delete(`/api/v1/assets/${id}/files/${pdf.id}`)).status).toBe(204);
    expect((await manager.get(`/api/v1/assets/${id}`)).body.data.files).toHaveLength(1);
  });

  it("brand/model suggestions are distinct and models filter by brand", async () => {
    await makeAsset({ brand: "Dell", model: "Latitude 5440" });
    await makeAsset({ brand: "dell ", model: "OptiPlex 7010" });
    await makeAsset({ brand: "HP", model: "EliteBook 840" });
    const api = await as(await makeUser());

    expect((await api.get("/api/v1/assets/suggestions?field=brand")).body.data).toEqual(["Dell", "HP"]);
    expect((await api.get("/api/v1/assets/suggestions?field=brand&q=de")).body.data).toEqual(["Dell"]);
    expect((await api.get("/api/v1/assets/suggestions?field=model&brand=DELL")).body.data).toEqual(["Latitude 5440", "OptiPlex 7010"]);
    expect((await api.get("/api/v1/assets/suggestions?field=serial_number")).status).toBe(422);
  });

  it("expiring licenses are included in the digest once", async () => {
    await makeUser({ is_it_staff: true });
    await putSetting("notify_emails", ["it@example.com"], null);
    const manager = await as(await makeUser({ role: "manager" }));
    await manager.post("/api/v1/assets").send(software({ billing: "custom", start_date: day(-300), expires_at: day(10) }));
    await manager.post("/api/v1/assets").send(software({ billing: "yearly", start_date: day(0), expires_at: day(200) }, { asset_tag: "SW-FAR" }));
    await manager.post("/api/v1/assets").send(software({ billing: "custom", start_date: day(0), expires_at: day(50), notify_days_before: 60 }, { asset_tag: "SW-CUSTOM" }));

    const res = await notifyExpiring();
    expect(res.items.map((i) => [i.type, i.sub])).toEqual([
      ["license", "SW-001"],
      ["license", "SW-CUSTOM"],
    ]);
    // อีเมลแสดงวันที่ dd/MM/yyyy (ไทย = พ.ศ.)
    const [y, m, d] = day(10).split("-");
    expect(sentMail[0].text).toContain(`${d}/${m}/${Number(y) + 543}`);
    expect((await notifyExpiring()).items).toHaveLength(0);
    expect(await first("SELECT notified_for_expires_at FROM asset_licenses WHERE notified_for_expires_at IS NULL AND expires_at IS NOT NULL")).toBeTruthy(); // SW-FAR ยังไม่แจ้ง
  });
});
