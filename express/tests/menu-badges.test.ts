import { describe, expect, it } from "vitest";
import { insert } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeUser } from "./helpers.js";

/** ตัวเลขบนเมนู = งานที่รอผู้ใช้คนนั้นทำ */

let seq = 0;
const ticket = (attrs: Record<string, unknown>) =>
  insert("it_tickets", {
    uuid: crypto.randomUUID(), ticket_no: `FM-ITR-01-2026-${String(++seq).padStart(5, "0")}`, type: "repair", status: "approved",
    details: "-", requested_at: nowDb(), created_at: nowDb(), updated_at: nowDb(), ...attrs,
  });

describe("menu badges", () => {
  it("counts only the work waiting for each user", async () => {
    const requester = await makeUser({ name: "ผู้แจ้ง" });
    const approver = await makeUser({ role: "manager" });
    const staff = await makeUser({ is_it_staff: true });
    const otherStaff = await makeUser({ is_it_staff: true });
    const head = await makeUser({ is_it_staff: true, is_it_head: true });
    const r = requester.id;

    await ticket({ requester_id: r, status: "pending_requester", assignee_id: staff.id }); // รอผู้แจ้งรับงาน
    await ticket({ requester_id: r, status: "pending_supervisor", approver_id: approver.id }); // รอหัวหน้าอนุมัติ
    await ticket({ requester_id: r, status: "approved" }); // รอรับงาน (ยังไม่มีผู้รับ)
    await ticket({ requester_id: r, status: "approved", assignee_id: otherStaff.id }); // ผู้แจ้งเลือกเจ้าหน้าที่คนอื่น
    const mine = await ticket({ requester_id: r, status: "in_progress", assignee_id: staff.id }); // งานของ staff
    await ticket({ requester_id: r, status: "pending_it_head", assignee_id: staff.id }); // รอหัวหน้า IT อนุมัติผล
    await ticket({ requester_id: r, status: "completed", assignee_id: staff.id }); // เสร็จแล้ว แต่ยังไม่กรอก KPI
    await insert("kpi_entries", { ticket_id: mine, user_id: staff.id, work_date: "2026-01-01", details: "", complexity: 2, created_at: nowDb() });

    const badges = async (u: typeof staff) => (await (await as(u)).get("/api/v1/menu-badges")).body.data;
    expect(await badges(requester)).toEqual({ "/tickets": 1, "/tickets/approvals": 0 });
    expect((await badges(approver))["/tickets/approvals"]).toBe(1);
    // staff: รอรับงานที่ไม่มีผู้รับ 1 + งานของฉันกำลังทำ 1 / KPI: รับแล้ว 4 ใบ (pending_requester, in_progress, pending_it_head, completed) − กรอกแล้ว 1
    expect(await badges(staff)).toMatchObject({ "/it/tickets": 2, "/kpi": 3 });
    expect((await badges(otherStaff))["/it/tickets"]).toBe(2); // ใบที่ถูกเลือก + ใบที่ไม่มีผู้รับ
    // หัวหน้า IT (it_tickets.manage_all) รับได้ทุกใบ: รอรับงาน 2 + รออนุมัติผล 1
    expect((await badges(head))["/it/tickets"]).toBe(3);
  });
});
