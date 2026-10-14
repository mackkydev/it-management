import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { notifyUsers, TICKET_ACTIVITY } from "../src/services/notifications.js";
import { as, makeUser } from "./helpers.js";

/** คิวงานของฉัน / คิวงาน IT: โยนงาน, รับงานแทน — และผู้จัดการขึ้นไปอนุมัติใบของตัวเอง */

let seq = 0;
const ticket = async (attrs: Record<string, unknown>) => {
  const uuid = crypto.randomUUID();
  await insert("it_tickets", {
    uuid, ticket_no: `FM-ITR-01-2026-${String(++seq).padStart(5, "0")}`, type: "repair", status: "approved",
    details: "-", requested_at: nowDb(), created_at: nowDb(), updated_at: nowDb(), ...attrs,
  });
  return uuid;
};
const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((t) => t.id);
const notices = async (userId: number, event: string) =>
  Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.event')) = ?", [userId, event]));

describe("IT queue: my queue, forwarding and taking over", () => {
  it("the assignee forwards a ticket to other IT staff; others take over from the IT queue and the original drops off menus and KPI", async () => {
    const requester = await makeUser({ name: "ผู้แจ้ง" });
    const somchai = await makeUser({ name: "สมชาย", is_it_staff: true });
    const somying = await makeUser({ name: "สมหญิง", is_it_staff: true });
    const viewer = await makeUser();
    const uuid = await ticket({ requester_id: requester.id, assignee_id: somchai.id });
    await notifyUsers([somchai.id], TICKET_ACTIVITY, { kind: "ticket", event: "approved", ticket_id: uuid });
    const [a, b, v] = [await as(somchai, "th"), await as(somying, "th"), await as(viewer)];
    const badge = async (api: typeof a) => (await api.get("/api/v1/menu-badges")).body.data["/it/tickets"];

    // คิวงานของฉัน = เฉพาะใบของตัวเอง / คิวงาน IT = ทุกใบ
    expect(ids(await a.get("/api/v1/tickets?scope=it_mine"))).toEqual([uuid]);
    expect(ids(await b.get("/api/v1/tickets?scope=it_mine"))).toEqual([]);
    expect(ids(await b.get("/api/v1/tickets?scope=it"))).toEqual([uuid]);
    expect((await v.get("/api/v1/tickets?scope=it_mine")).status).toBe(403);
    expect((await a.get("/api/v1/tickets?scope=it_mine")).body.counts).toMatchObject({ my_new: 1, my_in_progress: 0 });
    const detail = (await a.get(`/api/v1/tickets/${uuid}`)).body.data;
    expect(detail.actions).toEqual(expect.arrayContaining(["accept", "forward"]));
    expect(detail.forward_options.map((o: { id: number }) => o.id)).toContain(somying.id);
    expect(detail.forward_options.map((o: { id: number }) => o.id)).not.toContain(somchai.id);

    // โยนงานให้สมหญิง → สมชายหลุดจากใบนี้ (แจ้งเตือนเดิมอ่านแล้ว), สมหญิง + ผู้แจ้งได้แจ้งเตือน
    expect((await v.post(`/api/v1/tickets/${uuid}/forward`).send({ assignee_id: somying.id })).status).toBe(403);
    expect((await a.post(`/api/v1/tickets/${uuid}/forward`).send({ assignee_id: somchai.id })).status).toBe(422);
    expect((await a.post(`/api/v1/tickets/${uuid}/forward`).send({ assignee_id: viewer.id })).status).toBe(422);
    const fwd = await a.post(`/api/v1/tickets/${uuid}/forward`).send({ assignee_id: somying.id, comment: "งานเครือข่าย" });
    expect(fwd.status).toBe(200);
    expect(fwd.body.data).toMatchObject({ status: "approved", assignee: { id: somying.id } });
    expect(fwd.body.data.events.at(-1)).toMatchObject({ action: "forwarded", comment: "สมหญิง — งานเครือข่าย" });
    expect(await notices(somchai.id, "approved")).toBe(0);
    expect(await notices(somying.id, "forwarded")).toBe(1);
    expect(await notices(requester.id, "forwarded")).toBe(1);
    expect(await badge(a)).toBe(0);
    expect(await badge(b)).toBe(1);
    expect(ids(await a.get("/api/v1/tickets?scope=it_mine"))).toEqual([]);

    // สมหญิงลา — สมชายรับงานแทนจากคิวงาน IT → สมหญิงไม่มีงานในเมนู / KPI
    const took = await a.post(`/api/v1/tickets/${uuid}/accept`).send({});
    expect(took.status).toBe(200);
    expect(took.body.data).toMatchObject({ status: "in_progress", assignee: { id: somchai.id } });
    expect(took.body.data.events.at(-1)).toMatchObject({ action: "accepted", comment: "รับงานแทน สมหญิง" });
    expect(await notices(somying.id, "forwarded")).toBe(0);
    expect(await badge(b)).toBe(0);
    expect(await badge(a)).toBe(1);
    // KPI: ขึ้นหลังผู้จัดการ IT อนุมัติผล — เป็นของผู้รับงานแทนเท่านั้น
    expect((await a.get("/api/v1/menu-badges")).body.data["/kpi"]).toBe(0);
    await exec("UPDATE it_tickets SET status = 'pending_requester' WHERE uuid = ?", [uuid]);
    expect((await b.get("/api/v1/menu-badges")).body.data["/kpi"]).toBe(0);
    expect((await a.get("/api/v1/menu-badges")).body.data["/kpi"]).toBe(1);
    await exec("UPDATE it_tickets SET status = 'in_progress' WHERE uuid = ?", [uuid]);
    // รับแล้วโยนต่อไม่ได้
    expect((await a.post(`/api/v1/tickets/${uuid}/forward`).send({ assignee_id: somying.id })).status).toBe(403);
  });
});

describe("self-approval", () => {
  it("managers and above approve their own tickets; regular staff cannot; own tickets are not counted as waiting for approval", async () => {
    const boss = await makeUser({ role: "division_manager" });
    const manager = await makeUser({ role: "manager", supervisor_id: boss.id });
    const worker = await makeUser({ supervisor_id: manager.id });
    const mine = await ticket({ requester_id: manager.id, status: "pending_supervisor", approver_id: boss.id });
    const theirs = await ticket({ requester_id: worker.id, status: "pending_supervisor", approver_id: manager.id });
    const [m, w] = [await as(manager), await as(worker)];

    expect((await m.get(`/api/v1/tickets/${mine}`)).body.data.actions).toContain("approve");
    expect((await w.get(`/api/v1/tickets/${theirs}`)).body.data.actions).not.toContain("approve");
    expect((await w.post(`/api/v1/tickets/${theirs}/approve`).send({})).status).toBe(403);
    // รอฉันอนุมัติ = ใบของลูกน้องเท่านั้น (ใบของตัวเองอนุมัติจากหน้าใบงาน)
    expect(ids(await m.get("/api/v1/tickets?scope=approvals"))).toEqual([theirs]);
    expect((await m.get("/api/v1/menu-badges")).body.data["/tickets/approvals"]).toBe(1);

    const ok = await m.post(`/api/v1/tickets/${mine}/approve`).send({ comment: "อนุมัติเอง" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "approved", approver: { id: manager.id } });
    expect(await first("SELECT 1 AS x FROM it_ticket_events e JOIN it_tickets t ON t.id = e.it_ticket_id WHERE t.uuid = ? AND e.action = 'approved' AND e.user_id = ?", [mine, manager.id])).toBeTruthy();
  });
});
