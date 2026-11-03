import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { notifyExpiring } from "../src/jobs/notify-expiring.js";
import { decryptString } from "../src/lib/laravel-crypt.js";
import { putSetting } from "../src/services/settings.js";
import { sentMail } from "../src/services/mail.js";
import { as, day, fakePdf, makeAsset, makeUser } from "./helpers.js";

/** License ซอฟต์แวร์ (ตาราง licenses) */
const software = (license: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  license_no: "SW-001",
  name: "Microsoft 365 Business",
  brand: "Microsoft",
  model: "365 Business Standard",
  license,
  ...extra,
});

const yearly = { billing: "yearly", start_date: day(0), expires_at: day(364), seats: 25, vendor: "Reseller Co.", license_key: "AAAA-BBBB-CCCC" };

describe("software licenses", () => {
  it("a license requires its terms with valid dates; key is encrypted and never returned", async () => {
    const api = await as(await makeUser({ role: "manager" }), "th");

    const missing = await api.post("/api/v1/licenses").send({ ...software({}), license: undefined });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.license[0]).toBe("กรุณากรอกข้อมูล license");

    const bad = await api.post("/api/v1/licenses").send(software({ billing: "yearly", start_date: day(10), expires_at: day(5) }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors["license.expires_at"][0]).toBe("วันหมดอายุต้องไม่ก่อนวันเริ่มใช้งาน");
    expect((await api.post("/api/v1/licenses").send(software({ billing: "custom", start_date: day(0) }))).body.errors["license.expires_at"]).toBeDefined();

    const res = await api.post("/api/v1/licenses").send(software(yearly));
    expect(res.status).toBe(201);
    expect(res.body.data.license).toEqual({
      billing: "yearly", start_date: day(0), expires_at: day(364), days_left: 364, seats: 25, vendor: "Reseller Co.", notify_days_before: null, software_type: "other", cancelled_at: null, cancel_reason: null, expiring: false, has_key: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("AAAA-BBBB-CCCC");
    const stored = await scalar<string>("SELECT license_key FROM licenses");
    expect(stored).not.toContain("AAAA");
    expect(decryptString(stored!)).toBe("AAAA-BBBB-CCCC");

    // ถาวร = ไม่มีวันหมดอายุ
    const perpetual = await api.post("/api/v1/licenses").send(software({ billing: "perpetual", start_date: day(0), expires_at: day(30) }, { license_no: "SW-002" }));
    expect(perpetual.body.data.license).toMatchObject({ billing: "perpetual", expires_at: null, days_left: null, has_key: false });

    // เพิ่มผ่าน /assets ไม่ได้แล้ว
    const old = await api.post("/api/v1/assets").send({ asset_tag: "SW-9", name: "x", category: "SOFTWARE" });
    expect(old.body.errors.category[0]).toBe("License ซอฟต์แวร์เพิ่มได้ที่เมนู ซอฟต์แวร์ License");
  });

  it("update keeps the key when blank and can clear it", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const id = (await api.post("/api/v1/licenses").send(software(yearly))).body.data.id;

    const kept = await api.patch(`/api/v1/licenses/${id}`).send({ license: { ...yearly, license_key: "", seats: 30 } });
    expect(kept.body.data.license).toMatchObject({ seats: 30, has_key: true });
    expect((await api.patch(`/api/v1/licenses/${id}`).send({ name: "แก้ชื่อ" })).body.data.license.seats).toBe(30); // ไม่ส่ง license = คงเดิม
    expect((await api.patch(`/api/v1/licenses/${id}`).send({ license: { ...yearly, license_key: "", clear_license_key: true } })).body.data.license.has_key).toBe(false);

  });

  it("license key reveal is limited to asset managers and IT", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const id = (await manager.post("/api/v1/licenses").send(software(yearly))).body.data.id;

    expect((await (await as(await makeUser())).post(`/api/v1/licenses/${id}/license-key`)).status).toBe(403);
    // ค่าเริ่มต้น: ยืนยันรหัสผ่านซ้ำก่อนเปิดดู (tests/secret-guard.test.ts)
    await manager.post("/api/v1/auth/reauth").send({ password: "password" });
    expect((await manager.post(`/api/v1/licenses/${id}/license-key`)).body.data.license_key).toBe("AAAA-BBBB-CCCC");
    const staff = await as(await makeUser({ is_it_staff: true }));
    await staff.post("/api/v1/auth/reauth").send({ password: "password" });
    expect((await staff.post(`/api/v1/licenses/${id}/license-key`)).body.data.license_key).toBe("AAAA-BBBB-CCCC");
  });

  it("license files: upload several, preview/download, validate type, delete", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const viewer = await as(await makeUser({ is_it_staff: true })); // เห็นสินทรัพย์ทั้งหมด แต่ไม่มีสิทธิ์จัดการ
    const id = (await manager.post("/api/v1/licenses").send(software(yearly))).body.data.id;

    expect((await viewer.post(`/api/v1/licenses/${id}/files`).attach("files[]", fakePdf(5), "a.pdf")).status).toBe(403);
    const bad = await manager.post(`/api/v1/licenses/${id}/files`).attach("files[]", Buffer.from([0, 1, 2, 3, 0, 255]), "x.bin");
    expect(bad.status).toBe(422);
    expect(bad.body.errors["files.0"]).toBeDefined();

    const up = await manager
      .post(`/api/v1/licenses/${id}/files`)
      .attach("files[]", fakePdf(5), "ใบอนุญาต.pdf")
      .attach("files[]", Buffer.from("LICENSE-KEY=XYZ\nexpires=2027\n"), "product.lic");
    expect(up.status).toBe(201);
    expect(up.body.data.files.map((f: { name: string; mime: string }) => [f.name, f.mime])).toEqual([
      ["ใบอนุญาต.pdf", "application/pdf"],
      ["product.lic", "text/plain"],
    ]);
    const [pdf, lic] = up.body.data.files;
    expect(pdf.url).toBe(`/licenses/${id}/files/${pdf.id}`);

    // ผู้ที่ดูสินทรัพย์ได้ เปิดไฟล์ได้: pdf/ข้อความแสดงในเบราว์เซอร์, ?download=1 ดาวน์โหลด
    const view = await viewer.get(`/api/v1/licenses/${id}/files/${pdf.id}`);
    expect(view.status).toBe(200);
    expect(view.headers["content-disposition"]).toMatch(/^inline;/);
    expect(view.headers["content-disposition"]).toContain(`filename*=utf-8''${encodeURIComponent("ใบอนุญาต.pdf")}`);
    expect((await viewer.get(`/api/v1/licenses/${id}/files/${lic.id}?download=1`)).headers["content-disposition"]).toMatch(/^attachment;/);
    expect((await viewer.get(`/api/v1/licenses/${id}/files/999`)).status).toBe(404);

    expect((await viewer.delete(`/api/v1/licenses/${id}/files/${pdf.id}`)).status).toBe(403);
    expect((await manager.delete(`/api/v1/licenses/${id}/files/${pdf.id}`)).status).toBe(204);
    expect((await manager.get(`/api/v1/licenses/${id}`)).body.data.files).toHaveLength(1);
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
    await manager.post("/api/v1/licenses").send(software({ billing: "custom", start_date: day(-300), expires_at: day(10) }));
    await manager.post("/api/v1/licenses").send(software({ billing: "yearly", start_date: day(0), expires_at: day(200) }, { license_no: "SW-FAR" }));
    await manager.post("/api/v1/licenses").send(software({ billing: "custom", start_date: day(0), expires_at: day(50), notify_days_before: 60 }, { license_no: "SW-CUSTOM" }));

    const res = await notifyExpiring();
    expect(res.items.map((i) => [i.type, i.sub])).toEqual([
      ["license", "SW-001"],
      ["license", "SW-CUSTOM"],
    ]);
    // อีเมลแสดงวันที่ dd/MM/yyyy (ไทย = พ.ศ.)
    const [y, m, d] = day(10).split("-");
    expect(sentMail[0].text).toContain(`${d}/${m}/${Number(y) + 543}`);
    expect((await notifyExpiring()).items).toHaveLength(0);
    expect(await first("SELECT notified_for_expires_at FROM licenses WHERE notified_for_expires_at IS NULL AND expires_at IS NOT NULL")).toBeTruthy(); // SW-FAR ยังไม่แจ้ง
  });

  it("license icon: upload replaces the old one, is not an attachment, delete", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const viewer = await as(await makeUser()); // ผู้ใช้ทั่วไป — ไม่เห็นสินทรัพย์
    const id = (await manager.post("/api/v1/licenses").send(software(yearly))).body.data.id;
    const png = await sharp({ create: { width: 600, height: 400, channels: 4, background: "#3366ff" } }).png().toBuffer();

    expect((await viewer.put(`/api/v1/licenses/${id}/icon`).attach("icon", png, "a.png")).status).toBe(403);
    expect((await manager.put(`/api/v1/licenses/${id}/icon`).attach("icon", fakePdf(5), "a.pdf")).status).toBe(422);
    const first = await manager.put(`/api/v1/licenses/${id}/icon`).attach("icon", png, "logo.png");
    expect(first.status).toBe(200);
    const second = await manager.put(`/api/v1/licenses/${id}/icon`).attach("icon", png, "logo2.png");
    expect(second.body.data.icon_id).not.toBe(first.body.data.icon_id);
    expect(Number(await scalar("SELECT COUNT(*) FROM license_files WHERE kind = 'icon'"))).toBe(1);

    const detail = (await manager.get(`/api/v1/licenses/${id}`)).body.data;
    expect(detail.icon_id).toBe(second.body.data.icon_id);
    expect(detail.files).toEqual([]);
    const list = (await manager.get("/api/v1/licenses")).body.data[0];
    expect(list).toMatchObject({ icon_id: second.body.data.icon_id, files_count: 0 });

    const img = await manager.get(`/api/v1/licenses/${id}/icon`).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect((await sharp(img.body as Buffer).metadata()).width).toBe(256);
    expect((await viewer.get(`/api/v1/licenses/${id}/icon`)).status).toBe(403);
    // ไฟล์แนบลบไอคอนไม่ได้ (ต้องใช้ DELETE /icon)
    expect((await manager.delete(`/api/v1/licenses/${id}/files/${detail.icon_id}`)).status).toBe(404);

    expect((await manager.delete(`/api/v1/licenses/${id}/icon`)).status).toBe(204);
    expect((await manager.get(`/api/v1/licenses/${id}`)).body.data.icon_id).toBeNull();
    expect((await manager.get(`/api/v1/licenses/${id}/icon`)).status).toBe(404);
  });

  it("software type (Office / OS / Anti Virus / other) is saved, defaults to other and filters form options", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const office = await manager.post("/api/v1/licenses").send(software({ ...yearly, software_type: "office" }));
    expect(office.status).toBe(201);
    expect(office.body.data.license.software_type).toBe("office");
    const plain = await manager.post("/api/v1/licenses").send(software(yearly, { license_no: "SW-002", name: "Tool" }));
    expect(plain.body.data.license.software_type).toBe("other");
    const bad = await manager.post("/api/v1/licenses").send(software({ ...yearly, software_type: "game" }, { license_no: "SW-003" }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors["license.software_type"]).toBeDefined();
    // แก้ไขโดยไม่ส่งประเภท = คงเดิม
    const id = office.body.data.id;
    await manager.patch(`/api/v1/licenses/${id}`).send({ license: { billing: "yearly", start_date: day(0), expires_at: day(364) } });
    expect((await manager.get(`/api/v1/licenses/${id}`)).body.data.license.software_type).toBe("office");

    const list = (await manager.get("/api/v1/licenses")).body.data as { name: string; software_type: string }[];
    expect(Object.fromEntries(list.map((l) => [l.name, l.software_type]))).toEqual({ "Microsoft 365 Business": "office", Tool: "other" });
    const options = (await manager.get("/api/v1/assets/software-options")).body.data as { name: string; software_type: string }[];
    expect(options.find((o) => o.name === "Tool")?.software_type).toBe("other");
  });

  it("computer spec is saved as text and offered from the computer_spec dropdown list", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    const pc = await manager.post("/api/v1/assets").send({ asset_tag: "PC-SPEC", name: "Desktop", category: "COMPUTER", computer_spec: "i5 / 16GB / SSD 512GB" });
    expect(pc.status).toBe(201);
    expect(pc.body.data.computer_spec).toBe("i5 / 16GB / SSD 512GB");
    const added = await manager.post("/api/v1/dropdown-options/computer_spec").send({ name: "i7 / 32GB / SSD 1TB" });
    expect(added.status).toBe(201);
    expect((await manager.get("/api/v1/dropdown-options/computer_spec")).body.data.map((o: { name: string }) => o.name)).toContain("i7 / 32GB / SSD 1TB");
  });

  it("manage contract: expiring licenses show in the tab and menu badge until renewed or cancelled", async () => {
    const managerUser = await makeUser({ role: "manager" });
    const manager = await as(managerUser);
    const soon = (await manager.post("/api/v1/licenses").send(software({ billing: "yearly", start_date: day(-350), expires_at: day(10), notify_days_before: 30 }, { license_no: "SW-SOON", name: "Soon" }))).body.data.id;
    const later = (await manager.post("/api/v1/licenses").send(software({ billing: "yearly", start_date: day(0), expires_at: day(300) }, { license_no: "SW-LATER", name: "Later" }))).body.data.id;
    const expiring = async () =>
      ((await manager.get("/api/v1/licenses")).body.data as { id: string; expiring: boolean }[]).filter((l) => l.expiring).map((l) => l.id);
    expect(await expiring()).toEqual([soon]);
    expect((await manager.get("/api/v1/menu-badges")).body.data["/licenses"]).toBe(1);
    expect(later).toBeTruthy();

    // ต่อสัญญา: วันหมดอายุใหม่ต้องหลังวันเดิม — วันเริ่มตั้งต้น = วันถัดจากวันหมดอายุเดิม
    expect((await manager.post(`/api/v1/licenses/${soon}/renew`).send({ expires_at: day(5) })).status).toBe(422);
    const renewed = await manager.post(`/api/v1/licenses/${soon}/renew`).send({ expires_at: day(375) });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.license).toMatchObject({ start_date: day(11), expires_at: day(375), cancelled_at: null });
    expect(await expiring()).toEqual([]);

    // ยกเลิกสัญญา: ไม่นับเป็นกำลังจะหมดอายุแม้ถึงช่วงแจ้งเตือน
    const old = (await manager.post("/api/v1/licenses").send(software({ billing: "yearly", start_date: day(-370), expires_at: day(-5) }, { license_no: "SW-OLD", name: "Old" }))).body.data.id;
    expect(await expiring()).toEqual([old]);
    const cancelled = await manager.post(`/api/v1/licenses/${old}/cancel`).send({ reason: "เลิกใช้" });
    expect(cancelled.body.data.license).toMatchObject({ cancel_reason: "เลิกใช้" });
    expect(cancelled.body.data.license.cancelled_at).not.toBeNull();
    expect(await expiring()).toEqual([]);
    expect((await manager.get("/api/v1/menu-badges")).body.data["/licenses"]).toBe(0);
    // ผู้ไม่มีสิทธิ์แก้ไขสินทรัพย์จัดการสัญญาไม่ได้
    expect((await (await as(await makeUser({ is_it_staff: true }))).post(`/api/v1/licenses/${old}/cancel`).send({})).status).toBe(403);
  });
});

describe("licenses of the same name, one per box", () => {
  it("each license lists its S/N and the machines it is installed on", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const box = (tag: string, serial: string) => software({ ...yearly, seats: 1 }, { license_no: tag, name: "Office 2021", serial_number: serial });
    const a = await api.post("/api/v1/licenses").send(box("OF-1", "SN-AAA"));
    expect(a.status).toBe(201);
    expect(a.body.data.serial_number).toBe("SN-AAA");
    expect((await api.post("/api/v1/licenses").send(box("OF-2", "SN-BBB"))).status).toBe(201);
    const pc = await makeAsset({ asset_tag: "HOST-9", name: "Desktop", category: "COMPUTER" });
    const licenseId = await scalar<number>("SELECT id FROM licenses WHERE license_no = 'OF-1'");
    await exec("INSERT INTO license_installations (license_id, device_asset_id, installed_at) VALUES (?, ?, CURDATE())", [licenseId, pc.id]);
    await exec("INSERT INTO license_installations (license_id, device_asset_id, installed_at, uninstalled_at) VALUES (?, ?, CURDATE(), CURDATE())", [await scalar<number>("SELECT id FROM licenses WHERE license_no = 'OF-2'"), pc.id]);

    const list = (await api.get("/api/v1/licenses")).body.data as { license_no: string; serial_number: string; devices: unknown[] }[];
    const one = list.find((l) => l.license_no === "OF-1")!;
    expect(one.serial_number).toBe("SN-AAA");
    expect(one.devices).toEqual([{ id: pc.uuid, asset_tag: "HOST-9", name: "Desktop" }]);
    // ถอนการติดตั้งแล้วไม่แสดง
    expect(list.find((l) => l.license_no === "OF-2")!.devices).toEqual([]);
  });
});

describe("license fields", () => {
  it("the number is optional but unique; status is limited; a license is not an asset", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const plain = software(yearly, { license_no: undefined });
    const a = await api.post("/api/v1/licenses").send(plain);
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ license_no: null, status: "active" });
    expect((await api.post("/api/v1/licenses").send({ ...plain, license_no: "" })).body.data.license_no).toBeNull();
    const numbered = await api.post("/api/v1/licenses").send(software(yearly, { license_no: "LIC-1" }));
    expect(numbered.status).toBe(201);
    expect((await api.post("/api/v1/licenses").send(software(yearly, { license_no: "LIC-1" }))).body.errors.license_no).toBeTruthy();
    // แก้ไขโดยเลขเดิม ไม่ถูกกัน
    expect((await api.patch(`/api/v1/licenses/${numbered.body.data.id}`).send({ license_no: "LIC-1", status: "inactive" })).body.data.status).toBe("inactive");
    for (const status of ["lost", "disposed", "active"]) {
      expect((await api.patch(`/api/v1/licenses/${numbered.body.data.id}`).send({ status })).status).toBe(200);
    }
    for (const status of ["in_storage", "in_repair"]) {
      expect((await api.patch(`/api/v1/licenses/${numbered.body.data.id}`).send({ status })).body.errors.status).toBeTruthy();
    }
    // ไม่ปนกับตารางสินทรัพย์
    expect((await api.get("/api/v1/assets")).body.data).toEqual([]);
    expect((await api.get(`/api/v1/assets/${numbered.body.data.id}`)).status).toBe(404);
    // ลบ = ซ่อน
    expect((await api.get(`/api/v1/licenses/${a.body.data.id}`)).status).toBe(200);
    const admin = await as(await makeUser({ role: "super_admin" }));
    expect((await admin.delete(`/api/v1/licenses/${a.body.data.id}`)).status).toBe(204);
    expect((await api.get(`/api/v1/licenses/${a.body.data.id}`)).status).toBe(404);
    expect(await scalar("SELECT deleted_at FROM licenses WHERE uuid = ?", [a.body.data.id])).not.toBeNull();
  });
});
