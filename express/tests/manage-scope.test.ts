import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exec, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeBranch, makeUser } from "./helpers.js";

/**
 * ขอบเขตการจัดการตามสาขาต่อกลุ่ม (app_settings.manage_scope — services/manage-scope.ts)
 * เช่น กลุ่ม "HR สาขา" ดูใบลา / อนุมัติลาแทน / วันหยุด / จัดการผู้ใช้ ได้เฉพาะสาขาตัวเอง
 */

const HR_KEYS = ["users.view", "users.update", "leave.view_all", "leave.approve_any", "holidays.manage"];

async function setup() {
  const root = await as(await makeUser({ role: "super_admin" }), "th");
  const bkk = await makeBranch({ code: "BKK", name: "กรุงเทพ" });
  const srb = await makeBranch({ code: "SRB", name: "สระบุรี" });
  const group = (await root.post("/api/v1/permission-groups").send({ name_th: "HR สาขา", name_en: "Branch HR" })).body.data.key as string;
  expect((await root.put(`/api/v1/permissions/roles/${group}`).send({ keys: HR_KEYS })).status).toBe(200);
  expect((await root.put("/api/v1/manage-scope").send({ scopes: { [group]: "branch" } })).status).toBe(200);
  const hrUser = await makeUser({ branch_id: srb, name: "HR สระบุรี" });
  await exec("INSERT INTO user_groups (user_id, group_key, created_at) VALUES (?, ?, ?)", [hrUser.id, group, nowDb()]);
  const hr = await as(hrUser, "th");
  const mine = await makeUser({ branch_id: srb, name: "พนักงานสระบุรี" });
  const other = await makeUser({ branch_id: bkk, name: "พนักงานกรุงเทพ" });
  return { root, bkk, srb, group, hr, hrUser, mine, other };
}

async function leaveOf(userId: number) {
  const uuid = randomUUID();
  const now = nowDb();
  await insert("leave_requests", { uuid, user_id: userId, leave_type: "personal", unit: "full", start_on: "2099-03-02", end_on: "2099-03-02", days: 1, status: "pending", created_at: now, updated_at: now });
  return uuid;
}

describe("branch-scoped management (manage_scope)", () => {
  it("branch HR sees and approves only their branch's leave", async () => {
    const { hr, mine, other } = await setup();
    const a = await leaveOf(mine.id);
    const b = await leaveOf(other.id);

    const all = (await hr.get("/api/v1/leave?scope=all")).body.data.map((l: { id: string }) => l.id);
    expect(all).toContain(a);
    expect(all).not.toContain(b);
    const pending = (await hr.get("/api/v1/leave/approvals")).body.data.map((l: { id: string }) => l.id);
    expect(pending).toEqual([a]);

    expect((await hr.get(`/api/v1/leave/${b}`)).status).toBe(404);
    expect((await hr.post(`/api/v1/leave/${b}/approve`).send({})).status).toBe(404);
    expect((await hr.post(`/api/v1/leave/${a}/approve`).send({})).status).toBe(200);
    expect(await scalar("SELECT status FROM leave_requests WHERE uuid = ?", [a])).toBe("approved");
  });

  it("branch HR manages only users of their branch and cannot move them elsewhere", async () => {
    const { hr, mine, other, bkk } = await setup();
    const list = (await hr.get("/api/v1/users?manage=1&per_page=100")).body.data.map((u: { id: number }) => u.id);
    expect(list).toContain(mine.id);
    expect(list).not.toContain(other.id);
    expect((await hr.get(`/api/v1/users/${other.id}`)).status).toBe(404);
    expect((await hr.patch(`/api/v1/users/${other.id}`).send({ name: "x" })).status).toBe(404);
    expect((await hr.patch(`/api/v1/users/${mine.id}`).send({ name: "ชื่อใหม่" })).status).toBe(200);
    const moved = await hr.patch(`/api/v1/users/${mine.id}`).send({ branch_id: bkk });
    expect(moved.status).toBe(422);
    expect(moved.body.errors.branch_id[0]).toContain("สาขา");
  });

  it("branch HR edits only their branch's holiday calendar; leave settings and calendars stay company-wide", async () => {
    const { root, hr, srb, bkk, mine, other } = await setup();
    const now = nowDb();
    const srbCal = await insert("holiday_calendars", { name: "สาขาสระบุรี", is_default: false, sort_order: 50, created_at: now, updated_at: now });
    const bkkCal = await insert("holiday_calendars", { name: "สาขากรุงเทพ", is_default: false, sort_order: 51, created_at: now, updated_at: now });
    await exec("UPDATE branches SET holiday_calendar_id = ? WHERE id = ?", [srbCal, srb]);
    await exec("UPDATE branches SET holiday_calendar_id = ? WHERE id = ?", [bkkCal, bkk]);

    expect((await hr.post("/api/v1/holidays").send({ calendar_id: srbCal, date: "2099-04-13", name: "สงกรานต์" })).status).toBe(201);
    const blocked = await hr.post("/api/v1/holidays").send({ calendar_id: bkkCal, date: "2099-04-13", name: "สงกรานต์" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors.calendar_id[0]).toContain("สาขา");
    expect((await hr.get(`/api/v1/holidays?calendar_id=${bkkCal}&year=2099`)).body.meta).toMatchObject({ can_manage: false, can_manage_all: false });
    expect((await hr.get(`/api/v1/holidays?calendar_id=${srbCal}&year=2099`)).body.meta).toMatchObject({ can_manage: true, can_manage_all: false });

    expect((await hr.put("/api/v1/leave/settings").send({ quotas: {}, sick_cert_days: 3, work_days: [1, 2, 3, 4, 5] })).status).toBe(403);
    expect((await hr.post("/api/v1/holiday-calendars").send({ name: "ใหม่" })).status).toBe(403);
    expect((await hr.put("/api/v1/leave/quotas").send({ user_id: mine.id, year: 2099, leave_type: "vacation", days: 8 })).status).toBe(200);
    expect((await hr.put("/api/v1/leave/quotas").send({ user_id: other.id, year: 2099, leave_type: "vacation", days: 8 })).status).toBe(422);

    // ทุกสาขา (ค่าตั้งต้นเมื่อไม่ตั้ง) = เหมือนเดิม
    expect((await root.put("/api/v1/manage-scope").send({ scopes: {} })).status).toBe(200);
    expect((await hr.post("/api/v1/holidays").send({ calendar_id: bkkCal, date: "2099-04-14", name: "สงกรานต์" })).status).toBe(201);
  });

  it("the scope comes from the groups that grant the permission — a role group with the same key widens it", async () => {
    const { root, hrUser, hr, other } = await setup();
    const b = await leaveOf(other.id);
    expect((await hr.get(`/api/v1/leave/${b}`)).status).toBe(404);
    // ตำแหน่งพนักงาน (viewer) ได้ leave.view_all ด้วย และกลุ่ม viewer ไม่ได้จำกัด = ทุกสาขา
    const keys = (await root.get("/api/v1/permissions")).body.role_permissions.viewer as string[];
    expect((await root.put("/api/v1/permissions/roles/viewer").send({ keys: [...keys, "leave.view_all"] })).status).toBe(200);
    expect(hrUser.role).toBe("viewer");
    expect((await hr.get(`/api/v1/leave/${b}`)).status).toBe(200);
  });

  it("admins set the scope only for groups below them; changes are audited", async () => {
    const { group } = await setup();
    const admin = await as(await makeUser({ role: "admin" }));
    const res = await admin.put("/api/v1/manage-scope").send({ scopes: { [group]: "all", manager: "branch", admin: "branch" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ [group]: "all", manager: "branch" });
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'manage_scope.updated'"))).toBe(2);
    expect((await (await as(await makeUser({ role: "manager" }))).put("/api/v1/manage-scope").send({ scopes: {} })).status).toBe(403);
    expect((await admin.put("/api/v1/manage-scope").send({ scopes: { manager: "region" } })).status).toBe(422);
  });
});
