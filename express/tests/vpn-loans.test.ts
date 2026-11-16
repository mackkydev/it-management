import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { localToday } from "../src/lib/time.js";
import { notifyVpnExpiry } from "../src/services/vpn-loans.js";
import { kpiMonthRows } from "../src/services/kpi.js";
import type { UserRow } from "../src/models/user.js";
import { SIG, as, localDay, makeBranch, makeUser, realImage } from "./helpers.js";

/** ลายเซ็นในโปรไฟล์ (อนุมัติผลใบงานจากหน้า VPN = ประทับลายเซ็นในโปรไฟล์) */
const signature = async (api: Awaited<ReturnType<typeof as>>) => {
  const res = await api.post("/api/v1/auth/me/signature").field("source", "DRAW").attach("signature", await realImage(800, 300, "png", { w: 500, h: 100 }), "sig.png");
  expect(res.status).toBe(200);
};

/** ยืม VPN — บัญชีจากคลังบัญชี (หมวด VPN), แจ้งเตือนล่วงหน้า / หมดอายุ, ผู้ใช้เลือก ต่ออายุ / เลิกใช้ → ใบแจ้งงานเข้าคิว IT → KPI */

const notices = (userId: number, type: string) =>
  scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ? AND read_at IS NULL", [userId, type]).then(Number);

let branch = 0;
let chief: UserRow;

async function setup() {
  branch = await makeBranch({ code: "VPN", name: "สาขา VPN" });
  chief = await makeUser({ name: "หัวหน้า", branch_id: branch });
  const managerUser = await makeUser({ name: "เจ้าหน้าที่ IT", is_it_staff: true, is_it_head: true, role: "admin" });
  const userRow = await makeUser({ name: "ผู้ใช้ VPN", department: "ขาย", supervisor_id: chief.id, branch_id: branch });
  const manager = await as(managerUser, "th");
  const user = await as(userRow, "th");
  // ตั้งค่าระบบ = super_admin เท่านั้น
  const rootRow = await makeUser({ role: "super_admin" });
  const root = await as(rootRow, "th");
  await root.put("/api/v1/settings").send({ secret_guard: { reauth: false } });
  // super_admin = ผู้อนุมัติการมอบ VPN ที่ไม่ได้ทำงานใบนั้น (อนุมัติผลใบงาน = ลายเซ็นในโปรไฟล์)
  await signature(root);
  const vpn1 = (await manager.post("/api/v1/credentials").send({ title: "VPN-01", category: "VPN", username: "vpn01", password: "Vpn-Pass-1" })).body.data;
  const vpn2 = (await manager.post("/api/v1/credentials").send({ title: "VPN-02", category: "vpn", username: "vpn02", password: "Vpn-Pass-2" })).body.data;
  const other = (await manager.post("/api/v1/credentials").send({ title: "Firewall", category: "network", password: "x" })).body.data;
  return { managerUser, userRow, manager, user, vpn1, vpn2, other, root, rootRow };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** แจ้งงาน "อื่นๆ → ขอใช้งาน VPN" + ช่วงวันที่ → คืนเลขใบงาน (uuid) */
async function vpnTicket(requester: UserRow, s: Setup, from = localToday(), until = localDay(60)) {
  const res = await (await as(requester, "th")).post("/api/v1/tickets").send({
    type: "other", type_other: "ขอใช้งาน VPN", branch_id: branch, details: "ขอรหัสใช้งานระบบ VPN\nเนื่องจาก : ทำงานจากบ้าน",
    assignee_id: s.managerUser.id, vpn_start_on: from, vpn_end_on: until,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}
const approve = async (ticketId: string) => expect((await (await as(chief, "th")).post(`/api/v1/tickets/${ticketId}/approve`).send({})).status).toBe(200);
const requestOf = async (requester: UserRow) => (await (await as(requester, "th")).get("/api/v1/vpn-loans/mine")).body.data[0] as { id: string; status: string };

/** ขอผ่านใบแจ้งงาน → หัวหน้าอนุมัติ → คืนรหัสคำขอ VPN */
async function requested(requester: UserRow, s: Setup) {
  await approve(await vpnTicket(requester, s));
  return (await requestOf(requester)).id;
}

/** มอบบัญชี → ผู้จัดการฝ่าย IT (root) อนุมัติ → ผู้ใช้กด "ได้รับแล้ว" */
async function assigned(s: Setup, expiresIn = 30, notifyDays = 7) {
  const id = await requested(s.userRow, s);
  const res = await s.manager.post(`/api/v1/vpn-loans/${id}/assign`).send({
    credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(expiresIn), notify_days_before: notifyDays,
  });
  expect(res.status).toBe(200);
  expect((await s.root.post(`/api/v1/vpn-loans/${id}/approval`).send({ approve: true })).status).toBe(200);
  expect((await s.user.post(`/api/v1/vpn-loans/${id}/receive`)).status).toBe(200);
  return res.body.data as { id: string };
}

describe("VPN loans", () => {
  it("request → IT assigns a VPN account from the vault (one holder per account) → the user can reveal the password", async () => {
    const s = await setup();
    const id = await requested(s.userRow, s);
    const created = (await s.user.get(`/api/v1/vpn-loans/${id}`)).body.data;
    expect(created).toMatchObject({ status: "requested", department: "ขาย", account: null, can_cancel: false, requested_from: localToday(), requested_until: localDay(60) });

    // บัญชีที่ให้ได้ = หมวด VPN (ไม่สนตัวพิมพ์)
    const accounts = (await s.manager.get("/api/v1/vpn-accounts")).body.data.map((a: { title: string }) => a.title);
    expect(accounts).toEqual(["VPN-01", "VPN-02"]);
    expect((await s.user.get("/api/v1/vpn-accounts")).status).toBe(403);
    expect((await s.manager.post(`/api/v1/vpn-loans/${id}/assign`).send({ credential_id: s.other.id, start_on: localToday(), expires_on: localDay(30) })).status).toBe(422);
    const ok = await s.manager.post(`/api/v1/vpn-loans/${id}/assign`).send({ credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(30), notify_days_before: 5 });
    expect(ok.status).toBe(200);
    // มอบแล้ว = รอผู้จัดการฝ่าย IT อนุมัติ (ผู้ใช้ยังไม่ได้แจ้ง / ดูรหัสไม่ได้)
    expect(ok.body.data).toMatchObject({ status: "pending_approval", account: { title: "VPN-01", username: "vpn01" }, notify_days_before: 5 });
    expect(await notices(s.userRow.id, "vpn.assigned")).toBe(0);
    expect(await notices(s.rootRow.id, "vpn.approval_requested")).toBe(1);
    expect((await s.user.get(`/api/v1/vpn-loans/${id}`)).body.data).toMatchObject({ account: { username: null }, can_reveal: false, can_receive: false });
    // ใบงานเดินเบื้องหลัง: ผู้รับงาน = ผู้มอบ บันทึกผลสำเร็จแล้ว รอผู้จัดการ IT อนุมัติผล
    const ticket = (await s.manager.get(`/api/v1/vpn-loans/${id}`)).body.data.ticket;
    expect(await first("SELECT status, assignee_id, result FROM it_tickets WHERE uuid = ?", [ticket.id])).toEqual({ status: "pending_it_head", assignee_id: s.managerUser.id, result: "completed" });
    expect((await s.user.post(`/api/v1/vpn-loans/${id}/approval`).send({ approve: true })).status).toBe(403);
    const approved = await s.root.post(`/api/v1/vpn-loans/${id}/approval`).send({ approve: true });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: "active", days_left: 30 });
    expect(await notices(s.userRow.id, "vpn.assigned")).toBe(1);
    expect(await notices(s.rootRow.id, "vpn.approval_requested")).toBe(0);
    expect((await first<{ status: string }>("SELECT status FROM it_tickets WHERE uuid = ?", [ticket.id]))!.status).toBe("pending_requester");
    // ผู้ใช้กด "ได้รับแล้ว" → ปิดใบงาน → ปุ่มดูชื่อผู้ใช้ / รหัสผ่าน
    expect((await s.user.get(`/api/v1/vpn-loans/${id}`)).body.data).toMatchObject({ can_receive: true, can_reveal: false });
    expect((await s.user.post(`/api/v1/vpn-loans/${id}/reveal`).send({ password: "password" })).status).toBe(422);
    const got = await s.user.post(`/api/v1/vpn-loans/${id}/receive`);
    expect(got.body.data).toMatchObject({ can_receive: false, can_reveal: true, account: { username: "vpn01" } });
    expect((await first<{ status: string }>("SELECT status FROM it_tickets WHERE uuid = ?", [ticket.id]))!.status).toBe("completed");

    // บัญชีเดียวกันให้คนที่สองไม่ได้
    const secondRow = await makeUser({ supervisor_id: chief.id, branch_id: branch });
    const second = await as(secondRow, "th");
    const req2 = await requested(secondRow, s);
    const taken = await s.manager.post(`/api/v1/vpn-loans/${req2}/assign`).send({ credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(30) });
    expect(taken.status).toBe(422);
    expect(taken.body.errors.credential_id[0]).toContain("ผู้ใช้ VPN");

    // ผู้ยืมเปิดดูรหัสได้ (ต้องกรอกรหัสผ่าน login ทุกครั้ง + บันทึกประวัติในคลังบัญชี) — คนอื่นไม่ได้
    expect((await s.user.post(`/api/v1/vpn-loans/${id}/reveal`)).status).toBe(422);
    const wrong = await s.user.post(`/api/v1/vpn-loans/${id}/reveal`).send({ password: "wrong-pass" });
    expect(wrong.status).toBe(422);
    expect(Object.keys(wrong.body.errors)).toEqual(["password"]);
    const reveal = await s.user.post(`/api/v1/vpn-loans/${id}/reveal`).send({ password: "password" });
    expect(reveal.status).toBe(200);
    expect(reveal.body.data).toEqual({ username: "vpn01", password: "Vpn-Pass-1" });
    expect(await scalar("SELECT COUNT(*) FROM credential_access_logs WHERE credential_id = ? AND action = 'vpn_reveal'", [s.vpn1.id])).toBe(1);
    expect((await second.post(`/api/v1/vpn-loans/${id}/reveal`)).status).toBe(403);
    expect((await second.get(`/api/v1/vpn-loans/${id}`)).status).toBe(403);
  });

  it("reminds the user before expiry and on expiry (once per expiry date); expired accounts cannot be revealed", async () => {
    const s = await setup();
    const loan = await assigned(s, 10, 3);
    expect(await notifyVpnExpiry()).toBe(0); // ยังไม่ถึงช่วงแจ้ง

    await exec("UPDATE vpn_loans SET expires_on = ? WHERE uuid = ?", [localDay(2), loan.id]);
    expect(await notifyVpnExpiry()).toBe(1);
    expect(await notifyVpnExpiry()).toBe(0);
    expect(await notices(s.userRow.id, "vpn.expiring")).toBe(1);
    expect((await s.user.get(`/api/v1/vpn-loans/${loan.id}`)).body.data).toMatchObject({ is_expiring: true, can_choose: true, days_left: 2 });
    expect((await s.user.get("/api/v1/menu-badges")).body.data["/loans/mine"]).toBe(1);

    await exec("UPDATE vpn_loans SET expires_on = ? WHERE uuid = ?", [localDay(-1), loan.id]);
    expect(await notifyVpnExpiry()).toBe(1);
    expect(await notices(s.userRow.id, "vpn.expired")).toBe(1);
    expect(await notices(s.managerUser.id, "vpn.expired")).toBe(1);
    expect((await s.user.post(`/api/v1/vpn-loans/${loan.id}/reveal`)).status).toBe(422);
    expect((await s.manager.get("/api/v1/menu-badges")).body.data["/loans/vpn"]).toBe(1);
  });

  it("renew → ticket straight into the IT queue → completed result extends the expiry → counts in KPI as Network Service", async () => {
    const s = await setup();
    const loan = await assigned(s, 5, 7);
    const choice = await s.user.post(`/api/v1/vpn-loans/${loan.id}/choice`).send({ choice: "renew", renew_until: localDay(90), reason: "โปรเจกต์ต่อ" });
    expect(choice.status).toBe(200);
    expect(choice.body.data).toMatchObject({ status: "renewal_requested", renew_until: localDay(90), ticket: { ticket_no: choice.body.ticket.ticket_no } });
    expect((await s.user.post(`/api/v1/vpn-loans/${loan.id}/choice`).send({ choice: "cancel" })).status).toBe(422); // ส่งเรื่องแล้ว

    // ใบแจ้งงาน: อนุมัติแล้ว ผู้รับงาน = คนที่มอบบัญชี → อยู่ในคิว IT
    const ticketId = choice.body.ticket.id;
    const ticket = await first<{ status: string; type: string; type_other: string; assignee_id: number; requester_id: number; details: string }>(
      "SELECT status, type, type_other, assignee_id, requester_id, details FROM it_tickets WHERE uuid = ?",
      [ticketId],
    );
    expect(ticket).toMatchObject({ status: "approved", type: "other", type_other: "VPN: ขอต่ออายุ", assignee_id: s.managerUser.id, requester_id: s.userRow.id });
    expect(ticket!.details).toContain("VPN-01");
    expect(ticket!.details).not.toContain("Vpn-Pass-1");
    // ใบงานของระบบ VPN (ใบขอใช้ + ใบ "VPN: ขอต่ออายุ") ไม่แจ้งเตือนใบงานถึงฝั่ง IT (isVpnTicketRow ใน ticket-workflow.ts)
    // — ฝั่ง IT ได้ vpn.choice_requested ที่เมนู VPN แทน
    expect(await notices(s.managerUser.id, "App\\Notifications\\TicketActivity")).toBe(0);
    expect(await notices(s.managerUser.id, "vpn.choice_requested")).toBe(1);

    // IT รับงาน → บันทึกผลสำเร็จ → ต่ออายุให้อัตโนมัติ
    expect((await s.manager.post(`/api/v1/tickets/${ticketId}/accept`)).status).toBe(200);
    const result = await s.manager.post(`/api/v1/tickets/${ticketId}/result`).send({ result: "completed", completed_on: localToday(), signature: SIG });
    expect(result.status).toBe(200);
    const after = (await s.user.get(`/api/v1/vpn-loans/${loan.id}`)).body.data;
    expect(after).toMatchObject({ status: "active", expires_on: localDay(90), is_expiring: false });
    expect(await notices(s.userRow.id, "vpn.renewed")).toBe(1);

    // ผู้จัดการ IT อนุมัติผล → ขึ้น KPI ของเจ้าหน้าที่ (ประเภท Network Service)
    // ผู้รับงานอนุมัติผลงานตัวเองไม่ได้เมื่อมีผู้อนุมัติผลคนอื่น (super_admin)
    expect((await s.manager.post(`/api/v1/tickets/${ticketId}/close`).send({ signature: SIG })).status).toBe(403);
    expect((await s.root.post(`/api/v1/tickets/${ticketId}/close`).send({ signature: SIG })).status).toBe(200);
    const rows = await kpiMonthRows(s.managerUser.id, localToday().slice(0, 7));
    expect(rows.find((r) => r.ticket?.id === ticketId)).toMatchObject({ service_type: "Network Service" });
  });

  it("cancel → ticket → completed result ends the loan and frees the account; IT can also end or edit directly", async () => {
    const s = await setup();
    const loan = await assigned(s);
    const choice = await s.user.post(`/api/v1/vpn-loans/${loan.id}/choice`).send({ choice: "cancel" });
    // ไม่ต่ออายุ = สิ้นสุดทันที บัญชีกลับคืนคลัง (ใบแจ้งงานยังสร้างให้ฝ่าย IT)
    expect(choice.body.data).toMatchObject({ status: "ended", can_reveal: false, can_choose: false });
    expect((await s.manager.get("/api/v1/vpn-accounts")).body.data[0]).toMatchObject({ title: "VPN-01", holder: null });
    const ticketId = choice.body.ticket.id;
    expect(await first("SELECT type_other FROM it_tickets WHERE uuid = ?", [ticketId])).toEqual({ type_other: "VPN: ขอยกเลิกการใช้" });
    await s.manager.post(`/api/v1/tickets/${ticketId}/accept`);
    await s.manager.post(`/api/v1/tickets/${ticketId}/result`).send({ result: "completed", completed_on: localToday(), signature: SIG });
    expect((await s.user.get(`/api/v1/vpn-loans/${loan.id}`)).body.data).toMatchObject({ status: "ended", can_reveal: false });
    expect((await s.manager.get("/api/v1/vpn-accounts")).body.data[0]).toMatchObject({ title: "VPN-01", holder: null });

    // ผู้ดูแลแก้วันหมดอายุ / สิ้นสุดเอง
    const loan2 = await assigned(s);
    const edited = await s.manager.put(`/api/v1/vpn-loans/${loan2.id}`).send({ expires_on: localDay(45), notify_days_before: 10 });
    expect(edited.body.data).toMatchObject({ expires_on: localDay(45), notify_days_before: 10 });
    expect(await notices(s.userRow.id, "vpn.updated")).toBe(1);
    expect((await s.user.put(`/api/v1/vpn-loans/${loan2.id}`).send({ expires_on: localDay(100) })).status).toBe(403);
    const ended = await s.manager.post(`/api/v1/vpn-loans/${loan2.id}/end`).send({ note: "ลาออก" });
    expect(ended.body.data).toMatchObject({ status: "ended", end_note: "ลาออก" });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'vpn_loan.%'")).toBeGreaterThanOrEqual(7);
  });

  it("a ticket that cannot be done puts the loan back to active; requests can be rejected or cancelled", async () => {
    const s = await setup();
    const loan = await assigned(s);
    const ticketId = (await s.user.post(`/api/v1/vpn-loans/${loan.id}/choice`).send({ choice: "renew", renew_until: localDay(60) })).body.ticket.id;
    await s.manager.post(`/api/v1/tickets/${ticketId}/accept`);
    await s.manager.post(`/api/v1/tickets/${ticketId}/result`).send({ result: "cannot_complete", cannot_reason: "รออนุมัติงบ", signature: SIG });
    expect((await s.user.get(`/api/v1/vpn-loans/${loan.id}`)).body.data).toMatchObject({ status: "active", expires_on: localDay(30), can_choose: true });

    const otherRow = await makeUser({ supervisor_id: chief.id, branch_id: branch });
    const other = await as(otherRow, "th");
    // ขอผ่านใบแจ้งงาน: ปฏิเสธที่ใบงาน ไม่ใช่ที่ VPN (ใบงานกับคำขอต้องตรงกัน)
    const a = await requested(otherRow, s);
    expect((await s.manager.get(`/api/v1/vpn-loans/${a}`)).body.data.can_reject).toBe(false);
    expect((await s.manager.post(`/api/v1/vpn-loans/${a}/reject`).send({ note: "ไม่มีบัญชีว่าง" })).status).toBe(422);
    const ticketA = (await s.manager.get(`/api/v1/vpn-loans/${a}`)).body.data.ticket.id;
    await s.manager.post(`/api/v1/tickets/${ticketA}/accept`);
    await s.manager.post(`/api/v1/tickets/${ticketA}/result`).send({ result: "cannot_complete", cannot_reason: "ไม่มีบัญชีว่าง", signature: SIG });
    expect((await s.manager.get(`/api/v1/vpn-loans/${a}`)).body.data).toMatchObject({ status: "rejected", end_note: "ไม่มีบัญชีว่าง" });
    // ขอผ่านใบแจ้งงาน — ยกเลิกที่ใบงาน (ลบใบก่อนอนุมัติ) ไม่ใช่ที่ VPN
    const ticketB = await vpnTicket(otherRow, s);
    const b = await requestOf(otherRow);
    expect((await other.post(`/api/v1/vpn-loans/${b.id}/cancel`)).status).toBe(422);
    expect((await other.delete(`/api/v1/tickets/${ticketB}`)).status).toBe(204);
    expect((await other.get(`/api/v1/vpn-loans/${b.id}`)).body.data.status).toBe("cancelled");
    expect((await s.manager.get("/api/v1/vpn-loans/manage?status=ended")).body.data).toHaveLength(2);
  });

  it("request through a ticket: dates required, visible to IT only after approval, result needs an account, reject / cannot-do closes it", async () => {
    const s = await setup();
    const api = s.user;
    const base = { type: "other", type_other: "ขอใช้งาน VPN", branch_id: branch, details: "x", assignee_id: s.managerUser.id };

    // ตัวเลือก "ขอใช้งาน VPN" อยู่ในฟอร์มเสมอ
    const options = (await api.get("/api/v1/tickets/form-options")).body.data;
    expect(options.other_types[0]).toBe("ขอใช้งาน VPN");
    expect(options.vpn_type).toBe("ขอใช้งาน VPN");

    // ต้องมีช่วงวันที่ที่ถูกต้อง
    const missing = await api.post("/api/v1/tickets").send(base);
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.errors)).toEqual(expect.arrayContaining(["vpn_start_on", "vpn_end_on"]));
    expect((await api.post("/api/v1/tickets").send({ ...base, vpn_start_on: localDay(5), vpn_end_on: localDay(2) })).status).toBe(422);
    expect((await api.post("/api/v1/tickets").send({ ...base, vpn_start_on: localToday(), vpn_end_on: localDay(400) })).status).toBe(422);
    // เรื่องอื่น = ไม่ใช่คำขอ VPN
    expect((await api.post("/api/v1/tickets").send({ ...base, type_other: "งานออกแบบ" })).status).toBe(201);
    expect((await api.get("/api/v1/vpn-loans/mine")).body.data).toHaveLength(0);

    // ก่อนหัวหน้าอนุมัติ: ผู้ดูแลยังไม่เห็น / มอบไม่ได้
    const ticketId = await vpnTicket(s.userRow, s, localDay(1), localDay(30));
    const loan = await requestOf(s.userRow);
    expect(loan).toMatchObject({ status: "requested", requested_from: localDay(1), requested_until: localDay(30) });
    expect((await s.manager.get("/api/v1/vpn-loans/manage?status=requested")).body.data).toHaveLength(0);
    expect((await s.manager.get("/api/v1/menu-badges")).body.data["/loans/vpn"] ?? 0).toBe(0);
    expect((await s.manager.post(`/api/v1/vpn-loans/${loan.id}/assign`).send({ credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(30) })).status).toBe(422);
    // มีคำขอรออยู่แล้ว = แจ้งใบใหม่ไม่ได้
    expect((await api.post("/api/v1/tickets").send({ ...base, vpn_start_on: localToday(), vpn_end_on: localDay(10) })).status).toBe(422);

    // ผู้แจ้งแก้ช่วงวันที่ก่อนอนุมัติ → คำขอปรับตาม
    expect((await api.put(`/api/v1/tickets/${ticketId}`).send({ ...base, vpn_start_on: localDay(2), vpn_end_on: localDay(45) })).status).toBe(200);
    expect(await requestOf(s.userRow)).toMatchObject({ requested_from: localDay(2), requested_until: localDay(45) });
    expect((await api.get(`/api/v1/tickets/${ticketId}`)).body.data.vpn_request).toMatchObject({ status: "requested", requested_from: localDay(2), requested_until: localDay(45) });

    // หัวหน้าอนุมัติ → เข้าคิว IT + หน้า จัดการ VPN
    await approve(ticketId);
    expect((await s.manager.get("/api/v1/vpn-loans/manage?status=requested")).body.data).toHaveLength(1);
    expect((await s.manager.get("/api/v1/menu-badges")).body.data["/loans/vpn"]).toBe(1);

    // บันทึกผลสำเร็จต้องมอบบัญชีก่อน
    expect((await s.manager.post(`/api/v1/tickets/${ticketId}/accept`)).status).toBe(200);
    const early = await s.manager.post(`/api/v1/tickets/${ticketId}/result`).send({ result: "completed", completed_on: localToday(), signature: SIG });
    expect(early.status).toBe(422);
    expect(early.body.errors.result[0]).toContain("จัดการ VPN");
    // มอบบัญชี = ใบงานบันทึกผลสำเร็จให้อัตโนมัติ (ไม่ต้องบันทึกที่หน้าใบงาน) → รอผู้จัดการ IT อนุมัติ
    expect((await s.manager.post(`/api/v1/vpn-loans/${loan.id}/assign`).send({ credential_id: s.vpn1.id, start_on: localDay(2), expires_on: localDay(45) })).status).toBe(200);
    expect((await api.get(`/api/v1/tickets/${ticketId}`)).body.data).toMatchObject({ status: "pending_it_head", vpn_request: { status: "pending_approval", account: "VPN-01" } });
    // ผู้จัดการ IT ส่งกลับที่หน้าใบงาน → คำขอกลับเป็นรอมอบ (บัญชีว่าง) แจ้งผู้มอบ
    expect((await s.root.post(`/api/v1/tickets/${ticketId}/return`).send({ comment: "ผิดบัญชี" })).status).toBe(200);
    expect(await requestOf(s.userRow)).toMatchObject({ status: "requested", account: null });
    expect(await notices(s.managerUser.id, "vpn.approval_returned")).toBe(1);
    // มอบใหม่ → อนุมัติที่หน้าใบงาน = อนุมัติการมอบ (แจ้งผู้ขอ) → ผู้ขอกดรับงานที่ใบงาน = ได้รับ VPN
    expect((await s.manager.post(`/api/v1/vpn-loans/${loan.id}/assign`).send({ credential_id: s.vpn1.id, start_on: localDay(2), expires_on: localDay(45) })).status).toBe(200);
    expect((await s.root.post(`/api/v1/tickets/${ticketId}/close`).send({ signature: SIG })).status).toBe(200);
    expect((await api.get(`/api/v1/tickets/${ticketId}`)).body.data.vpn_request).toMatchObject({ status: "active", account: "VPN-01", expires_on: localDay(45) });
    expect(await notices(s.userRow.id, "vpn.assigned")).toBe(1);
    expect((await api.post(`/api/v1/tickets/${ticketId}/confirm-close`).send({})).status).toBe(200);
    expect((await api.get("/api/v1/vpn-loans/mine")).body.data[0]).toMatchObject({ can_reveal: true, can_receive: false });

    // อีกคน: หัวหน้าไม่อนุมัติ → คำขอปิด / อีกใบ IT ทำไม่ได้ → คำขอปิด
    const otherRow = await makeUser({ supervisor_id: chief.id, branch_id: branch });
    const rejected = await vpnTicket(otherRow, s);
    expect((await (await as(chief, "th")).post(`/api/v1/tickets/${rejected}/reject`).send({ comment: "ไม่จำเป็น" })).status).toBe(200);
    expect(await requestOf(otherRow)).toMatchObject({ status: "rejected", end_note: "ไม่จำเป็น" });
    const cannot = await vpnTicket(otherRow, s);
    await approve(cannot);
    await s.manager.post(`/api/v1/tickets/${cannot}/accept`);
    expect((await s.manager.post(`/api/v1/tickets/${cannot}/result`).send({ result: "cannot_complete", cannot_reason: "บัญชีเต็ม", signature: SIG })).status).toBe(200);
    expect(await requestOf(otherRow)).toMatchObject({ status: "rejected", end_note: "บัญชีเต็ม" });
  });
});
