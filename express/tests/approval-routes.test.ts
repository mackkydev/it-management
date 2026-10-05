import { beforeEach, describe, expect, it } from "vitest";
import { scalar } from "../src/db.js";
import type { UserRow } from "../src/models/user.js";
import { as, makeBranch, makeUser } from "./helpers.js";

/** สายอนุมัติใบแจ้งงาน — ตรงกับ ApprovalRouteTest ของ Laravel */
let kkn: number;
let bkk: number;
let admin: UserRow;
let staff: UserRow;
let lead1: UserRow;
let lead2: UserRow;
let manager: UserRow;
let chief: UserRow;
let itUser: UserRow;

const unread = async (u: UserRow) =>
  Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL", [u.id]));

beforeEach(async () => {
  kkn = await makeBranch({ code: "KKN", name: "ขอนแก่น" });
  bkk = await makeBranch({ code: "BKK", name: "กรุงเทพ" });
  admin = await makeUser({ name: "Admin", role: "admin" });
  chief = await makeUser({ name: "Chief" });
  staff = await makeUser({ name: "Staff", branch_id: kkn, department: "ขาย", supervisor_id: chief.id });
  lead1 = await makeUser({ name: "Lead A" });
  lead2 = await makeUser({ name: "Lead B" });
  manager = await makeUser({ name: "Manager" });
  itUser = await makeUser({ name: "IT", is_it_staff: true });
});

const route = (body: Record<string, unknown>) => as(admin).then((api) => api.post("/api/v1/approval-routes").send(body));

const twoSteps = (extra: Record<string, unknown> = {}) => ({
  name: "KKN ขาย",
  branch_id: kkn,
  department: " ขาย ",
  steps: [
    { name: "หัวหน้าแผนก", approver_ids: [lead1.id, lead2.id] },
    { name: "ผู้จัดการสาขา", approver_ids: [manager.id] },
  ],
  ...extra,
});

async function submit(u: UserRow = staff): Promise<string> {
  const res = await (await as(u)).post("/api/v1/tickets").send({ type: "install", branch_id: kkn, details: "ติดตั้งโปรแกรม", assignee_id: itUser.id });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe("approval routes", () => {
  it("admin only CRUD with validation", async () => {
    expect((await (await as(staff)).get("/api/v1/approval-routes")).status).toBe(403);
    expect((await (await as(staff)).post("/api/v1/approval-routes").send(twoSteps())).status).toBe(403);

    const bad = await route({ name: "", steps: [{ name: "", approver_ids: [] }] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.name).toBeDefined();
    expect(bad.body.errors["steps.0.name"][0]).toBe("กรุณากรอกชื่อขั้น");
    expect(bad.body.errors["steps.0.approver_ids"][0]).toBe("เลือกผู้อนุมัติอย่างน้อย 1 คน");
    expect((await route({ name: "x", steps: [] })).body.errors.steps[0]).toBe("ต้องมีอย่างน้อย 1 ขั้น");

    const created = await route(twoSteps());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "KKN ขาย",
      branch: { id: kkn, name: "ขอนแก่น" },
      department: "ขาย",
      is_active: true,
      users_count: 0,
    });
    expect(created.body.data.steps.map((s: { step_no: number; approvers: unknown[] }) => [s.step_no, s.approvers.length])).toEqual([[1, 2], [2, 1]]);

    // ขอบเขตเดียวกันซ้ำไม่ได้ (แผนกไม่สนตัวพิมพ์/ช่องว่าง) — ปิดใช้งานแล้วซ้ำได้
    const dup = await route(twoSteps({ department: "ขาย" }));
    expect(dup.status).toBe(422);
    expect(dup.body.errors.department[0]).toBe("มีสายอนุมัติที่เปิดใช้งานสำหรับสาขาและแผนกนี้อยู่แล้ว");
    expect((await route(twoSteps({ is_active: false }))).status).toBe(201);

    const api = await as(admin);
    const id = created.body.data.id;
    const edited = await api.put(`/api/v1/approval-routes/${id}`).send(twoSteps({ name: "แก้ชื่อ", steps: [{ name: "ขั้นเดียว", approver_ids: [manager.id] }] }));
    expect(edited.status).toBe(200);
    expect(edited.body.data.steps).toHaveLength(1);
    expect((await api.get("/api/v1/approval-routes/departments")).body.data).toEqual(["ขาย"]);
    expect((await api.delete(`/api/v1/approval-routes/${id}`)).status).toBe(204);
    expect((await api.get(`/api/v1/approval-routes/${id}`)).status).toBe(404);
  });

  it("matches routes by priority: user > branch+dept > branch > dept > default > legacy", async () => {
    const api = await as(admin);
    const resolve = async () => (await api.get(`/api/v1/approval-routes/resolve?user_id=${staff.id}`)).body.data;
    const step = (id: number) => [{ name: "ขั้น", approver_ids: [id] }];

    expect(await resolve()).toMatchObject({ source: "legacy", route: null, steps: [], legacy_approver: { id: chief.id } });
    const def = (await route({ name: "ตั้งต้น", steps: step(manager.id) })).body.data.id;
    expect((await resolve()).source).toBe("default");
    await route({ name: "ฝ่ายขายทุกสาขา", department: "ขาย", steps: step(manager.id) });
    expect((await resolve()).source).toBe("department");
    await route({ name: "KKN", branch_id: kkn, steps: step(manager.id) });
    expect((await resolve()).source).toBe("branch");
    await route({ name: "BKK ขาย", branch_id: bkk, department: "ขาย", steps: step(manager.id) });
    expect((await resolve()).source).toBe("branch"); // คนละสาขา
    await route({ name: "KKN ขาย", branch_id: kkn, department: "ขาย", steps: step(manager.id) });
    expect(await resolve()).toMatchObject({ source: "branch_department", route: { name: "KKN ขาย" } });

    expect((await api.put(`/api/v1/users/${staff.id}`).send({ approval_route_id: def })).status).toBe(200);
    expect(await resolve()).toMatchObject({ source: "user", route: { id: def } });

    // ผู้ใช้ทั่วไปดูแผนของตัวเองได้ แต่ดูของคนอื่นไม่ได้
    expect((await (await as(staff)).get("/api/v1/approval-routes/resolve")).body.data.source).toBe("user");
    expect((await (await as(staff)).get(`/api/v1/approval-routes/resolve?user_id=${admin.id}`)).status).toBe(403);
  });

  it("two-step approval: anyone in the step approves, then the next step", async () => {
    await route(twoSteps());
    const id = await submit();
    expect(await unread(lead1)).toBe(1);
    expect(await unread(lead2)).toBe(1);
    expect(await unread(manager)).toBe(0);
    expect(await unread(chief)).toBe(0); // ไม่ใช้ระบบเดิมแล้ว

    const managerApi = await as(manager);
    expect((await managerApi.post(`/api/v1/tickets/${id}/approve`)).status).toBe(403); // ยังไม่ถึงขั้นของตัวเอง
    expect((await managerApi.get("/api/v1/tickets?scope=approvals")).body.counts.approvals).toBe(0);
    const lead2Api = await as(lead2);
    expect((await lead2Api.get("/api/v1/tickets?scope=approvals")).body.counts.approvals).toBe(1);

    const step1 = await lead2Api.post(`/api/v1/tickets/${id}/approve`).send({ comment: "ok" });
    expect(step1.status).toBe(200);
    expect(step1.body.data).toMatchObject({ status: "pending_supervisor", current_step: 2 });
    expect(step1.body.data.approval_steps[0]).toMatchObject({ status: "approved", acted_by: { id: lead2.id }, comment: "ok" });
    expect(await unread(manager)).toBe(1);
    expect((await (await as(lead1)).post(`/api/v1/tickets/${id}/approve`)).status).toBe(403); // ขั้น 1 จบแล้ว

    const done = await managerApi.post(`/api/v1/tickets/${id}/approve`);
    expect(done.body.data).toMatchObject({ status: "approved", current_step: null, approver: { id: manager.id } });
    expect(done.body.data.approval_steps.map((s: { status: string }) => s.status)).toEqual(["approved", "approved"]);
    expect(done.body.data.events.map((e: { action: string }) => e.action)).toEqual(["submitted", "step_approved", "approved"]);
    // ผู้อนุมัติทุกขั้นยังเปิดดูใบงานได้
    expect((await (await as(lead1)).get(`/api/v1/tickets/${id}`)).status).toBe(200);
  });

  it("reject at any step ends the request", async () => {
    await route(twoSteps());
    const id = await submit();
    const res = await (await as(lead1)).post(`/api/v1/tickets/${id}/reject`).send({ comment: "ไม่จำเป็น" });
    expect(res.body.data).toMatchObject({ status: "rejected", current_step: null });
    expect(res.body.data.approval_steps.map((s: { status: string }) => s.status)).toEqual(["rejected", "pending"]);
  });

  it("requester and inactive users are removed; empty steps are skipped", async () => {
    await route(twoSteps({ steps: [{ name: "หัวหน้า", approver_ids: [staff.id] }, { name: "ผู้จัดการ", approver_ids: [manager.id] }] }));
    const id = await submit();
    const t = (await (await as(manager)).get(`/api/v1/tickets/${id}`)).body.data;
    expect(t.current_step).toBe(2);
    expect(t.approval_steps.map((s: { status: string }) => s.status)).toEqual(["skipped", "pending"]);
    expect(t.approval_steps[0].approvers).toEqual([]);

    // ทุกขั้นไม่เหลือผู้อนุมัติ → ระบบเดิม (หัวหน้าตามสาย)
    await (await as(admin)).put(`/api/v1/users/${manager.id}`).send({ is_active: false });
    const legacy = await submit();
    const lt = (await (await as(chief)).get(`/api/v1/tickets/${legacy}`)).body.data;
    expect(lt).toMatchObject({ current_step: null, approval_steps: [], approver: { id: chief.id } });
  });

  it("editing a route does not change tickets already submitted", async () => {
    const created = await route(twoSteps());
    const id = await submit();
    await (await as(admin)).put(`/api/v1/approval-routes/${created.body.data.id}`).send(twoSteps({ steps: [{ name: "ใหม่", approver_ids: [manager.id] }] }));
    const lead1Api = await as(lead1);
    expect((await lead1Api.get(`/api/v1/tickets/${id}`)).body.data.approval_steps).toHaveLength(2);
    expect((await lead1Api.post(`/api/v1/tickets/${id}/approve`)).status).toBe(200);
  });

  it("legacy tickets (no route) still use the supervisor", async () => {
    const id = await submit();
    expect(await unread(chief)).toBe(1);
    expect((await (await as(lead1)).post(`/api/v1/tickets/${id}/approve`)).status).toBe(403);
    const res = await (await as(chief)).post(`/api/v1/tickets/${id}/approve`);
    expect(res.body.data).toMatchObject({ status: "approved", approval_steps: [] });
  });
});

describe("approver chosen by the requester", () => {
  const send = (u: UserRow, body: Record<string, unknown>) =>
    as(u).then((api) => api.post("/api/v1/tickets").send({ type: "install", branch_id: kkn, details: "ติดตั้งโปรแกรม", assignee_id: itUser.id, ...body }));

  it("form options list only higher positions; the branch filter is checked on submit", async () => {
    const head = await makeUser({ name: "KKN Head", role: "division_manager", branch_id: kkn });
    const boss = await makeUser({ name: "KKN Manager", role: "manager", branch_id: kkn });
    const bkkHead = await makeUser({ name: "BKK Head", role: "division_manager", branch_id: bkk });
    await makeUser({ name: "KKN Peer", branch_id: kkn });
    await makeUser({ name: "Off", role: "manager", branch_id: kkn, is_active: false });

    const forStaff = (await (await as(staff)).get("/api/v1/tickets/form-options")).body.data.approvers.map((a: { name: string }) => a.name);
    expect(forStaff).toEqual(["BKK Head", "KKN Head", "KKN Manager"]);
    const forHead = (await (await as(head)).get("/api/v1/tickets/form-options")).body.data.approvers.map((a: { name: string }) => a.name);
    expect(forHead).toEqual(["KKN Manager"]);

    const wrongBranch = await send(staff, { approver_id: bkkHead.id });
    expect(wrongBranch.status).toBe(422);
    expect(wrongBranch.body.errors.approver_id[0]).toBe("ผู้อนุมัติต้องอยู่สาขาที่เลือกและมีตำแหน่งสูงกว่าผู้แจ้ง");
    expect((await send(head, { approver_id: (await makeUser({ role: "division_manager", branch_id: kkn })).id })).status).toBe(422);
    expect((await send(staff, { approver_id: boss.id })).status).toBe(201);

    // เจ้าหน้าที่ IT ต้องระบุคน
    const noAssignee = await send(staff, { assignee_id: null });
    expect(noAssignee.status).toBe(422);
    expect(noAssignee.body.errors).toHaveProperty("assignee_id");
  });

  it("replaces the first step of the route; later steps stay", async () => {
    await route(twoSteps());
    const boss = await makeUser({ name: "KKN Manager", role: "manager", branch_id: kkn });
    const res = await send(staff, { approver_id: boss.id });
    expect(res.status).toBe(201);
    expect(res.body.data.approval_steps.map((s: { approvers: { name: string }[] }) => s.approvers.map((a) => a.name))).toEqual([["KKN Manager"], ["Manager"]]);
    expect(await unread(boss)).toBe(1);
    expect(await unread(lead1)).toBe(0);
    expect((await (await as(lead1)).post(`/api/v1/tickets/${res.body.data.id}/approve`)).status).toBe(403);
    expect((await (await as(boss)).post(`/api/v1/tickets/${res.body.data.id}/approve`)).status).toBe(200);
  });

  it("without a route the chosen person is the single approver; editing changes it and notifies", async () => {
    const head = await makeUser({ name: "KKN Head", role: "division_manager", branch_id: kkn });
    const boss = await makeUser({ name: "KKN Manager", role: "manager", branch_id: kkn });
    const res = await send(staff, { approver_id: head.id });
    expect(res.body.data).toMatchObject({ approver: { name: "KKN Head" }, approval_steps: [] });
    expect(await unread(chief)).toBe(0);

    const id = res.body.data.id;
    const edited = await (await as(staff)).put(`/api/v1/tickets/${id}`).send({ type: "install", branch_id: kkn, details: "x", assignee_id: itUser.id, approver_id: boss.id });
    expect(edited.body.data.approver).toMatchObject({ name: "KKN Manager" });
    expect(await unread(boss)).toBe(1);
    expect((await (await as(head)).post(`/api/v1/tickets/${id}/approve`)).status).toBe(403);
  });
});
