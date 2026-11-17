import { describe, expect, it } from "vitest";
import { scalar } from "../src/db.js";
import { notifyExpiring } from "../src/jobs/notify-expiring.js";
import { putSetting } from "../src/services/settings.js";
import { as, day, fakePdf, makeContract, makeUser } from "./helpers.js";

/** สัญญา vendor: เอกสารแนบหลายไฟล์ (ไฟล์ละ ≤ 5MB) + วันที่แจ้งเตือนที่กำหนดเองต่อสัญญา */
const FORM = { title: "MA Server", vendor_name: "ABC", start_date: day(0), end_date: day(200) };

const field = <T extends { field: (k: string, v: string) => T }>(req: T, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
};

/** วันนี้ + n วัน (ให้ scheduler) */
const later = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("contracts", () => {
  it("attach several documents (≤ 5MB each) on create and edit; view through the contract only", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const created = await field(admin.post("/api/v1/contracts"), FORM)
      .attach("files[]", fakePdf(5), "สัญญา.pdf")
      .attach("files[]", fakePdf(5), "ใบเสนอราคา.pdf");
    expect(created.status).toBe(201);
    const c = created.body.data;
    expect(c.files.map((f: { name: string }) => f.name)).toEqual(["สัญญา.pdf", "ใบเสนอราคา.pdf"]);
    expect(c.files[0].url).toBe(`/contracts/${c.id}/files/${c.files[0].id}`);

    const file = await admin.get(`/api/v1/contracts/${c.id}/files/${c.files[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toMatch(/^inline/);
    // ไฟล์ของสัญญาอื่น / ไม่มีสิทธิ์ดูสัญญา
    const other = await makeContract({ ...FORM, title: "Other" });
    expect((await admin.get(`/api/v1/contracts/${other}/files/${c.files[0].id}`)).status).toBe(404);
    expect((await (await as(await makeUser())).get(`/api/v1/contracts/${c.id}/files/${c.files[0].id}`)).status).toBe(403);

    // ไฟล์เกิน 5MB / ชนิดไม่รองรับ = 422 ไม่บันทึก
    const big = await field(admin.post("/api/v1/contracts"), { ...FORM, title: "Big" }).attach("files[]", fakePdf(5 * 1024 + 1), "big.pdf");
    expect(big.status).toBe(422);
    expect(Object.keys(big.body.errors)).toContain("files.0");
    expect((await field(admin.post("/api/v1/contracts"), { ...FORM, title: "Exe" }).attach("files[]", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]), "x.gif")).status).toBe(422);
    expect(Number(await scalar("SELECT COUNT(*) FROM contracts WHERE title IN ('Big', 'Exe')"))).toBe(0);

    // แก้ไข: เอาไฟล์เดิมออก 1 + เพิ่มใหม่ 1
    const edited = await field(admin.patch(`/api/v1/contracts/${c.id}`), { ...FORM, "remove_file_ids[]": String(c.files[0].id) }).attach("files[]", fakePdf(3), "ภาคผนวก.pdf");
    expect(edited.status).toBe(200);
    expect(edited.body.data.files.map((f: { name: string }) => f.name)).toEqual(["ใบเสนอราคา.pdf", "ภาคผนวก.pdf"]);
    expect((await admin.get(`/api/v1/contracts/${c.id}/files/${c.files[0].id}`)).status).toBe(404);
    // แก้แบบ JSON ไม่แตะไฟล์
    expect((await admin.patch(`/api/v1/contracts/${c.id}`).send({ notes: "x" })).body.data.files).toHaveLength(2);
    expect((await admin.get("/api/v1/contracts")).body.data.find((x: { id: number }) => x.id === c.id).files).toHaveLength(2);
  });

  it("custom reminder dates per contract: expiring tab, menu badge and scheduler use the same rule", async () => {
    await putSetting("contract_notify_days", 30, null);
    const admin = await makeUser({ role: "admin" });
    const api = await as(admin);
    const badge = async () => (await api.get("/api/v1/menu-badges")).body.data["/contracts"] ?? 0;

    // ไม่เกินวันสิ้นสุด / ไม่เกิน 10 วัน
    expect((await api.post("/api/v1/contracts").send({ ...FORM, notify_dates: [day(201)] })).body.errors).toHaveProperty("notify_dates");
    const many = await api.post("/api/v1/contracts").send({ ...FORM, notify_dates: Array.from({ length: 11 }, (_, i) => day(i + 1)) });
    expect(many.status).toBe(422);
    expect(many.body.errors.notify_dates[0]).toBe("กำหนดวันที่แจ้งเตือนได้ไม่เกิน 10 วัน");

    const res = await api.post("/api/v1/contracts").send({ ...FORM, notify_dates: [day(50), day(10), day(10)] });
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c.notify_dates).toEqual([day(10), day(50)]);
    expect(c.next_notify_date).toBe(day(10));
    expect(c.status).toBe("active");
    expect(await badge()).toBe(0);
    expect(await notifyExpiring({ dryRun: true })).toMatchObject({ items: [] });

    // ถึงวันแจ้งเตือนวันแรก (แก้เป็นวันนี้) → ใกล้หมดอายุ + ตัวเลขเมนู + แจ้งครั้งเดียว
    const today = await api.patch(`/api/v1/contracts/${c.id}`).send({ notify_dates: [day(0), day(50)] });
    expect(today.body.data.status).toBe("expiring");
    expect((await api.get("/api/v1/contracts?status=expiring")).body.data.map((x: { id: number }) => x.id)).toEqual([c.id]);
    expect((await api.get("/api/v1/contracts")).body.summary.expiring).toBe(1);
    expect(await badge()).toBe(1);
    expect((await notifyExpiring()).items.map((i) => i.title)).toEqual(["MA Server"]);
    expect((await notifyExpiring()).items).toHaveLength(0);

    // วันที่ตั้งไว้ถัดไป → แจ้งอีกครั้ง, ถึงช่วง 30 วันก่อนหมด → แจ้งอีก (ครั้งเดียว)
    expect((await notifyExpiring({ today: later(50) })).items).toHaveLength(1);
    expect((await notifyExpiring({ today: later(51) })).items).toHaveLength(0);
    expect((await notifyExpiring({ today: later(175) })).items).toHaveLength(1);
    expect((await notifyExpiring({ today: later(176) })).items).toHaveLength(0);

    // ต่ออายุ = วันแจ้งเตือนที่ผ่านแล้วถูกทิ้ง สัญญากลับเป็นใช้งานอยู่
    const renewed = await api.patch(`/api/v1/contracts/${c.id}`).send({ end_date: day(400) });
    expect(renewed.body.data.notify_dates).toEqual([day(50)]);
    expect(renewed.body.data.status).toBe("active");
    expect(await badge()).toBe(0);

    // ใส่วันที่ที่ผ่านไปแล้ว = ไม่แจ้งย้อนหลัง; ปิดแจ้งเตือน = ไม่แจ้ง; ล้างได้ด้วย null
    await api.patch(`/api/v1/contracts/${c.id}`).send({ notify_dates: [day(-3)] });
    expect((await notifyExpiring()).items).toHaveLength(0);
    await api.patch(`/api/v1/contracts/${c.id}`).send({ notify_dates: [day(0)], notify_enabled: false });
    expect((await notifyExpiring()).items).toHaveLength(0);
    expect((await api.patch(`/api/v1/contracts/${c.id}`).send({ notify_dates: null })).body.data.notify_dates).toEqual([]);
  });

  it("multipart form can send reminder dates and clear them with an empty value", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const created = await field(api.post("/api/v1/contracts"), { ...FORM, notify_enabled: "1", "notify_dates[]": day(20) });
    expect(created.status).toBe(201);
    expect(created.body.data.notify_dates).toEqual([day(20)]);
    const cleared = await field(api.patch(`/api/v1/contracts/${created.body.data.id}`), { ...FORM, notify_dates: "" });
    expect(cleared.body.data.notify_dates).toEqual([]);
  });
});
