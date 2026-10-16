import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { localToday } from "../src/lib/time.js";
import { notifyVpnExpiry } from "../src/services/vpn-loans.js";
import { kpiMonthRows } from "../src/services/kpi.js";
import { SIG, as, localDay, makeUser } from "./helpers.js";

/** ยืม VPN — บัญชีจากคลังบัญชี (หมวด VPN), แจ้งเตือนล่วงหน้า / หมดอายุ, ผู้ใช้เลือก ต่ออายุ / เลิกใช้ → ใบแจ้งงานเข้าคิว IT → KPI */

const notices = (userId: number, type: string) =>
  scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ? AND read_at IS NULL", [userId, type]).then(Number);

async function setup() {
  const managerUser = await makeUser({ name: "เจ้าหน้าที่ IT", is_it_staff: true, is_it_head: true, role: "admin" });
  const userRow = await makeUser({ name: "ผู้ใช้ VPN", department: "ขาย" });
  const manager = await as(managerUser, "th");
  const user = await as(userRow, "th");
  await manager.put("/api/v1/settings").send({ secret_guard: { reauth: false } });
  const vpn1 = (await manager.post("/api/v1/credentials").send({ title: "VPN-01", category: "VPN", username: "vpn01", password: "Vpn-Pass-1" })).body.data;
  const vpn2 = (await manager.post("/api/v1/credentials").send({ title: "VPN-02", category: "vpn", username: "vpn02", password: "Vpn-Pass-2" })).body.data;
  const other = (await manager.post("/api/v1/credentials").send({ title: "Firewall", category: "network", password: "x" })).body.data;
  return { managerUser, userRow, manager, user, vpn1, vpn2, other };
}

async function assigned(s: Awaited<ReturnType<typeof setup>>, expiresIn = 30, notifyDays = 7) {
  const req = await s.user.post("/api/v1/vpn-loans").send({ purpose: "ทำงานจากบ้าน", requested_until: localDay(60) });
  expect(req.status).toBe(201);
  const res = await s.manager.post(`/api/v1/vpn-loans/${req.body.data.id}/assign`).send({
    credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(expiresIn), notify_days_before: notifyDays,
  });
  expect(res.status).toBe(200);
  return res.body.data as { id: string };
}

describe("VPN loans", () => {
  it("request → IT assigns a VPN account from the vault (one holder per account) → the user can reveal the password", async () => {
    const s = await setup();
    const created = await s.user.post("/api/v1/vpn-loans").send({ purpose: "ทำงานจากบ้าน" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "requested", department: "ขาย", account: null, can_cancel: true });
    expect(await notices(s.managerUser.id, "vpn.requested")).toBe(1);
    expect((await s.user.post("/api/v1/vpn-loans").send({ purpose: "อีกครั้ง" })).status).toBe(422); // รอคำขอเดิมอยู่

    // บัญชีที่ให้ได้ = หมวด VPN (ไม่สนตัวพิมพ์)
    const accounts = (await s.manager.get("/api/v1/vpn-accounts")).body.data.map((a: { title: string }) => a.title);
    expect(accounts).toEqual(["VPN-01", "VPN-02"]);
    expect((await s.user.get("/api/v1/vpn-accounts")).status).toBe(403);
    const id = created.body.data.id;
    expect((await s.manager.post(`/api/v1/vpn-loans/${id}/assign`).send({ credential_id: s.other.id, start_on: localToday(), expires_on: localDay(30) })).status).toBe(422);
    const ok = await s.manager.post(`/api/v1/vpn-loans/${id}/assign`).send({ credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(30), notify_days_before: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "active", account: { title: "VPN-01", username: "vpn01" }, days_left: 30, notify_days_before: 5 });
    expect(await notices(s.userRow.id, "vpn.assigned")).toBe(1);

    // บัญชีเดียวกันให้คนที่สองไม่ได้
    const second = await as(await makeUser(), "th");
    const req2 = (await second.post("/api/v1/vpn-loans").send({ purpose: "ประชุม" })).body.data.id;
    const taken = await s.manager.post(`/api/v1/vpn-loans/${req2}/assign`).send({ credential_id: s.vpn1.id, start_on: localToday(), expires_on: localDay(30) });
    expect(taken.status).toBe(422);
    expect(taken.body.errors.credential_id[0]).toContain("ผู้ใช้ VPN");

    // ผู้ยืมเปิดดูรหัสได้ (บันทึกประวัติในคลังบัญชี) — คนอื่นไม่ได้
    const reveal = await s.user.post(`/api/v1/vpn-loans/${id}/reveal`);
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
    expect(await notices(s.managerUser.id, "App\\Notifications\\TicketActivity")).toBe(1);

    // IT รับงาน → บันทึกผลสำเร็จ → ต่ออายุให้อัตโนมัติ
    expect((await s.manager.post(`/api/v1/tickets/${ticketId}/accept`)).status).toBe(200);
    const result = await s.manager.post(`/api/v1/tickets/${ticketId}/result`).send({ result: "completed", completed_on: localToday(), signature: SIG });
    expect(result.status).toBe(200);
    const after = (await s.user.get(`/api/v1/vpn-loans/${loan.id}`)).body.data;
    expect(after).toMatchObject({ status: "active", expires_on: localDay(90), is_expiring: false });
    expect(await notices(s.userRow.id, "vpn.renewed")).toBe(1);

    // ผู้จัดการ IT อนุมัติผล → ขึ้น KPI ของเจ้าหน้าที่ (ประเภท Network Service)
    expect((await s.manager.post(`/api/v1/tickets/${ticketId}/close`).send({ signature: SIG })).status).toBe(200);
    const rows = await kpiMonthRows(s.managerUser.id, localToday().slice(0, 7));
    expect(rows.find((r) => r.ticket?.id === ticketId)).toMatchObject({ service_type: "Network Service" });
  });

  it("cancel → ticket → completed result ends the loan and frees the account; IT can also end or edit directly", async () => {
    const s = await setup();
    const loan = await assigned(s);
    const choice = await s.user.post(`/api/v1/vpn-loans/${loan.id}/choice`).send({ choice: "cancel" });
    expect(choice.body.data.status).toBe("cancel_requested");
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

    const other = await as(await makeUser(), "th");
    const a = (await other.post("/api/v1/vpn-loans").send({ purpose: "a" })).body.data.id;
    expect((await s.manager.post(`/api/v1/vpn-loans/${a}/reject`).send({ note: "" })).status).toBe(422);
    expect((await s.manager.post(`/api/v1/vpn-loans/${a}/reject`).send({ note: "ไม่มีบัญชีว่าง" })).body.data).toMatchObject({ status: "rejected", end_note: "ไม่มีบัญชีว่าง" });
    const b = (await other.post("/api/v1/vpn-loans").send({ purpose: "b" })).body.data.id;
    expect((await other.post(`/api/v1/vpn-loans/${b}/cancel`)).body.data.status).toBe("cancelled");
    expect((await s.manager.get("/api/v1/vpn-loans/manage?status=ended")).body.data).toHaveLength(2);
  });
});
