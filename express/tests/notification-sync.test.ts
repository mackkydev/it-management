import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { notify, TICKET_APPROVAL_COLUMNS, type TicketRow } from "../src/services/ticket-workflow.js";
import { as, makeUser } from "./helpers.js";

async function ticket(requesterId: number, no: string, attrs: Record<string, unknown> = {}): Promise<TicketRow> {
  const now = nowDb();
  const id = await insert("it_tickets", {
    uuid: crypto.randomUUID(), ticket_no: no, type: "repair", status: "approved", requester_id: requesterId, details: "ทดสอบแจ้งเตือน",
    requested_at: now, created_at: now, updated_at: now, ...attrs,
  });
  return (await first<TicketRow>(`SELECT t.*, ${TICKET_APPROVAL_COLUMNS} FROM it_tickets t WHERE t.id = ?`, [id]))!;
}

const unread = (userId: number, ticketUuid: string) =>
  scalar<number>(
    "SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.ticket_id')) = ?",
    [userId, ticketUuid],
  ).then(Number);

/** ตัวเลขบนเมนู กับ กระดิ่ง ต้องไปด้วยกัน */
describe("menu badges ↔ notification bell", () => {
  it("menu and bell go only to people directly involved; acting / opening the ticket clears the bell", async () => {
    const boss = await makeUser({ role: "super_admin" }); // ไม่ได้อยู่ฝ่าย IT = ไม่เกี่ยวข้องโดยตรง: ไม่มีทั้งตัวเลขเมนูและกระดิ่ง
    const staff = await makeUser({ is_it_staff: true });
    const requester = await makeUser();
    const t = await ticket(requester.id, "FM-T-SYNC-1");
    await notify(t, "approved", null);

    const bossApi = await as(boss);
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(0);
    expect(await unread(boss.id, t.uuid)).toBe(0);
    expect((await (await as(staff)).get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(1);
    expect(await unread(staff.id, t.uuid)).toBe(1);
    // รออนุมัติผล: หัวหน้า IT ได้ทั้งเมนู (คิวงาน IT) และกระดิ่ง — ผู้ดูแลระบบสูงสุดไม่ได้
    const head = await makeUser({ role: "admin", is_it_head: true });
    await exec("UPDATE it_tickets SET status = 'pending_it_head' WHERE id = ?", [t.id]);
    await notify({ ...t, status: "pending_it_head" }, "resulted", null);
    expect(await unread(head.id, t.uuid)).toBe(1);
    expect((await (await as(head)).get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(1);
    expect(await unread(boss.id, t.uuid)).toBe(0);
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(0);
    await exec("UPDATE it_tickets SET status = 'approved' WHERE id = ?", [t.id]);

    await (await as(head)).get(`/api/v1/tickets/${t.uuid}`); // หัวหน้าเปิดดูแล้ว
    // เจ้าหน้าที่รับงานจากเมนู → กระดิ่ง "รอรับงาน" ของทุกคนหายไปด้วย (ของผู้แจ้งเป็นแค่แจ้งให้ทราบ ยังอยู่จนกว่าจะเปิดดู)
    expect((await (await as(staff)).post(`/api/v1/tickets/${t.uuid}/accept`).send({})).status).toBe(200);
    expect(await unread(boss.id, t.uuid)).toBe(0);
    expect(await unread(staff.id, t.uuid)).toBe(0);
    expect(await unread(requester.id, t.uuid)).toBe(2); // approved + accepted

    // ผู้แจ้งเปิดดูใบงาน → แจ้งเตือนของใบนี้อ่านแล้ว
    expect((await (await as(requester)).get(`/api/v1/tickets/${t.uuid}`)).status).toBe(200);
    expect(await unread(requester.id, t.uuid)).toBe(0);

    // ใบที่เลือกผู้รับไว้แล้วเป็นของคนนั้น — ไม่นับในเมนูของคนอื่น (และไม่แจ้งเตือน)
    const before = (await bossApi.get("/api/v1/menu-badges")).body.data["/it/queue"];
    const assigned = await ticket(requester.id, "FM-T-SYNC-2", { assignee_id: staff.id });
    await notify(assigned, "approved", null);
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(before);
    expect(await unread(boss.id, assigned.uuid)).toBe(0);
    expect(await unread(staff.id, assigned.uuid)).toBe(1);
  });

  it("reading the bell does not clear the menu (the job is still waiting)", async () => {
    const staff = await makeUser({ is_it_staff: true });
    const requester = await makeUser();
    const t = await ticket(requester.id, "FM-T-SYNC-3", { assignee_id: staff.id });
    await notify(t, "approved", null);
    const api = await as(staff);
    await api.post("/api/v1/notifications/read-all");
    expect(await unread(staff.id, t.uuid)).toBe(0);
    expect((await api.get("/api/v1/menu-badges")).body.data["/it/tickets"]).toBe(1);
  });

  it("leave: deciding clears the approver's bell", async () => {
    const boss = await makeUser({ role: "manager" });
    const staff = await makeUser({ supervisor_id: boss.id });
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 21);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const mon = d.toISOString().slice(0, 10);
    const res = await (await as(staff)).post("/api/v1/leave").send({ reason: "ธุระส่วนตัว", leave_type: "personal", unit: "full", start_on: mon, end_on: mon, approver_id: boss.id });
    expect(res.status).toBe(201);
    const leaveUnread = () =>
      scalar<number>(
        "SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.leave_id')) = ?",
        [boss.id, res.body.data.id],
      ).then(Number);
    const bossApi = await as(boss);
    expect(await leaveUnread()).toBe(1);
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/leave/approvals"]).toBe(1);
    expect((await bossApi.post(`/api/v1/leave/${res.body.data.id}/approve`).send({})).status).toBe(200);
    expect(await leaveUnread()).toBe(0);
    expect((await bossApi.get("/api/v1/menu-badges")).body.data["/leave/approvals"]).toBe(0);
  });
});
