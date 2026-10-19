import { describe, expect, it } from "vitest";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeUser, SIG } from "./helpers.js";

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
