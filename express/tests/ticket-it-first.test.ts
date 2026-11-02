import { afterEach, describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { as, makeBranch, makeUser } from "./helpers.js";

/** ขั้นตอน it_first (ตั้งค่าระบบ ticket_flow): แจ้งงาน → ฝ่าย IT ทันที → IT ขอให้หัวหน้าอนุมัติ → ผู้แจ้งเลือกผู้อนุมัติ → หัวหน้าอนุมัติ → กลับฝ่าย IT */

const notice = (userId: number, event: string) =>
  first("SELECT 1 AS x FROM notifications WHERE notifiable_id = ? AND data LIKE ?", [userId, `%"event":"${event}"%`]);

let root: Awaited<ReturnType<typeof as>> | null = null;
afterEach(async () => {
  await root?.put("/api/v1/settings").send({ ticket_flow: "approval_first" });
});

describe("IT-first ticket flow", () => {
  it("sends new requests straight to IT; IT can ask for a supervisor's approval and the requester then picks the approver", async () => {
    root = await as(await makeUser({ role: "super_admin" }));
    expect((await root.put("/api/v1/settings").send({ ticket_flow: "bogus" })).status).toBe(422);
    expect((await root.put("/api/v1/settings").send({ ticket_flow: "it_first" })).status).toBe(200);

    const branch = await makeBranch({ name: "ลำปาง" });
    const manager = await makeUser({ role: "manager", branch_id: branch, name: "หัวหน้า" });
    const requester = await makeUser({ branch_id: branch, supervisor_id: manager.id });
    const staff = await makeUser({ is_it_staff: true });
    const body = { type: "other", type_other: "งานออกแบบ", branch_id: branch, details: "ออกแบบโปสเตอร์", assignee_id: staff.id };

    const reqApi = await as(requester);
    expect((await reqApi.get("/api/v1/tickets/form-options")).body.data.approval_flow).toBe("it_first");
    // ส่งผู้อนุมัติมาก็ไม่นับ — ถึงฝ่าย IT ทันที
    const created = await reqApi.post("/api/v1/tickets").send({ ...body, approver_id: manager.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "approved", approver: null, approved_at: null });
    expect(created.body.data.actions).toEqual(expect.arrayContaining(["edit", "delete"]));
    const id = created.body.data.id as string;
    expect(await notice(staff.id, "submitted_it")).toBeTruthy();
    expect(await notice(manager.id, "submitted")).toBeNull();

    // IT ขอให้หัวหน้าอนุมัติ (ต้องมีเหตุผล)
    const itApi = await as(staff);
    expect((await itApi.get(`/api/v1/tickets/${id}`)).body.data.actions).toEqual(expect.arrayContaining(["accept", "request_approval"]));
    expect((await itApi.post(`/api/v1/tickets/${id}/request-approval`).send({})).status).toBe(422);
    const asked = await itApi.post(`/api/v1/tickets/${id}/request-approval`).send({ comment: "งานนี้มีค่าใช้จ่าย ต้องให้หัวหน้าอนุมัติ" });
    expect(asked.body.data.status).toBe("approval_requested");
    expect(asked.body.data.actions).not.toContain("accept");
    expect(await notice(requester.id, "approval_requested")).toBeTruthy();

    // ผู้แจ้งต้องเลือกผู้อนุมัติ → รอหัวหน้าอนุมัติ
    expect(Object.keys((await reqApi.put(`/api/v1/tickets/${id}`).send(body)).body.errors)).toEqual(["approver_id"]);
    const chosen = await reqApi.put(`/api/v1/tickets/${id}`).send({ ...body, approver_id: manager.id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data).toMatchObject({ status: "pending_supervisor", approver: { id: manager.id } });
    expect(await notice(manager.id, "submitted")).toBeTruthy();
    // ระหว่างรออนุมัติ ฝ่าย IT ยังไม่เห็น (ตามกติกาเดิม)
    expect((await itApi.get(`/api/v1/tickets/${id}`)).status).toBe(403);

    // หัวหน้าอนุมัติ → กลับมาที่ผู้รับงานเดิม
    const approved = await (await as(manager)).post(`/api/v1/tickets/${id}/approve`).send({ comment: "ok" });
    expect(approved.body.data.status).toBe("approved");
    const again = (await itApi.get(`/api/v1/tickets/${id}`)).body.data;
    expect(again.assignee.id).toBe(staff.id);
    expect(again.actions).toContain("accept");
    expect(again.actions).not.toContain("request_approval");
    expect((await itApi.post(`/api/v1/tickets/${id}/accept`)).body.data.status).toBe("in_progress");
    expect(await scalar("SELECT COUNT(*) FROM it_ticket_events e JOIN it_tickets t ON t.id = e.it_ticket_id WHERE t.uuid = ? AND e.action IN ('approval_requested', 'approval_submitted')", [id])).toBe(2);
  });

  it("keeps the supervisor-first flow when the setting is approval_first (default)", async () => {
    const branch = await makeBranch();
    const manager = await makeUser({ role: "manager", branch_id: branch });
    const requester = await makeUser({ branch_id: branch, supervisor_id: manager.id });
    const staff = await makeUser({ is_it_staff: true });
    const res = await (await as(requester)).post("/api/v1/tickets").send({ type: "other", type_other: "x", branch_id: branch, details: "x", assignee_id: staff.id });
    expect(res.body.data.status).toBe("pending_supervisor");
    expect((await (await as(staff)).post(`/api/v1/tickets/${res.body.data.id}/request-approval`).send({ comment: "x" })).status).toBe(403);
  });
});
