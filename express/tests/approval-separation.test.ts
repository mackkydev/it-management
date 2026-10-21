import { describe, expect, it } from "vitest";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeBranch, makeUser, SIG } from "./helpers.js";

/**
 * แยกหน้าที่การอนุมัติ:
 * - ใบของตัวเองอนุมัติได้ด้วย tickets.approve_own เท่านั้น (approve_any / การอยู่ในสาย ไม่นับ)
 * - ผู้รับงาน / ผู้ร่วมดำเนินการ อนุมัติผลงานของใบนั้นไม่ได้ ยกเว้นไม่มีผู้อนุมัติผลคนอื่นเลย (audit ticket.self_closed)
 * - กลุ่ม admin (= เจ้าหน้าที่ IT) ไม่ได้สิทธิ์อนุมัติแทน / ลายเซ็นคนอื่น / ตั้งค่าระบบ / PIN กลาง (migration 20261104090000)
 */

async function ticket(attrs: Record<string, unknown>): Promise<{ id: number; uuid: string }> {
  const now = nowDb();
  const uuid = crypto.randomUUID();
  const id = await insert("it_tickets", {
    uuid, ticket_no: `FM-T-${Math.random().toString(36).slice(2, 8)}`, type: "repair", details: "งานทดสอบ",
    requested_at: now, created_at: now, updated_at: now, ...attrs,
  });
  return { id, uuid };
}

const addHelper = (ticketId: number, userId: number) => insert("it_ticket_helpers", { it_ticket_id: ticketId, user_id: userId, created_at: nowDb(), updated_at: nowDb() });

describe("approving your own ticket", () => {
  it("approve_any does not cover your own ticket; approve_own (managers) does", async () => {
    const proxy = await makeUser({ name: "ผู้อนุมัติแทน" });
    await insert("user_permissions", { user_id: proxy.id, permission_id: Number(await scalar("SELECT id FROM permissions WHERE \"key\" = 'tickets.approve_any'")), effect: "allow", created_at: nowDb() });
    const someone = await makeUser();
    const own = await ticket({ requester_id: proxy.id, status: "pending_supervisor" });
    const other = await ticket({ requester_id: someone.id, status: "pending_supervisor" });
    const api = await as(proxy);

    expect((await api.post(`/api/v1/tickets/${own.uuid}/approve`).send({})).status).toBe(403);
    expect((await api.get(`/api/v1/tickets/${own.uuid}`)).body.data.actions).not.toContain("approve");
    // ใบของคนอื่น อนุมัติแทนได้ตามเดิม และใบของตัวเองไม่อยู่ในรายการ "รอฉันอนุมัติ"
    const list = (await api.get("/api/v1/tickets?scope=approvals")).body.data.map((t: { id: string }) => t.id);
    expect(list).toContain(other.uuid);
    expect(list).not.toContain(own.uuid);

    const manager = await makeUser({ role: "manager" });
    const mine = await ticket({ requester_id: manager.id, status: "pending_supervisor" });
    expect((await (await as(manager)).get(`/api/v1/tickets/${mine.uuid}`)).body.data.actions).toContain("approve");

    // admin (เจ้าหน้าที่ IT) ไม่มี approve_own แล้ว
    const admin = await makeUser({ role: "admin" });
    const adminTicket = await ticket({ requester_id: admin.id, status: "pending_supervisor", approver_id: admin.id });
    expect((await (await as(admin)).post(`/api/v1/tickets/${adminTicket.uuid}/approve`).send({})).status).toBe(403);
  });
});

describe("reviewing your own work", () => {
  it("the assignee and co-workers cannot approve the result while another reviewer exists", async () => {
    const head = await makeUser({ is_it_staff: true, is_it_head: true, name: "หัวหน้า IT" });
    const lead = await makeUser({ is_it_staff: true, is_it_head: true, name: "หัวหน้าที่ทำงานเอง" });
    const helper = await makeUser({ is_it_staff: true, is_it_head: true, name: "หัวหน้าที่ช่วยทำ" });
    const requester = await makeUser();
    const t = await ticket({ requester_id: requester.id, status: "pending_it_head", assignee_id: lead.id });
    await addHelper(t.id, helper.id);

    for (const u of [lead, helper]) {
      const api = await as(u);
      expect((await api.get(`/api/v1/tickets/${t.uuid}`)).body.data.actions).not.toContain("close");
      expect((await api.post(`/api/v1/tickets/${t.uuid}/close`).send({ signature: SIG })).status).toBe(403);
      expect((await api.post(`/api/v1/tickets/${t.uuid}/return`).send({ comment: "แก้" })).status).toBe(403);
      expect((await api.get("/api/v1/menu-badges")).body.data["/it/queue"] ?? 0).toBe(0);
    }
    const headApi = await as(head);
    expect((await headApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(1);
    expect((await headApi.post(`/api/v1/tickets/${t.uuid}/close`).send({ signature: SIG })).status).toBe(200);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'ticket.self_closed'")).toBeFalsy();
  });

  it("with no other reviewer the doer may approve; it is audited and noted in the timeline", async () => {
    const lead = await makeUser({ is_it_staff: true, is_it_head: true, name: "หัวหน้าคนเดียว" });
    const requester = await makeUser();
    const t = await ticket({ requester_id: requester.id, status: "pending_it_head", assignee_id: lead.id });
    const api = await as(lead, "th");

    expect((await api.get(`/api/v1/tickets/${t.uuid}`)).body.data.actions).toContain("close");
    expect((await api.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(1);
    expect((await api.post(`/api/v1/tickets/${t.uuid}/close`).send({ signature: SIG, comment: "ตรวจแล้ว" })).status).toBe(200);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'ticket.self_closed' AND subject_id = ?", [t.uuid])).toBeTruthy();
    const event = await first<{ comment: string }>("SELECT comment FROM it_ticket_events WHERE it_ticket_id = ? AND action = 'head_approved'", [t.id]);
    expect(event!.comment).toBe("อนุมัติผลงานที่ตัวเองร่วมทำ (ไม่มีผู้อนุมัติผลคนอื่น) — ตรวจแล้ว");
  });
});

describe("admin (IT staff) defaults", () => {
  it("admin keeps user management but loses approving for others, others' signatures, system settings and the shared PIN", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const perms: string[] = (await admin.get("/api/v1/auth/me")).body.data.permissions;
    for (const key of ["users.create", "users.update", "users.delete", "access.assign", "dropdowns.manage"]) expect(perms).toContain(key);
    for (const key of ["tickets.approve_any", "tickets.approve_own", "leave.approve_any", "signature.use", "secrets.pin_manage", "settings.manage"]) expect(perms).not.toContain(key);

    expect((await admin.get("/api/v1/settings")).status).toBe(403);
    expect((await admin.put("/api/v1/secret-pin").send({ password: "password", pin: "123456", pin_confirmation: "123456" })).status).toBe(403);
    // ตัวเลือกเรื่อง "อื่นๆ" ย้ายมาอยู่กับ dropdowns.manage
    expect((await admin.put("/api/v1/ticket-other-types").send({ items: ["งานออกแบบ", "ขอสิทธิ์ระบบ", "ขอสิทธิ์ระบบ "] })).status).toBe(422);
    const saved = await admin.put("/api/v1/ticket-other-types").send({ items: ["งานออกแบบ", "ขอสิทธิ์ระบบ"] });
    expect(saved.body.data).toEqual(["งานออกแบบ", "ขอสิทธิ์ระบบ"]);
    expect((await admin.get("/api/v1/ticket-other-types")).body.data).toEqual(["งานออกแบบ", "ขอสิทธิ์ระบบ"]);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.ticket_other_types_updated'")).toBeTruthy();
    expect((await (await as(await makeUser())).get("/api/v1/ticket-other-types")).status).toBe(403);
  });

  it("only a super admin can grant the locked keys", async () => {
    const assigner = await as(await makeUser({ role: "admin" }));
    const target = await makeUser();
    const res = await assigner.put(`/api/v1/users/${target.id}/permissions`).send({ overrides: { "settings.manage": "allow" } });
    expect([403, 422]).toContain(res.status);
  });
});

describe("managers approve their own tickets by default (no approver chosen)", () => {
  it("leaving the approver empty sends the ticket to the requester: bell, Awaiting my approval, badge, timeline note", async () => {
    const branch = await makeBranch({ code: "SELF" });
    const boss = await makeUser({ role: "division_manager", branch_id: branch, name: "ผู้จัดการฝ่าย" });
    const managerUser = await makeUser({ role: "manager", branch_id: branch, supervisor_id: boss.id, name: "ผู้จัดการขาย" });
    const root = await makeUser({ role: "super_admin" });
    const manager = await as(managerUser, "th");

    const it_ = await makeUser({ is_it_staff: true });
    const created = await manager.post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "ติดตั้งโปรแกรม", assignee_id: it_.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const row = await first<{ approver_id: number; current_step: number | null }>("SELECT approver_id, current_step FROM it_tickets WHERE uuid = ?", [id]);
    // แบบ ก: อนุมัติเองเสมอ แม้มีหัวหน้าตามสาย — หัวหน้า / super_admin ไม่ได้แจ้งเตือน
    expect(row).toEqual({ approver_id: managerUser.id, current_step: null });
    const submitted = (userId: number) => scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data LIKE '%\"submitted\"%'", [userId]).then(Number);
    expect(await submitted(managerUser.id)).toBe(1);
    expect(await submitted(boss.id)).toBe(0);
    expect(await submitted(root.id)).toBe(0);
    expect((await manager.get("/api/v1/tickets?scope=approvals")).body.data.map((t: { id: string }) => t.id)).toEqual([id]);
    expect((await manager.get("/api/v1/menu-badges")).body.data["/tickets/approvals"]).toBe(1);
    // super_admin (approve_any) ไม่เห็นใบนี้ในรายการรออนุมัติ
    expect((await (await as(root)).get("/api/v1/tickets?scope=approvals")).body.data.map((t: { id: string }) => t.id)).not.toContain(id);

    expect((await manager.post(`/api/v1/tickets/${id}/approve`).send({ comment: "ด่วน" })).status).toBe(200);
    const event = await first<{ comment: string }>("SELECT e.comment FROM it_ticket_events e JOIN it_tickets t ON t.id = e.it_ticket_id WHERE t.uuid = ? AND e.action = 'approved'", [id]);
    expect(event!.comment).toBe("อนุมัติใบแจ้งงานของตัวเอง — ด่วน");
    expect((await manager.get("/api/v1/menu-badges")).body.data["/tickets/approvals"]).toBe(0);
  });

  it("choosing an approver still sends it to that person; staff without approve_own keep the normal route", async () => {
    const branch = await makeBranch({ code: "PICK" });
    const boss = await makeUser({ role: "admin", branch_id: branch }); // ตำแหน่งสูงกว่าผู้จัดการ
    const managerUser = await makeUser({ role: "manager", branch_id: branch });
    const it_ = await makeUser({ is_it_staff: true });
    const created = await (await as(managerUser)).post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "x", approver_id: boss.id, assignee_id: it_.id });
    expect(created.body.errors ?? null).toBeNull();
    expect(Number(await scalar("SELECT approver_id FROM it_tickets WHERE uuid = ?", [created.body.data.id]))).toBe(boss.id);

    const staff = await makeUser({ branch_id: branch, supervisor_id: managerUser.id });
    const own = await (await as(staff)).post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "x", assignee_id: it_.id });
    expect(own.body.errors ?? null).toBeNull();
    expect(Number(await scalar("SELECT approver_id FROM it_tickets WHERE uuid = ?", [own.body.data.id]))).toBe(managerUser.id);
  });
});
