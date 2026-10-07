import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exec, insert } from "../src/db.js";
import { localToday, nowDb } from "../src/lib/time.js";
import { markOf } from "../src/services/kpi.js";
import { sheetName } from "../src/services/kpi-export.js";
import { as, makeBranch, makeUser } from "./helpers.js";

/** KPI ฝ่าย IT ตามไฟล์ Template-KPI-IT-2569-Part2-Details-Rev00.xlsx */

let seq = 0;
async function ticket(attrs: Record<string, unknown>): Promise<{ id: number; uuid: string; no: string }> {
  const uuid = crypto.randomUUID();
  const no = `FM-ITR-01-2025-${String(++seq).padStart(5, "0")}`;
  const id = await insert("it_tickets", {
    uuid, ticket_no: no, type: "repair", status: "completed", details: "แจ้งปัญหา", requested_at: "2025-10-06 03:00:00",
    created_at: nowDb(), updated_at: nowDb(), ...attrs,
  });
  return { id, uuid, no };
}

describe("KPI mark formula", () => {
  it("matches the Excel IF chain (0.5→0.5, 1→1, 2→2.25 … 8→45, anything else 0)", () => {
    expect([0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 2.5, 9].map(markOf)).toEqual([0, 0.5, 1, 2.25, 4.5, 9, 18, 27, 36, 45, 0, 0]);
    expect(sheetName("2025-10")).toBe("Oct68");
    expect(sheetName("2026-01")).toBe("Jan69");
  });
});

describe("KPI monthly sheet", () => {
  it("pulls accepted tickets by request date (local time), merges manual / holiday rows and totals", async () => {
    const staff = await makeUser({ role: "viewer", is_it_staff: true, name: "สมชาย IT" });
    const requester = await makeUser({ name: "ผู้แจ้ง ก" });
    const branch = await makeBranch({ name: "ลำพูน" });
    const base = { requester_id: requester.id, branch_id: branch, assignee_id: staff.id, accepted_at: "2025-10-06 04:00:00" };
    const done = await ticket({ ...base, symptom: "เปิดไม่ติด", repair_details: "เปลี่ยน PSU", completed_on: "2025-10-07" });
    await ticket({ ...base, type: "grant_access", status: "in_progress", details: "ขอสิทธิ์ ERP", requested_at: "2025-10-20 02:00:00" });
    // 31 ต.ค. 18:00 UTC = 1 พ.ย. เวลาไทย → ชีต พ.ย.
    await ticket({ ...base, requested_at: "2025-10-31 18:00:00" });
    await ticket({ ...base, status: "approved", assignee_id: null }); // ยังไม่มีคนรับงาน
    await ticket({ ...base, status: "cancelled" });
    await ticket({ ...base, assignee_id: (await makeUser({ is_it_staff: true })).id }); // คนอื่นรับงาน

    const api = await as(staff);
    expect((await api.put(`/api/v1/kpi/tickets/${done.uuid}`).send({ service_type: "Network Service", complexity: 3 })).body.data).toEqual({
      service_type: "Network Service", complexity: 3, mark: 4.5,
    });
    expect((await api.post("/api/v1/kpi").send({
      work_date: "2025-10-06", requester_name: "คุณเอ", branch_name: "สำนักงานใหญ่", service_type: "ETC.", details: "ประชุม",
      solution: "สรุปงาน", complexity: 0.5,
    })).status).toBe(201);
    expect((await api.post("/api/v1/kpi").send({ entry_type: "holiday", work_date: "2025-10-13", details: "วันหยุด วันคล้ายวันสวรรคต" })).status).toBe(201);

    const oct = (await api.get("/api/v1/kpi/month?month=2025-10")).body;
    expect(oct.data.map((r: { kind: string; work_date: string }) => [r.kind, r.work_date])).toEqual([
      ["ticket", "2025-10-06"], ["work", "2025-10-06"], ["holiday", "2025-10-13"], ["ticket", "2025-10-20"],
    ]);
    expect(oct.data[0]).toMatchObject({
      ticket: { id: done.uuid, ticket_no: done.no }, requester: "ผู้แจ้ง ก", branch: "ลำพูน", service_type: "Network Service", details: "เปิดไม่ติด",
      assignee: "สมชาย IT", solution: "เปลี่ยน PSU", complexity: 3, mark: 4.5, completed_date: "2025-10-07", can_edit: true,
    });
    // ยังไม่กรอก: ประเภทตั้งต้นตามประเภทใบงาน, Complexity 0, ยังไม่เสร็จ = ไม่มีวันที่แล้วเสร็จ
    expect(oct.data[3]).toMatchObject({ service_type: "User Account Service", complexity: 0, mark: 0, completed_date: null });
    expect(oct.totals).toEqual({ complexity: 3.5, mark: 5, rows: 4 });
    expect((await api.get("/api/v1/kpi/month?month=2025-11")).body.data).toHaveLength(1);
  });

  it("permissions and validation", async () => {
    const staff = await makeUser({ is_it_staff: true });
    const other = await makeUser({ is_it_staff: true });
    const head = await makeUser({ is_it_head: true, is_it_staff: true });
    const t = await ticket({ assignee_id: staff.id, accepted_at: nowDb(), requester_id: other.id });

    expect((await (await as(await makeUser({ role: "viewer" }))).get("/api/v1/kpi/month?month=2025-10")).status).toBe(403);
    const otherApi = await as(other);
    expect((await otherApi.get(`/api/v1/kpi/month?month=2025-10&user_id=${staff.id}`)).status).toBe(403);
    expect((await otherApi.put(`/api/v1/kpi/tickets/${t.uuid}`).send({ complexity: 2 })).status).toBe(403);
    // กลุ่มที่มีแค่ kpi.view_all ดูของทุกคนได้ แต่แก้ไม่ได้ (kpi.edit_all ไม่ได้ให้ใครตั้งต้น — ผู้ดูแลระบบสูงสุดผ่านทุกสิทธิ์)
    const headView = (await (await as(head)).get(`/api/v1/kpi/month?month=2025-10&user_id=${staff.id}`)).body;
    expect(headView.data[0].can_edit).toBe(false);
    expect((await (await as(head)).put(`/api/v1/kpi/tickets/${t.uuid}`).send({ complexity: 2 })).status).toBe(403);
    // ผู้ดูแลระบบ (admin) ดู/แก้ KPI ของคนอื่นไม่ได้ — เฉพาะผู้ดูแลระบบสูงสุด (หัวหน้า IT)
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.get(`/api/v1/kpi/month?month=2025-10&user_id=${staff.id}`)).status).toBe(403);
    expect((await admin.put(`/api/v1/kpi/tickets/${t.uuid}`).send({ complexity: 2 })).status).toBe(403);
    expect((await (await as(await makeUser({ role: "super_admin" }))).put(`/api/v1/kpi/tickets/${t.uuid}`).send({ complexity: 2 })).status).toBe(200);

    const api = await as(staff);
    const errs = async (body: Record<string, unknown>) => Object.keys((await api.post("/api/v1/kpi").send(body)).body.errors ?? {}).sort();
    expect(await errs({ work_date: "2025-10-01", details: "x", complexity: 2.5, service_type: "Bogus" })).toEqual(["complexity", "service_type"]);
    expect(await errs({ work_date: localToday(undefined, new Date(Date.now() + 3 * 86_400_000)), details: "x" })).toEqual(["work_date"]);
    expect(await errs({ work_date: "2025-10-10", details: "x", completed_date: "2025-10-09" })).toEqual(["completed_date"]);
    // วันหยุดลงล่วงหน้าได้
    expect((await api.post("/api/v1/kpi").send({ entry_type: "holiday", work_date: localToday(undefined, new Date(Date.now() + 30 * 86_400_000)), details: "วันหยุดยาว" })).status).toBe(201);
  });
});

describe("KPI Excel export", () => {
  it("builds the same layout as the original template with live formulas", async () => {
    const staff = await makeUser({ is_it_staff: true, name: "สมชาย" });
    const t = await ticket({ assignee_id: staff.id, accepted_at: nowDb(), requester_id: staff.id, symptom: "จอฟ้า", completed_on: "2025-10-08" });
    const api = await as(staff);
    await api.put(`/api/v1/kpi/tickets/${t.uuid}`).send({ complexity: 2 });
    await api.post("/api/v1/kpi").send({ entry_type: "holiday", work_date: "2025-10-13", details: "วันหยุด วันคล้ายวันสวรรคต" });
    await api.post("/api/v1/kpi").send({ work_date: "2025-10-14", details: "ประชุม", service_type: "ETC.", complexity: 1 });

    const res = await api.get("/api/v1/kpi/export?from=2025-10&to=2025-11").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(encodeURIComponent("KPI-IT-2569-สมชาย.xlsx"));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ServiceType", "Oct68", "Nov68"]);
    expect(wb.getWorksheet("ServiceType")!.getRow(2).values).toEqual([undefined, "Computer Service", expect.stringContaining("Printer")]);

    const ws = wb.getWorksheet("Oct68")!;
    expect(ws.getRow(1).values).toEqual([undefined, "วันที่แจ้ง", "ผู้แจ้ง", "สาขา", "ประเภทการแจ้ง", "รายการ", "ผู้รับแจ้ง", "วิธีการแก้ไข", "Complexity", "Mark", "วันที่แล้วเสร็จ"]);
    expect(ws.getRow(1).getCell(1).font).toMatchObject({ name: "Cordia New", size: 14, bold: true });
    expect(ws.getRow(2).getCell(1).numFmt).toBe("[$-107041E]d mmmm yyyy;@");
    expect(ws.getRow(2).getCell(5).value).toBe(`จอฟ้า (${t.no})`);
    expect(ws.getRow(2).getCell(9).value).toMatchObject({
      formula: "IF(H2=0.5,0.5,IF(H2=1,1,IF(H2=2,2.25,IF(H2=3,4.5,IF(H2=4,9,IF(H2=5,18,IF(H2=6,27,IF(H2=7,36,IF(H2=8,45,0)))))))))",
      result: 2.25,
    });
    expect((ws.getRow(2).getCell(10).value as Date).toISOString().slice(0, 10)).toBe("2025-10-08");
    // แถววันหยุดรวมเซลล์ B:G
    expect(ws.getRow(3).getCell(2).value).toBe("วันหยุด วันคล้ายวันสวรรคต");
    expect(ws.getCell("G3").isMerged).toBe(true);
    // แถวกรอกเองไม่มีวันที่แล้วเสร็จ → =A ตามต้นฉบับ
    expect(ws.getRow(4).getCell(10).value).toMatchObject({ formula: "A4" });
    expect(ws.getRow(5).getCell(7).value).toBe("Total");
    expect(ws.getRow(5).getCell(8).value).toMatchObject({ formula: "SUM(H2:H4)", result: 3 });
    expect(ws.getRow(5).getCell(9).value).toMatchObject({ formula: "SUM(I2:I4)", result: 3.25 });
  });
});

describe("KPI requester search", () => {
  it("finds local and API users by name and branch (every word must match), with their branch", async () => {
    const staff = await makeUser({ is_it_staff: true });
    const lamphun = await makeBranch({ name: "ลำพูน" });
    const bkk = await makeBranch({ name: "กรุงเทพ" });
    await makeUser({ name: "สมชาย ใจดี", branch_id: lamphun, department: "ผลิต" });
    // ผู้ใช้จาก API (ต้องมีการเชื่อมต่อ + ไม่มีรหัสผ่าน)
    const conn = await insert("api_connections", {
      name: "STEC", is_enabled: true, base_url: "https://stec.example.com", login_path: "/login", token_path: "token",
      field_map: "{}", role_rules: "[]", error_messages: "{}", allowed_hosts: "[]", active_values: "[]", created_at: nowDb(), updated_at: nowDb(),
    });
    const apiUser = await makeUser({ name: "สมชาย รักงาน", branch_id: bkk });
    await exec("UPDATE users SET type = 'API', connection_id = ?, external_id = 'somchai2', password = NULL WHERE id = ?", [conn, apiUser.id]);
    await makeUser({ name: "สมชาย ลาออก", branch_id: lamphun, is_active: false });

    const api = await as(staff);
    const names = async (q: string) => (await api.get(`/api/v1/kpi/people?search=${encodeURIComponent(q)}`)).body.data.map((p: { name: string }) => p.name);
    expect(await names("สมชาย")).toEqual(["สมชาย รักงาน", "สมชาย ใจดี"]);
    expect(await names("สมชาย ลำพูน")).toEqual(["สมชาย ใจดี"]);
    expect(await names("ผลิต")).toEqual(["สมชาย ใจดี"]);
    const found = (await api.get(`/api/v1/kpi/people?search=${encodeURIComponent("กรุงเทพ")}`)).body.data[0];
    expect(found).toMatchObject({ name: "สมชาย รักงาน", type: "API", branch: { id: bkk, name: "กรุงเทพ" } });
    expect((await (await as(await makeUser({ role: "viewer" }))).get("/api/v1/kpi/people?search=x")).status).toBe(403);
  });
});
