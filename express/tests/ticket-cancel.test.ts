import { beforeEach, describe, expect, it } from "vitest";
import { scalar } from "../src/db.js";
import type { UserRow } from "../src/models/user.js";
import { as, makeBranch, makeUser } from "./helpers.js";

/** ใบแจ้งงาน: ผู้แจ้งแก้ไข/ลบก่อนอนุมัติ, ขอยกเลิกหลังอนุมัติ → เจ้าหน้าที่ IT ผู้รับงานยืนยัน/ปฏิเสธ */

let branch: number;
let chief: UserRow;
let staff: UserRow;
let it_: UserRow;
let other: UserRow;

const unread = (u: UserRow) => scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL", [u.id]).then(Number);

beforeEach(async () => {
  branch = await makeBranch();
  chief = await makeUser({ name: "Chief" });
  staff = await makeUser({ name: "Staff", supervisor_id: chief.id, branch_id: branch });
  it_ = await makeUser({ name: "IT", is_it_staff: true });
  other = await makeUser({ name: "Other IT", is_it_staff: true });
});

async function submit() {
  const res = await (await as(staff)).post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "ติดตั้งโปรแกรม", assignee_id: it_.id });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("ticket edit / delete before approval", () => {
  it("the requester edits and deletes while pending; others cannot", async () => {
    const id = await submit();
    const api = await as(staff);
    expect((await api.get(`/api/v1/tickets/${id}`)).body.data.actions).toEqual(expect.arrayContaining(["edit", "delete"]));
    expect((await (await as(chief)).put(`/api/v1/tickets/${id}`).send({ type: "install", branch_id: branch, details: "x" })).status).toBe(403);

    const edited = await api.put(`/api/v1/tickets/${id}`).send({ type: "other", type_other: "งานออกแบบ", branch_id: branch, details: "แก้รายละเอียดแล้ว" });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ type: "other", type_other: "งานออกแบบ", details: "แก้รายละเอียดแล้ว", assignee: null });
    expect(edited.body.data.events.map((e: { action: string }) => e.action)).toContain("edited");

    expect((await api.delete(`/api/v1/tickets/${id}`)).status).toBe(204);
    expect(await scalar("SELECT COUNT(*) FROM it_tickets WHERE uuid = ?", [id])).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM notifications WHERE (data::jsonb ->> 'ticket_id') = ?", [id])).toBe(0); // แจ้งเตือนหัวหน้าถูกลบตาม
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'ticket.deleted'")).toBe(1);
  });

  it("after approval it can no longer be edited or deleted; a rejected ticket can be deleted", async () => {
    const id = await submit();
    await (await as(chief)).post(`/api/v1/tickets/${id}/approve`);
    const api = await as(staff);
    expect((await api.put(`/api/v1/tickets/${id}`).send({ type: "install", branch_id: branch, details: "x" })).status).toBe(403);
    expect((await api.delete(`/api/v1/tickets/${id}`)).status).toBe(403);

    const rejected = await submit();
    await (await as(chief)).post(`/api/v1/tickets/${rejected}/reject`).send({ comment: "ไม่จำเป็น" });
    expect((await api.get(`/api/v1/tickets/${rejected}`)).body.data.actions).toEqual(["delete"]);
    expect((await api.delete(`/api/v1/tickets/${rejected}`)).status).toBe(204);
  });
});

describe("ticket cancellation after approval", () => {
  it("requester asks to cancel → pending_cancel → the assigned IT staff is notified and confirms", async () => {
    const id = await submit();
    await (await as(chief)).post(`/api/v1/tickets/${id}/approve`);
    const before = await unread(it_);
    const api = await as(staff);
    expect((await api.post(`/api/v1/tickets/${id}/cancel`).send({})).status).toBe(422); // ต้องมีเหตุผล

    const req = await api.post(`/api/v1/tickets/${id}/cancel`).send({ reason: "ไม่ต้องการแล้ว" });
    expect(req.body.data).toMatchObject({ status: "pending_cancel", cancel_reason: "ไม่ต้องการแล้ว", cancel_requested_status: "approved" });
    expect(await unread(it_)).toBe(before + 1);
    expect(await unread(other)).toBe(0); // แจ้งเฉพาะผู้รับงาน

    expect((await (await as(other)).post(`/api/v1/tickets/${id}/cancel/confirm`)).status).toBe(403);
    expect((await (await as(it_)).get("/api/v1/tickets?scope=it")).body.counts.it_cancel).toBe(1);
    const done = await (await as(it_)).post(`/api/v1/tickets/${id}/cancel/confirm`).send({ comment: "ยกเลิกให้แล้ว" });
    expect(done.body.data).toMatchObject({ status: "cancelled", cancelled_by: { name: "IT" } });
    expect(done.body.data.actions).toEqual([]);
    expect((await api.get("/api/v1/tickets")).body.counts.mine_open).toBe(0);
  });

  it("IT can reject the request (back to the previous status) and the requester can withdraw it", async () => {
    const id = await submit();
    await (await as(chief)).post(`/api/v1/tickets/${id}/approve`);
    await (await as(it_)).post(`/api/v1/tickets/${id}/accept`);
    const api = await as(staff);

    await api.post(`/api/v1/tickets/${id}/cancel`).send({ reason: "เปลี่ยนใจ" });
    expect((await (await as(it_)).post(`/api/v1/tickets/${id}/cancel/reject`).send({})).status).toBe(422);
    const rejected = await (await as(it_)).post(`/api/v1/tickets/${id}/cancel/reject`).send({ comment: "ทำไปครึ่งทางแล้ว" });
    expect(rejected.body.data.status).toBe("in_progress");

    await api.post(`/api/v1/tickets/${id}/cancel`).send({ reason: "ขอยกเลิกอีกครั้ง" });
    const withdrawn = await api.post(`/api/v1/tickets/${id}/cancel/withdraw`);
    expect(withdrawn.body.data.status).toBe("in_progress");
    expect(withdrawn.body.data.events.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["cancel_requested", "cancel_rejected", "cancel_withdrawn"]),
    );
  });

  it("unassigned tickets: any IT staff who can accept decides; completed tickets cannot be cancelled", async () => {
    const res = await (await as(staff)).post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "x" });
    const id = res.body.data.id;
    await (await as(chief)).post(`/api/v1/tickets/${id}/approve`);
    await (await as(staff)).post(`/api/v1/tickets/${id}/cancel`).send({ reason: "ไม่ต้องการ" });
    expect(await unread(other)).toBeGreaterThan(0); // ยังไม่มีผู้รับ → แจ้ง IT ทุกคน
    expect((await (await as(other)).post(`/api/v1/tickets/${id}/cancel/confirm`)).body.data.status).toBe("cancelled");
    expect((await (await as(staff)).post(`/api/v1/tickets/${id}/cancel`).send({ reason: "อีกที" })).status).toBe(403);
  });
});
