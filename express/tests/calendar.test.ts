import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { holidayCalendarFor } from "../src/services/calendar.js";
import { as, guest, makeBranch, makeUser } from "./helpers.js";

/** วันจันทร์ถัดไปที่อยู่ในอนาคตอย่างน้อย 7 วัน (เลี่ยงวันหยุดสุดสัปดาห์ในเทสต์) */
function nextMonday(weeks = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["วันที่", "ชื่อวันหยุด"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ไฟล์ Excel จากแถวทั้งหมด (รวมหัวตาราง) */
async function xlsxRows(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("leave requests", () => {
  it("request → approver notified → approve → shows on the calendar; working days skip weekends and company holidays", async () => {
    const boss = await makeUser({ role: "manager", name: "หัวหน้า" });
    const staff = await makeUser({ name: "พนักงาน", supervisor_id: boss.id });
    const mon = nextMonday();
    await insert("company_holidays", { calendar_id: await holidayCalendarFor(null), date: plus(mon, 2), name: "วันหยุดทดสอบ", created_at: nowDb(), updated_at: nowDb() });
    const api = await as(staff, "th");

    const opts = (await api.get("/api/v1/leave/options")).body.data;
    expect(opts.default_approver_id).toBe(boss.id);
    expect(opts.approvers.map((a: { id: number }) => a.id)).toContain(boss.id);

    // จันทร์–อาทิตย์ถัดไป: 7 วัน − เสาร์อาทิตย์ − วันหยุดพุธ = 4 วันทำงาน
    const res = await api.post("/api/v1/leave").send({ leave_type: "vacation", unit: "full", start_on: mon, end_on: plus(mon, 6), reason: "พักผ่อน", approver_id: boss.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ days: 4, status: "pending", approver: { id: boss.id } });
    const id = res.body.data.id;
    expect(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = 'leave.submitted'", [boss.id])).toBe(1);

    // ซ้อนช่วงเดิม = ไม่ได้
    expect((await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "half_am", start_on: plus(mon, 1), approver_id: boss.id })).status).toBe(422);
    // คนอื่น (ไม่ใช่ผู้อนุมัติ) อนุมัติไม่ได้ / ผู้ลาอนุมัติตัวเองไม่ได้
    expect((await (await as(await makeUser({ role: "manager" }))).post(`/api/v1/leave/${id}/approve`)).status).toBe(404);
    expect((await api.post(`/api/v1/leave/${id}/approve`)).status).toBe(403);

    const bossApi = await as(boss, "th");
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/leave/approvals"]).toBe(1);
    expect((await bossApi.post(`/api/v1/leave/${id}/reject`).send({})).status).toBe(422); // ไม่อนุมัติต้องมีเหตุผล
    const ok = await bossApi.post(`/api/v1/leave/${id}/approve`).send({ note: "ได้" });
    expect(ok.body.data.status).toBe("approved");
    expect(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = 'leave.approved'", [staff.id])).toBe(1);

    const cal = (await api.get(`/api/v1/calendar?from=${mon}&to=${plus(mon, 6)}`)).body.data;
    expect(cal.map((i: { kind: string }) => i.kind).sort()).toEqual(["holiday", "leave"]);

    // ยกเลิกได้ก่อนวันเริ่ม
    expect((await api.post(`/api/v1/leave/${id}/cancel`)).body.data.status).toBe("cancelled");
  });

  it("approvers = higher roles in the same department or division; none → the approval route (supervisor)", async () => {
    const now = nowDb();
    const divId = await insert("divisions", { name: "ฝ่ายการเงิน", is_active: true, sort_order: 0, created_at: now, updated_at: now });
    await insert("departments", { name: "บัญชีลูกหนี้", division_id: divId, is_active: true, sort_order: 0, created_at: now, updated_at: now });
    await insert("departments", { name: "บัญชีเจ้าหนี้", division_id: divId, is_active: true, sort_order: 0, created_at: now, updated_at: now });
    const supervisor = await makeUser({ role: "manager", department: "ขาย" });
    const staff = await makeUser({ department: "บัญชีลูกหนี้", supervisor_id: supervisor.id });
    const deptHead = await makeUser({ role: "manager", department: "บัญชีลูกหนี้" });
    const divHead = await makeUser({ role: "division_manager", department: "บัญชีเจ้าหนี้" }); // แผนกอื่นในฝ่ายเดียวกัน
    const byText = await makeUser({ role: "admin", division: "ฝ่ายการเงิน" });
    await makeUser({ department: "บัญชีลูกหนี้" }); // ตำแหน่งเท่ากัน
    await makeUser({ role: "manager", department: "ขาย" }); // ต่างแผนก/ฝ่าย

    const opts = (await (await as(staff)).get("/api/v1/leave/options")).body.data;
    expect(opts.approver_source).toBe("org");
    expect(opts.approvers.map((a: { id: number }) => a.id).sort()).toEqual([deptHead.id, divHead.id, byText.id].sort());
    expect(opts.default_approver_id).toBe(opts.approvers[0].id); // หัวหน้าตามสายไม่อยู่ในแผนก/ฝ่าย → คนแรก
    const api = await as(staff);
    const mon = nextMonday(3);
    expect((await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "full", start_on: mon, end_on: mon, approver_id: supervisor.id })).status).toBe(422);

    // ไม่มีผู้ที่ตำแหน่งสูงกว่าในแผนก/ฝ่าย → ตามสายอนุมัติ (ระบบเดิม = หัวหน้าตามสาย)
    const loner = await makeUser({ department: "แผนกเดี่ยว", supervisor_id: supervisor.id });
    const fallback = (await (await as(loner)).get("/api/v1/leave/options")).body.data;
    expect(fallback).toMatchObject({ approver_source: "route", approvers: [{ id: supervisor.id }], default_approver_id: supervisor.id });
  });

  it("half day / hours, quota and medical certificate rules", async () => {
    const boss = await makeUser({ role: "manager" });
    const staff = await makeUser({ supervisor_id: boss.id });
    const api = await as(staff, "th");
    const mon = nextMonday(2);
    // เหตุผลบังคับกรอก (ช่องว่างล้วนก็ไม่ผ่าน)
    const noReason = await api.post("/api/v1/leave").send({ reason: "   ", leave_type: "personal", unit: "hours", start_on: mon, start_time: "13:00", end_time: "15:00", approver_id: boss.id });
    expect(noReason.status).toBe(422);
    expect(noReason.body.errors.reason).toBeTruthy();
    const hours = await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "hours", start_on: mon, start_time: "13:00", end_time: "15:00", approver_id: boss.id });
    expect(hours.body.data).toMatchObject({ days: 0.25, end_on: mon });
    expect((await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "half_pm", start_on: mon, approver_id: boss.id })).status).toBe(422); // ทับเวลาบ่าย
    expect((await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "half_am", start_on: mon, approver_id: boss.id })).status).toBe(201);

    // ลาป่วย ≥ 3 วัน ต้องแนบใบรับรองแพทย์
    const sick = await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "sick", unit: "full", start_on: plus(mon, 7), end_on: plus(mon, 9), approver_id: boss.id });
    expect(sick.status).toBe(422);
    expect(sick.body.errors).toHaveProperty("files");

    // โควตารายคน: ลาพักร้อนได้ 1 วัน
    const admin = await as(await makeUser({ role: "admin" }));
    await admin.put("/api/v1/leave/quotas").send({ user_id: staff.id, year: Number(mon.slice(0, 4)), leave_type: "vacation", days: 1 });
    const over = await api.post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "vacation", unit: "full", start_on: plus(mon, 14), end_on: plus(mon, 15), approver_id: boss.id });
    expect(over.body.errors.leave_type[0]).toContain("คงเหลือ 1");
  });
});

describe("calendar scope by permission group", () => {
  it("department by default, branch / all when the super admin sets it for the group", async () => {
    const b1 = await makeBranch();
    const b2 = await makeBranch();
    const boss = await makeUser({ role: "manager", branch_id: b1 });
    const me = await makeUser({ department: "บัญชี", branch_id: b1, supervisor_id: boss.id });
    const sameDept = await makeUser({ department: "บัญชี", branch_id: b2, supervisor_id: boss.id });
    const sameBranch = await makeUser({ department: "ขาย", branch_id: b1, supervisor_id: boss.id });
    const mon = nextMonday(3);
    for (const u of [sameDept, sameBranch]) {
      const id = await insert("leave_requests", { uuid: crypto.randomUUID(), user_id: u.id, leave_type: "personal", unit: "full", start_on: mon, end_on: mon, days: 1, approver_id: boss.id, status: "approved", created_at: nowDb() });
      expect(id).toBeGreaterThan(0);
    }
    const names = async () => ((await (await as(me)).get(`/api/v1/calendar?from=${mon}&to=${mon}`)).body.data as { user: { id: number } }[]).map((i) => i.user.id).sort();
    expect(await names()).toEqual([sameDept.id]);

    const root = await as(await makeUser({ role: "super_admin" }));
    expect((await (await as(boss)).put("/api/v1/calendar/scope").send({ scopes: { viewer: "all" } })).status).toBe(403);
    await root.put("/api/v1/calendar/scope").send({ scopes: { viewer: "branch" }, leave_scopes: { viewer: "branch" } });
    expect(await names()).toEqual([sameBranch.id]);
    await root.put("/api/v1/calendar/scope").send({ scopes: { viewer: "all" }, leave_scopes: { viewer: "all" } });
    expect(await names()).toEqual([sameDept.id, sameBranch.id].sort());
    // ขอบเขตแคบกว่าสิทธิ์เลือกได้
    expect((await (await as(me)).get(`/api/v1/calendar?from=${mon}&to=${mon}&scope=department`)).body.meta.scope).toBe("department");

    // การลาตั้งแยกจากปฏิทิน: ปฏิทิน "ทั้งหมด" แต่การลา "เฉพาะตัวเอง" → ไม่เห็นวันลาของคนอื่น แต่ยังเห็นกิจกรรมของคนอื่น
    await insert("calendar_events", { type: "event", user_id: sameBranch.id, title: "ประชุม", start_on: mon, end_on: mon, created_by: sameBranch.id, created_at: nowDb(), updated_at: nowDb() });
    const saved = await root.put("/api/v1/calendar/scope").send({ leave_scopes: { viewer: "self" } });
    expect(saved.body.data).toEqual({ calendar: { viewer: "all" }, leave: { viewer: "self" } });
    const items = (await (await as(me)).get(`/api/v1/calendar?from=${mon}&to=${mon}`)).body.data as { kind: string; user: { id: number } }[];
    expect(items.filter((i) => i.kind === "leave")).toEqual([]);
    expect(items.some((i) => i.kind === "event" && i.user.id === sameBranch.id)).toBe(true);
    // ปฏิทิน "เฉพาะตัวเอง" เลือกได้
    await root.put("/api/v1/calendar/scope").send({ scopes: { viewer: "self" } });
    expect((await (await as(me)).get("/api/v1/calendar/meta")).body.data).toMatchObject({ max_scope: "self", scopes: ["self"] });
    expect((await (await as(me)).get(`/api/v1/calendar?from=${mon}&to=${mon}`)).body.data.filter((i: { kind: string }) => i.kind !== "holiday")).toEqual([]);
    expect((await root.put("/api/v1/calendar/scope").send({ leave_scopes: { viewer: "nope" } })).status).toBe(422);
    await exec("DELETE FROM app_settings WHERE \"key\" IN ('calendar_scope', 'leave_scope')");
  });
});

describe("calendar events", () => {
  it("an event across a weekend can skip Saturday/Sunday: the calendar shows weekday bars only (same event id / full range)", async () => {
    const api = await as(await makeUser(), "th");
    const mon = nextMonday();
    const fri = plus(mon, 4);
    const tue = plus(mon, 8);
    const created = await api.post("/api/v1/calendar/events").send({ title: "อบรม", start_on: fri, end_on: tue, skip_weekends: true });
    expect(created.status).toBe(201);
    const bars = (await api.get(`/api/v1/calendar?from=${mon}&to=${plus(mon, 13)}`)).body.data.filter((i: { kind: string }) => i.kind === "event");
    expect(bars.map((b: { start: string; end: string }) => [b.start, b.end])).toEqual([
      [fri, fri],
      [plus(mon, 7), tue],
    ]);
    expect(bars.every((b: { event_id: number; range: { start: string; end: string } }) => b.event_id === created.body.data.id && b.range.start === fri && b.range.end === tue)).toBe(true);

    // เสาร์-อาทิตย์ล้วน + ไม่รวมเสาร์-อาทิตย์ = ไม่มีวันให้แสดง
    expect((await api.post("/api/v1/calendar/events").send({ title: "x", start_on: plus(mon, 5), end_on: plus(mon, 6), skip_weekends: true })).status).toBe(422);
    // ช่วงที่ไม่คร่อมสุดสัปดาห์ = ไม่ต้องแยก (เก็บเป็น false)
    const plain = await api.post("/api/v1/calendar/events").send({ title: "ประชุม", start_on: mon, end_on: plus(mon, 1), skip_weekends: true });
    expect(Boolean(await scalar("SELECT skip_weekends FROM calendar_events WHERE id = ?", [plain.body.data.id]))).toBe(false);
  });
});

describe("company holidays", () => {
  it("admins add / import from Excel (Buddhist years, duplicates update, bad rows block); others cannot", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    expect((await (await as(await makeUser())).post("/api/v1/holidays").send({ date: "2031-01-01", name: "x" })).status).toBe(403);
    expect((await admin.post("/api/v1/holidays").send({ date: "2031-01-01", name: "วันขึ้นปีใหม่" })).status).toBe(201);
    expect((await admin.post("/api/v1/holidays").send({ date: "2031-01-01", name: "ซ้ำ" })).status).toBe(422);

    const bad = await admin.post("/api/v1/holidays/import").attach("file", await xlsx([["13/04/2574", "สงกรานต์"], ["99/99/2574", "ผิด"]]), "h.xlsx");
    expect(bad.status).toBe(422);
    expect(await scalar("SELECT COUNT(*) FROM company_holidays WHERE YEAR(date) = 2031")).toBe(1);

    const good = await admin.post("/api/v1/holidays/import").attach("file", await xlsx([["01/01/2574", "ปีใหม่ (แก้ชื่อ)"], ["13/04/2574", "สงกรานต์"], [new Date(Date.UTC(2031, 11, 31)), "สิ้นปี"]]), "h.xlsx");
    expect(good.body.data).toEqual({ created: 2, updated: 1 });
    expect(await scalar("SELECT name FROM company_holidays WHERE date = '2031-01-01'")).toBe("ปีใหม่ (แก้ชื่อ)");

    expect((await admin.post("/api/v1/holidays/copy-year").send({ from: 2031, to: 2032 })).body.data.created).toBe(3);
  });

  it("separate holiday calendars (head office / factories): each branch uses one; import picks the calendar per row", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const bkk = await makeBranch({ code: "BKK", name: "กรุงเทพ" });
    const srb = await makeBranch({ code: "SRB", name: "สระบุรี" });
    const factory = (await admin.post("/api/v1/holiday-calendars").send({ name: "สำนักงานโรงงาน", is_default: true })).body.data;
    const hq = await admin.post("/api/v1/holiday-calendars").send({ name: "สำนักงานใหญ่", branch_ids: [bkk] });
    expect(hq.status).toBe(201);
    expect(hq.body.data.branches.map((b: { code: string }) => b.code)).toEqual(["BKK"]);
    const cals = (await admin.get("/api/v1/holiday-calendars")).body.data as { name: string; is_default: boolean; branches: { code: string }[] }[];
    expect(cals.find((c) => c.name === "สำนักงานโรงงาน")?.branches.map((b) => b.code)).toContain("SRB"); // ไม่เลือก = ชุดตั้งต้น

    // ไฟล์เดียว 2 ชุด: 5 ธ.ค. โรงงาน / 7 ธ.ค. ชดเชย สำนักงานใหญ่ — วันเดียวกันต่างชุดได้
    const file = await xlsxRows([
      ["วันที่", "ชื่อวันหยุด", "ปฏิทินวันหยุด"],
      ["01/01/2569", "วันขึ้นปีใหม่", "สำนักงานใหญ่"],
      ["01/01/2569", "วันขึ้นปีใหม่", "สำนักงานโรงงาน"],
      ["05/12/2569", "วันพ่อแห่งชาติและวันชาติ", "สำนักงานโรงงาน"],
      ["07/12/2569", "ชดเชยวันพ่อแห่งชาติและวันชาติ", "สำนักงานใหญ่"],
    ]);
    expect((await admin.post("/api/v1/holidays/import").attach("file", file, "h.xlsx")).body.data).toEqual({ created: 4, updated: 0 });
    const unknown = await admin.post("/api/v1/holidays/import").attach("file", await xlsxRows([["วันที่", "ชื่อ", "ปฏิทิน"], ["02/01/2569", "x", "ไม่มีชุดนี้"]]), "h.xlsx");
    expect(unknown.status).toBe(422);
    expect((await admin.post("/api/v1/holidays/import").attach("file", await xlsxRows([["วันที่", "ชื่อ", "ปฏิทิน"], ["02/01/2569", "x", ""]]), "h.xlsx")).status).toBe(422); // มีหลายชุด ต้องเลือก

    const list = async (calendarId: number) => (await admin.get(`/api/v1/holidays?year=2026&calendar_id=${calendarId}`)).body.data.map((h: { date: string }) => h.date);
    expect(await list(hq.body.data.id)).toEqual(["2026-01-01", "2026-12-07"]);
    expect(await list(factory.id)).toEqual(["2026-01-01", "2026-12-05"]);

    // แก้วันที่ / ชื่อภายหลังได้
    const dec5 = (await admin.get(`/api/v1/holidays?year=2026&calendar_id=${factory.id}`)).body.data.find((h: { date: string }) => h.date === "2026-12-05");
    const edited = await admin.put(`/api/v1/holidays/${dec5.id}`).send({ date: "2026-12-04", name: "วันพ่อ (เลื่อน)" });
    expect(edited.body.data).toMatchObject({ date: "2026-12-04", name: "วันพ่อ (เลื่อน)", calendar_id: factory.id });

    // วันลานับตามชุดของสาขาผู้ลา: จ. 7 ธ.ค. หยุดเฉพาะกรุงเทพ
    const bkkUser = await as(await makeUser({ branch_id: bkk }));
    const srbUser = await as(await makeUser({ branch_id: srb }));
    const days = async (api: typeof admin) => (await api.get("/api/v1/leave/preview?unit=full&start_on=2026-12-07&end_on=2026-12-07")).body.data.days;
    expect(await days(bkkUser)).toBe(0);
    expect(await days(srbUser)).toBe(1);

    // template: คอลัมน์ ปฏิทินวันหยุด + เติมวันหยุดของปีนั้น
    const tpl = await admin.get("/api/v1/holidays/import-template?year=2026").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined, "วันที่", "ชื่อวันหยุด", "ปฏิทินวันหยุด"]);
    expect([2, 3, 4, 5, 6].map((r) => Boolean(ws.getCell(`A${r}`).value))).toEqual([true, true, true, true, false]); // วันหยุดปี 2569 ที่มี 4 แถว
    expect(ws.getCell("C2").dataValidation?.type).toBe("list");

    // ลบชุดตั้งต้นไม่ได้
    expect((await admin.delete(`/api/v1/holiday-calendars/${factory.id}`)).status).toBe(422);
  });
});

describe("on-site work from tickets + KPI rows + iCal", () => {
  it("accepting with calendar dates records an on-site line; approved leave and company holidays appear in the KPI sheet", async () => {
    const it_ = await makeUser({ role: "admin", name: "ช่าง IT" });
    const requester = await makeUser();
    const now = nowDb();
    const ticket = await insert("it_tickets", {
      uuid: crypto.randomUUID(), ticket_no: "FM-T-ONSITE", type: "repair", status: "approved", requester_id: requester.id, details: "แอร์เสีย",
      requested_at: now, created_at: now, updated_at: now,
    });
    const uuid = String(await scalar("SELECT uuid FROM it_tickets WHERE id = ?", [ticket]));
    const mon = nextMonday();
    const api = await as(it_, "th");
    const res = await api.post(`/api/v1/tickets/${uuid}/accept`).send({ calendar: { start_on: mon, end_on: plus(mon, 2), note: "ไปสาขาขอนแก่น" } });
    expect(res.status).toBe(200);
    expect(res.body.data.calendar_event).toMatchObject({ start_on: mon, end_on: plus(mon, 2) });
    const cal = (await api.get(`/api/v1/calendar?from=${mon}&to=${plus(mon, 6)}`)).body.data;
    expect(cal.find((i: { kind: string }) => i.kind === "onsite")).toMatchObject({ start: mon, end: plus(mon, 2), ticket: { ticket_no: "FM-T-ONSITE" } });
    expect((await api.get(`/api/v1/calendar/busy?user_ids=${it_.id}&from=${plus(mon, 1)}&to=${plus(mon, 1)}`)).body.data[it_.id][0].kind).toBe("onsite");
    // แก้ / ลบ ภายหลัง (ผู้รับงาน)
    const put = await api.put(`/api/v1/tickets/${uuid}/calendar`).send({ start_on: mon, end_on: plus(mon, 3) });
    expect(put.body.data.calendar_event.end_on).toBe(plus(mon, 3));
    expect((await (await as(requester)).put(`/api/v1/tickets/${uuid}/calendar`).send({ start_on: mon, end_on: mon })).status).toBe(403);

    // KPI: วันลาที่อนุมัติแล้ว + วันหยุดบริษัท = แถววันหยุดอ่านอย่างเดียว
    await insert("company_holidays", { calendar_id: await holidayCalendarFor(null), date: plus(mon, 4), name: "หยุดศุกร์", created_at: now, updated_at: now });
    await insert("leave_requests", { uuid: crypto.randomUUID(), user_id: it_.id, leave_type: "sick", unit: "full", start_on: plus(mon, 7), end_on: plus(mon, 8), days: 2, status: "approved", created_at: now });
    const month = plus(mon, 7).slice(0, 7);
    const sheet = (await api.get(`/api/v1/kpi/month?month=${month}`)).body.data as { kind: string; details: string; can_edit: boolean; entry_id: number | null }[];
    const derived = sheet.filter((r) => r.kind === "holiday" && r.entry_id === null);
    expect(derived.some((r) => r.details.startsWith("ลาป่วย"))).toBe(true);
    expect(derived.every((r) => r.can_edit === false)).toBe(true);

    // iCal: ต้องมี token
    expect((await guest().get("/api/v1/calendar/feed/" + "x".repeat(48))).status).toBe(404);
    const token = (await api.post("/api/v1/calendar/token")).body.data.token;
    const feed = await guest().get(`/api/v1/calendar/feed/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers["content-type"]).toContain("text/calendar");
    expect(feed.text).toContain("BEGIN:VEVENT");
    expect(await first("SELECT 1 FROM users WHERE id = ? AND calendar_token = ?", [it_.id, token])).toBeTruthy();
  });
});
