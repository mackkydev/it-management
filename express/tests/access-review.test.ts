import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { as, localDay, makeUser } from "./helpers.js";

/** หน้าตรวจสอบสิทธิ์ (/access-review): สมาชิกกลุ่ม (เพิ่ม/แก้วันหมดอายุ/เอาออก) + รายงานการมอบสิทธิ์รายคน */

async function customGroup(root: Awaited<ReturnType<typeof as>>, keys: string[], name = "ฝ่ายบุคคล") {
  const group = (await root.post("/api/v1/permission-groups").send({ name_th: name, name_en: `${name} EN` })).body.data;
  expect((await root.put(`/api/v1/permissions/roles/${group.key}`).send({ keys })).status).toBe(200);
  return group.key as string;
}

describe("group members", () => {
  it("lists, adds (with expiry), edits and removes members — audited per user, with the usual grant rules", async () => {
    const root = await as(await makeUser({ role: "super_admin" }), "th");
    const key = await customGroup(root, ["holidays.manage"]);
    const admin = await as(await makeUser({ role: "admin", name: "แอดมิน" }), "th");
    const a = await makeUser({ name: "ก" });
    const b = await makeUser({ name: "ข" });

    // เพิ่ม 2 คน พร้อมวันหมดอายุ (admin มี holidays.manage จึงมอบกลุ่มนี้ได้)
    const added = await admin.post(`/api/v1/permission-groups/${key}/members`).send({ user_ids: [a.id, b.id], expires_on: localDay(30) });
    expect(added.status).toBe(201);
    expect(added.body.data.added).toBe(2);
    const view = (await admin.get(`/api/v1/permission-groups/${key}/members`)).body.data;
    expect(view.members.map((m: { user: { name: string } }) => m.user.name)).toEqual(["ก", "ข"]);
    expect(view.members[0]).toMatchObject({ expires_on: localDay(30), expired: false, can_edit: true, granted_by: { name: "แอดมิน" } });
    expect(view.user_options.map((o: { id: number }) => o.id)).not.toContain(a.id);
    expect((await (await as(a)).get("/api/v1/auth/me")).body.data.permissions).toContain("holidays.manage");

    // แก้วันหมดอายุ (ย้อนหลังไม่ได้) / เอาออก
    expect((await admin.patch(`/api/v1/permission-groups/${key}/members/${a.id}`).send({ expires_on: localDay(-3) })).status).toBe(422);
    expect((await admin.patch(`/api/v1/permission-groups/${key}/members/${a.id}`).send({ expires_on: null })).status).toBe(204);
    expect(await scalar("SELECT expires_on FROM user_groups WHERE user_id = ? AND group_key = ?", [a.id, key])).toBeNull();
    expect((await admin.delete(`/api/v1/permission-groups/${key}/members/${b.id}`)).status).toBe(204);
    expect(await scalar("SELECT COUNT(*) FROM user_groups WHERE group_key = ?", [key])).toBe(1);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'user.permissions_updated'"))).toBe(4);

    // คนที่ไม่มี access.assign / super_admin group / กลุ่มที่มีสิทธิ์ที่ตัวเองไม่มี
    expect((await (await as(a)).get(`/api/v1/permission-groups/${key}/members`)).status).toBe(403);
    expect((await admin.get("/api/v1/permission-groups/super_admin/members")).status).toBe(404);
    const locked = await customGroup(root, ["settings.manage"], "ตั้งค่าระบบ");
    const lockedView = (await admin.get(`/api/v1/permission-groups/${locked}/members`)).body.data;
    expect(lockedView).toMatchObject({ can_manage: false, user_options: [] });
    expect((await admin.post(`/api/v1/permission-groups/${locked}/members`).send({ user_ids: [b.id] })).status).toBe(422);
  });

  it("role groups show who is in them by role (read only) next to added members", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const m = await makeUser({ role: "manager", name: "ผู้จัดการ" });
    const view = (await admin.get("/api/v1/permission-groups/manager/members")).body.data;
    expect(view.group).toMatchObject({ key: "manager", is_system: true });
    expect(view.role_members.map((x: { id: number }) => x.id)).toContain(m.id);
  });
});

describe("per-user grants report", () => {
  it("lists every extra group and allow/deny override with who granted it, expiry and whether you can revoke it", async () => {
    const root = await as(await makeUser({ role: "super_admin" }), "th");
    const key = await customGroup(root, ["holidays.manage"]);
    const adminUser = await makeUser({ role: "admin", name: "แอดมิน" });
    const admin = await as(adminUser, "th");
    const person = await makeUser({ name: "คนพิเศษ" });
    await admin.put(`/api/v1/users/${person.id}/permissions`).send({
      groups: [{ key, expires_on: localDay(10) }],
      overrides: { "vault.view": { effect: "allow", expires_on: null }, "assets.update": "deny" },
    });
    // สิทธิ์ที่ super_admin มอบ (locked) — admin เห็นแต่ยกเลิกไม่ได้
    await root.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "settings.manage": "allow" } });
    await exec("UPDATE user_permissions SET expires_on = ? WHERE user_id = ? AND permission_id = (SELECT id FROM permissions WHERE \"key\" = 'assets.update')", [localDay(-1), person.id]);

    const items = (await admin.get("/api/v1/access-exceptions")).body.data as Array<Record<string, unknown> & { user: { id: number } }>;
    const mine = items.filter((i) => i.user.id === person.id);
    expect(mine.map((i) => `${i.kind}:${i.key}`).sort()).toEqual(["allow:settings.manage", "allow:vault.view", `deny:assets.update`, `group:${key}`].sort());
    expect(mine.find((i) => i.key === key)).toMatchObject({ name_th: "ฝ่ายบุคคล", expires_on: localDay(10), expired: false, can_revoke: true, granted_by: { name: "แอดมิน" } });
    expect(mine.find((i) => i.key === "assets.update")).toMatchObject({ kind: "deny", expired: true, can_revoke: true });
    expect(mine.find((i) => i.key === "settings.manage")).toMatchObject({ can_revoke: false });
    expect((await (await as(person)).get("/api/v1/access-exceptions")).status).toBe(403);

    // ยกเลิกจากรายงาน: override = PUT inherit, กลุ่ม = DELETE member
    expect((await admin.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "vault.view": "inherit" } })).status).toBe(200);
    expect((await admin.delete(`/api/v1/permission-groups/${key}/members/${person.id}`)).status).toBe(204);
    const left = ((await admin.get("/api/v1/access-exceptions")).body.data as Array<{ user: { id: number }; key: string }>).filter((i) => i.user.id === person.id).map((i) => i.key);
    expect(left.sort()).toEqual(["assets.update", "settings.manage"]);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'user.permissions_updated' AND subject_id = ?", [String(person.id)])).toBeTruthy();
  });
});
