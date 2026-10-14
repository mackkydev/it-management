import { describe, expect, it } from "vitest";
import { insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeUser } from "./helpers.js";

async function approvedTicket(requesterId: number, no: string): Promise<string> {
  const now = nowDb();
  const id = await insert("it_tickets", {
    uuid: crypto.randomUUID(), ticket_no: no, type: "repair", status: "approved", requester_id: requesterId, details: "ย้ายเครื่องทั้งแผนก",
    requested_at: now, created_at: now, updated_at: now,
  });
  return String(await scalar("SELECT uuid FROM it_tickets WHERE id = ?", [id]));
}

const notified = (userId: number) =>
  scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data LIKE '%helper_added%'", [userId]).then(Number);

/** ผู้ร่วมดำเนินการ: ผู้รับงานเลือกเจ้าหน้าที่ IT เพิ่มตอนรับงาน → แจ้งเตือน + ได้แถว KPI ของตัวเอง */
describe("ticket co-workers (helpers)", () => {
  it("the assignee adds IT co-workers on accept; they are notified, can view the ticket and get their own KPI row", async () => {
    const lead = await as(await makeUser({ is_it_staff: true, name: "ช่างหลัก" }), "th");
    const leadUser = (await lead.get("/api/v1/auth/me")).body.data;
    const helper = await makeUser({ is_it_staff: true, name: "ช่างผู้ช่วย" }); // กลุ่ม it_staff ทดสอบ (ไม่มี kpi.edit_all)
    const outsider = await makeUser({ name: "ไม่ใช่ IT" });
    const requester = await makeUser();
    const uuid = await approvedTicket(requester.id, "FM-T-HELP-1");

    const detail = (await lead.get(`/api/v1/tickets/${uuid}`)).body.data;
    expect(detail.helper_options.map((o: { id: number }) => o.id)).toContain(helper.id);
    expect(detail.helper_options.map((o: { id: number }) => o.id)).not.toContain(outsider.id);

    // คนนอกฝ่าย IT / ตัวเอง = ไม่ได้
    expect((await lead.post(`/api/v1/tickets/${uuid}/accept`).send({ helper_ids: [outsider.id] })).status).toBe(422);
    expect((await lead.post(`/api/v1/tickets/${uuid}/accept`).send({ helper_ids: [leadUser.id] })).status).toBe(422);

    const res = await lead.post(`/api/v1/tickets/${uuid}/accept`).send({ helper_ids: [helper.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.helpers).toEqual([{ id: helper.id, name: "ช่างผู้ช่วย" }]);
    expect(await notified(helper.id)).toBe(1);

    // ผู้ร่วมเห็นใบงาน (ตัวกรอง "งานของฉัน") และมีแถว KPI ของตัวเอง แยกประเภท/Complexity จากผู้รับงาน
    const h = await as(helper);
    expect((await h.get(`/api/v1/tickets/${uuid}`)).status).toBe(200);
    expect((await h.get("/api/v1/tickets?scope=it&assigned=me")).body.data.map((t: { ticket_no: string }) => t.ticket_no)).toContain("FM-T-HELP-1");
    const month = nowDb().slice(0, 7);
    const row = (await h.get(`/api/v1/kpi/month?month=${month}`)).body.data.find((r: { ticket: { ticket_no: string } | null }) => r.ticket?.ticket_no === "FM-T-HELP-1");
    expect(row).toMatchObject({ kind: "ticket", assignee: "ช่างผู้ช่วย", can_edit: true });
    expect((await h.put(`/api/v1/kpi/tickets/${uuid}`).send({ user_id: helper.id, service_type: "Computer Service", complexity: 2 })).status).toBe(200);
    expect((await lead.put(`/api/v1/kpi/tickets/${uuid}`).send({ complexity: 1 })).status).toBe(200);
    expect(await scalar("SELECT COUNT(*) FROM kpi_entries k JOIN it_tickets t ON t.id = k.ticket_id WHERE t.uuid = ?", [uuid])).toBe(2);
    // แก้ชีตของคนอื่นไม่ได้ / คนที่ไม่ใช่ผู้ร่วม = ไม่พบ
    expect((await h.put(`/api/v1/kpi/tickets/${uuid}`).send({ user_id: leadUser.id, complexity: 3 })).status).toBe(403);
    expect((await lead.put(`/api/v1/kpi/tickets/${uuid}`).send({ user_id: outsider.id, complexity: 3 })).status).toBe(404);

    // ผู้รับงานแก้รายชื่อภายหลัง: แจ้งเฉพาะคนที่เพิ่มใหม่; ผู้ร่วมแก้รายชื่อไม่ได้
    const second = await makeUser({ is_it_staff: true });
    const put = await lead.put(`/api/v1/tickets/${uuid}/helpers`).send({ helper_ids: [helper.id, second.id] });
    expect(put.body.data.helpers.map((x: { id: number }) => x.id)).toEqual([helper.id, second.id]);
    expect(await notified(helper.id)).toBe(1);
    expect(await notified(second.id)).toBe(1);
    expect((await h.put(`/api/v1/tickets/${uuid}/helpers`).send({ helper_ids: [] })).status).toBe(403);
    expect((await lead.put(`/api/v1/tickets/${uuid}/helpers`).send({ helper_ids: [] })).body.data.helpers).toEqual([]);
  });

  it("on-site calendar bar lists the assignee and every co-worker; co-workers count as busy on those days", async () => {
    const lead = await as(await makeUser({ is_it_staff: true, name: "ช่างหลัก", department: "IT" }));
    const helper = await makeUser({ is_it_staff: true, name: "ช่างผู้ช่วย", department: "ซ่อมบำรุง" }); // คนละแผนก
    const uuid = await approvedTicket((await makeUser()).id, "FM-T-HELP-2");
    const day = nowDb().slice(0, 10);
    expect((await lead.post(`/api/v1/tickets/${uuid}/accept`).send({ helper_ids: [helper.id], calendar: { start_on: day, end_on: day } })).status).toBe(200);

    const bar = (await lead.get(`/api/v1/calendar?from=${day}&to=${day}`)).body.data.find((i: { kind: string; ticket: { ticket_no: string } | null }) => i.kind === "onsite" && i.ticket?.ticket_no === "FM-T-HELP-2");
    expect(bar.title).toMatch(/^ช่างหลัก, ช่างผู้ช่วย — /);
    expect(bar.helpers).toEqual(["ช่างผู้ช่วย"]);
    // ผู้ร่วม (ขอบเขตแผนก) เห็นงานนี้ในปฏิทินของตัวเองด้วย และนับว่าไม่ว่าง
    const h = await as(helper);
    expect((await h.get(`/api/v1/calendar?from=${day}&to=${day}`)).body.data.some((i: { ticket: { ticket_no: string } | null }) => i.ticket?.ticket_no === "FM-T-HELP-2")).toBe(true);
    expect((await h.get(`/api/v1/calendar/busy?user_ids=${helper.id}&from=${day}&to=${day}`)).body.data[helper.id][0].kind).toBe("onsite");
  });
});
