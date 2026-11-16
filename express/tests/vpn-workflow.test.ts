import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { localToday } from "../src/lib/time.js";
import { kpiMonthRows } from "../src/services/kpi.js";
import { notifyVpnExpiry } from "../src/services/vpn-loans.js";
import { as, localDay, makeBranch, makeUser, realImage } from "./helpers.js";

/**
 * ยืม VPN แบบใหม่: มอบ → ผู้จัดการฝ่าย IT อนุมัติ → ผู้ขอกด "ได้รับแล้ว" (ปิดใบงาน, KPI ของผู้มอบ),
 * แจ้งเตือนฝั่ง IT อยู่ที่เมนู VPN, เรียกคืนรหัส, แจ้งถูกล็อก, หมดอายุแจ้งทุกวัน, ค่าตั้งต้นวันแจ้งล่วงหน้าจากหน้าตั้งค่า
 */
const notices = (userId: number, type: string) =>
  scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ? AND read_at IS NULL", [userId, type]).then(Number);
const TICKET = "App\\Notifications\\TicketActivity";

async function setup() {
  const branch = await makeBranch({ code: `VW${Date.now() % 100000}`, name: "สาขา VPN ใหม่" });
  const chief = await makeUser({ name: "หัวหน้าแผนก", branch_id: branch });
  const staffRow = await makeUser({ name: "เจ้าหน้าที่ IT", is_it_staff: true, role: "admin" });
  const headRow = await makeUser({ name: "ผู้จัดการฝ่าย IT", is_it_head: true, role: "admin" });
  const userRow = await makeUser({ name: "ผู้ขอ VPN", supervisor_id: chief.id, branch_id: branch });
  const [staff, head, user] = [await as(staffRow, "th"), await as(headRow, "th"), await as(userRow, "th")];
  const res = await head.post("/api/v1/auth/me/signature").field("source", "DRAW").attach("signature", await realImage(800, 300, "png", { w: 500, h: 100 }), "sig.png");
  expect(res.status).toBe(200);
  const root = await as(await makeUser({ role: "super_admin" }), "th");
  await root.put("/api/v1/settings").send({ secret_guard: { reauth: false }, vpn_notify_days: 4 });
  const account = (await staff.post("/api/v1/credentials").send({ title: `VPN-W-${Date.now() % 100000}`, category: "VPN", username: "vw01", password: "VW-Pass" })).body.data;
  // ขอผ่านหน้า ขอใช้ VPN (ใบแจ้งงานเบื้องหลัง) → หัวหน้าอนุมัติ
  const ticket = (await user.post("/api/v1/tickets").send({
    type: "other", type_other: "ขอใช้งาน VPN", branch_id: branch, details: "ขอรหัสใช้งานระบบ VPN", assignee_id: staffRow.id, vpn_start_on: localToday(), vpn_end_on: localDay(30),
  })).body.data.id as string;
  expect((await (await as(chief, "th")).post(`/api/v1/tickets/${ticket}/approve`).send({})).status).toBe(200);
  const loanId = (await user.get("/api/v1/vpn-loans/mine")).body.data[0].id as string;
  return { staffRow, headRow, userRow, staff, head, user, root, account, ticket, loanId };
}

describe("VPN workflow (approval, receive, revoke, locked, expiry)", () => {
  it("IT-side notices live in the VPN menu; assign → head approves → user receives; the assigner gets the KPI row; default reminder days come from settings", async () => {
    const s = await setup();
    // ใบขอใช้ VPN: ฝั่ง IT ไม่ได้แจ้งเตือนใบงาน ได้ vpn.requested แทน / ตัวเลขอยู่ที่ /loans/vpn ไม่ใช่คิวงาน IT
    expect(await notices(s.staffRow.id, TICKET)).toBe(0);
    expect(await notices(s.staffRow.id, "vpn.requested")).toBe(1);
    const staffBadges = (await s.staff.get("/api/v1/menu-badges")).body.data;
    expect(staffBadges["/it/tickets"] ?? 0).toBe(0);
    expect(staffBadges["/loans/vpn"]).toBe(1);
    expect(staffBadges["/loans/vpn?status=requested"]).toBe(1);
    // ผู้ขอยังได้แจ้งเตือนใบงานตามเดิม
    expect(await notices(s.userRow.id, TICKET)).toBeGreaterThanOrEqual(1);

    const assigned = await s.staff.post(`/api/v1/vpn-loans/${s.loanId}/assign`).send({ credential_id: s.account.id, start_on: localToday(), expires_on: localDay(30) });
    expect(assigned.body.data).toMatchObject({ status: "pending_approval", notify_days_before: 4 });
    expect(await notices(s.headRow.id, "vpn.approval_requested")).toBe(1);
    expect(await notices(s.headRow.id, TICKET)).toBe(0);
    const headBadges = (await s.head.get("/api/v1/menu-badges")).body.data;
    expect(headBadges["/loans/vpn?status=approval"]).toBe(1);
    expect(headBadges["/it/queue"] ?? 0).toBe(0);
    expect((await s.head.get("/api/v1/vpn-loans/manage?status=approval")).body.data.map((l: { id: string }) => l.id)).toEqual([s.loanId]);
    // เจ้าหน้าที่ที่มอบอนุมัติเองไม่ได้
    expect((await s.staff.post(`/api/v1/vpn-loans/${s.loanId}/approval`).send({ approve: true })).status).toBe(403);
    // ส่งกลับต้องมีเหตุผล
    expect((await s.head.post(`/api/v1/vpn-loans/${s.loanId}/approval`).send({ approve: false })).status).toBe(422);
    expect((await s.head.post(`/api/v1/vpn-loans/${s.loanId}/approval`).send({ approve: true })).body.data.status).toBe("active");
    expect(await notices(s.userRow.id, "vpn.assigned")).toBe(1);
    expect((await s.user.get("/api/v1/menu-badges")).body.data["/loans/vpn/request"]).toBe(1); // รอกดได้รับ

    expect((await s.user.post(`/api/v1/vpn-loans/${s.loanId}/receive`)).body.data).toMatchObject({ received_at: expect.any(String), can_reveal: true });
    expect(await first("SELECT status, assignee_id, it_head_id FROM it_tickets WHERE uuid = ?", [s.ticket])).toEqual({ status: "completed", assignee_id: s.staffRow.id, it_head_id: s.headRow.id });
    const rows = await kpiMonthRows(s.staffRow.id, localToday().slice(0, 7));
    expect(rows.some((r) => r.ticket?.id === s.ticket)).toBe(true);
  });

  it("report locked-out creates a ticket only; revoke hides the user/password; expired accounts remind every day until renewed", async () => {
    const s = await setup();
    await s.staff.post(`/api/v1/vpn-loans/${s.loanId}/assign`).send({ credential_id: s.account.id, start_on: localToday(), expires_on: localDay(30), notify_days_before: 3 });
    await s.head.post(`/api/v1/vpn-loans/${s.loanId}/approval`).send({ approve: true });
    await s.user.post(`/api/v1/vpn-loans/${s.loanId}/receive`);

    const locked = await s.user.post(`/api/v1/vpn-loans/${s.loanId}/choice`).send({ choice: "locked", reason: "ใส่รหัสผิดหลายครั้ง" });
    expect(locked.status).toBe(200);
    expect(locked.body.data.status).toBe("active");
    expect(await first("SELECT type_other, status FROM it_tickets WHERE uuid = ?", [locked.body.ticket.id])).toEqual({ type_other: "VPN: แจ้งผู้ใช้ถูกล็อก", status: "approved" });
    expect(await notices(s.staffRow.id, "vpn.choice_requested")).toBe(1);

    // หมดอายุ → แจ้งผู้ใช้ + ผู้ดูแล ทุกวัน (วันเดียวกันครั้งเดียว)
    await exec("UPDATE vpn_loans SET expires_on = ?, reminded_for = ? WHERE uuid = ?", [localDay(-2), localDay(-2), s.loanId]);
    expect(await notifyVpnExpiry()).toBe(1);
    expect(await notifyVpnExpiry()).toBe(0);
    await exec("UPDATE vpn_loans SET expired_notified_on = ? WHERE uuid = ?", [localDay(-1), s.loanId]);
    expect(await notifyVpnExpiry()).toBe(1);
    expect(await notices(s.userRow.id, "vpn.expired")).toBe(1); // ของเมื่อวานอ่านแล้ว เหลือของวันนี้
    expect(await notices(s.staffRow.id, "vpn.expired")).toBe(1);
    // หมดอายุแล้วยังขอต่ออายุได้
    expect((await s.user.get(`/api/v1/vpn-loans/${s.loanId}`)).body.data).toMatchObject({ is_expired: true, can_choose: true, can_reveal: false });

    // เรียกคืนรหัส → ปุ่มดูชื่อผู้ใช้ / รหัสผ่านหายไป, ไม่แจ้งเตือนหมดอายุอีก
    await exec("UPDATE vpn_loans SET expires_on = ? WHERE uuid = ?", [localDay(10), s.loanId]);
    expect((await s.user.post(`/api/v1/vpn-loans/${s.loanId}/revoke`)).status).toBe(403);
    const revoked = await s.staff.post(`/api/v1/vpn-loans/${s.loanId}/revoke`).send({ note: "เปลี่ยนรหัส" });
    expect(revoked.body.data).toMatchObject({ status: "ended", end_note: "เปลี่ยนรหัส", revoked_at: expect.any(String), can_revoke: false });
    // บัญชีกลับคืนคลัง — มอบให้คนอื่นได้
    const holder = (await s.staff.get("/api/v1/vpn-accounts")).body.data.find((a: { id: number }) => a.id === s.account.id);
    expect(holder).toMatchObject({ holder: null });
    expect(await notices(s.userRow.id, "vpn.revoked")).toBe(1);
    const mine = (await s.user.get(`/api/v1/vpn-loans/${s.loanId}`)).body.data;
    expect(mine).toMatchObject({ can_reveal: false, can_choose: false, account: { username: null } });
    expect((await s.user.post(`/api/v1/vpn-loans/${s.loanId}/reveal`).send({ password: "password" })).status).toBe(422);
    await exec("UPDATE vpn_loans SET expires_on = ?, expired_notified_on = NULL WHERE uuid = ?", [localDay(-1), s.loanId]);
    expect(await notifyVpnExpiry()).toBe(0);
  });
});
