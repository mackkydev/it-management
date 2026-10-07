import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { localToday } from "../src/lib/time.js";
import { as, day, guest, localDay, makeUser } from "./helpers.js";

describe("localToday (timezone ผู้ใช้)", () => {
  it("is the Bangkok date, not the UTC date", () => {
    // 2026-10-03 23:30 UTC = 2026-10-04 06:30 ที่ไทย
    expect(localToday("Asia/Bangkok", new Date(Date.UTC(2026, 9, 3, 23, 30)))).toBe("2026-10-04");
    expect(localToday("Asia/Bangkok", new Date(Date.UTC(2026, 9, 3, 16, 59)))).toBe("2026-10-03");
  });
});

/** บันทึก KPI + การตั้งค่าสิทธิ์การมองเห็นเมนู/ปุ่ม (ui-config) + อายุ token 12 ชม. */
describe("KPI log", () => {
  it("IT department only", async () => {
    const outsider = await as(await makeUser());
    expect((await outsider.get("/api/v1/kpi")).status).toBe(403);
    expect((await outsider.post("/api/v1/kpi").send({ work_date: day(0), details: "x" })).status).toBe(403);
  });

  it("IT staff manage their own entries; admin / IT head see everyone", async () => {
    const staff = await makeUser({ name: "Staff", is_it_staff: true });
    const other = await makeUser({ name: "Other", is_it_staff: true });
    const head = await makeUser({ name: "Head", is_it_head: true });
    const api = await as(staff);

    // "อนาคต" ตัดสินจากวันที่ตามเวลาไทย ไม่ใช่ UTC
    const bad = await api.post("/api/v1/kpi").send({ work_date: localDay(1), details: "" });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.work_date[0]).toBe("วันที่แจ้งต้องไม่เป็นวันในอนาคต");
    expect(bad.body.errors.details[0]).toBe("กรุณากรอกรายละเอียด");
    const thaiToday = await api.post("/api/v1/kpi").send({ work_date: localDay(0), details: "ช่วงเช้ามืด" });
    expect(thaiToday.status).toBe(201);
    await api.delete(`/api/v1/kpi/${thaiToday.body.data.id}`);

    const created = await api.post("/api/v1/kpi").send({ work_date: day(0), details: "ติดตั้งโปรแกรม 3 เครื่อง" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ work_date: day(0), details: "ติดตั้งโปรแกรม 3 เครื่อง", user: { id: staff.id, name: "Staff" }, can_edit: true });
    const id = created.body.data.id;
    await (await as(other)).post("/api/v1/kpi").send({ work_date: day(-1), details: "แก้เครือข่าย" });

    // ของตัวเองเท่านั้น
    const mine = await api.get("/api/v1/kpi");
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.meta.total).toBe(1);
    expect((await api.get(`/api/v1/kpi?user_id=${other.id}`)).status).toBe(403);

    // หัวหน้า IT เห็นทั้งหมด แต่แก้ของคนอื่นไม่ได้
    const headApi = await as(head);
    const all = await headApi.get("/api/v1/kpi");
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data.find((e: { id: number }) => e.id === id).can_edit).toBe(false);
    expect((await headApi.patch(`/api/v1/kpi/${id}`).send({ details: "x" })).status).toBe(403);

    // เจ้าของแก้/ลบได้
    const edited = await api.patch(`/api/v1/kpi/${id}`).send({ details: "ติดตั้งโปรแกรม 4 เครื่อง" });
    expect(edited.body.data.details).toBe("ติดตั้งโปรแกรม 4 เครื่อง");
    expect((await api.delete(`/api/v1/kpi/${id}`)).status).toBe(204);
    expect((await api.get("/api/v1/kpi")).body.data).toHaveLength(0);
  });

  it("user with KPI history cannot be deleted", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const u = await makeUser({ is_it_staff: true });
    await (await as(u)).post("/api/v1/kpi").send({ work_date: day(0), details: "งาน" });
    expect((await admin.get(`/api/v1/users/${u.id}`)).body.meta.can_delete).toBe(false);
  });
});

describe("UI permissions (ui-config)", () => {
  it("everyone can read; only admin can change; values are validated", async () => {
    const viewer = await as(await makeUser());
    const admin = await as(await makeUser({ role: "admin" }));

    expect((await viewer.get("/api/v1/ui-config")).body.data).toMatchObject({ ui_permissions: [], menu_order: [] });
    expect((await viewer.put("/api/v1/settings").send({ ui_permissions: {} })).status).toBe(403);

    const bad = await admin.put("/api/v1/settings").send({ ui_permissions: { "/vault": ["hacker"] } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors)[0]).toBe("ui_permissions./vault.0");

    const payload = {
      ui_permissions: { "/kpi": ["viewer"], "btn:tickets:print": ["viewer", "manager"] },
      menu_order: { groups: ["assets", "it-work"], items: { "it-work": ["/kpi", "/tickets/new"] } },
    };
    expect((await admin.put("/api/v1/settings").send(payload)).status).toBe(200);
    expect((await viewer.get("/api/v1/ui-config")).body.data).toMatchObject(payload);

    // คืนค่าเริ่มต้น: object ว่างเก็บเป็น [] (เหมือน Laravel)
    await admin.put("/api/v1/settings").send({ ui_permissions: {}, menu_order: {} });
    expect((await viewer.get("/api/v1/ui-config")).body.data).toMatchObject({ ui_permissions: [], menu_order: [] });
  });
});

describe("token lifetime", () => {
  it("login tokens expire after 12 hours", async () => {
    expect(config.tokenTtlMinutes).toBe(720);
    await makeUser({ email: "ttl@example.com", password: "Pass-1234" });
    const res = await guest().post("/api/v1/auth/login").send({ email: "ttl@example.com", password: "Pass-1234", device_name: "t" });
    const hours = (new Date(res.body.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
  });
});
