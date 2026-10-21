import { describe, expect, it } from "vitest";
import { exec, scalar } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { as, guest, makeUser } from "./helpers.js";

/**
 * ผู้ดูแลระบบ (admin) แก้สิทธิ์ของกลุ่มที่ต่ำกว่าได้ (access.groups) + แจ้งเตือนเมื่อ super_admin เข้าสู่ระบบ
 */

const keysOf = async (group: string) =>
  (await scalar<string>("SELECT GROUP_CONCAT(p.key ORDER BY p.key) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = ?", [group]))?.split(",") ?? [];

describe("admins edit lower groups (access.groups)", () => {
  it("edits role groups below their own role and custom groups — only with permissions they hold", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const catalog = (await admin.get("/api/v1/permissions")).body;
    expect(catalog.editable_groups).toEqual(expect.arrayContaining(["division_manager", "manager", "viewer"]));
    expect(catalog.editable_groups).not.toContain("admin");
    expect(catalog.editable_groups).not.toContain("super_admin");
    expect(catalog.can_create_group).toBe(true);

    // กลุ่มที่ต่ำกว่า: เพิ่ม/ถอดสิทธิ์ที่ตัวเองมี
    const before = await keysOf("manager");
    const added = await admin.put("/api/v1/permissions/roles/manager").send({ keys: [...before, "holidays.manage"] });
    expect(added.status).toBe(200);
    expect(await keysOf("manager")).toContain("holidays.manage");
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'role.permissions_updated' AND subject_id = 'manager'"))).toBe(1);

    // สิทธิ์ที่สงวนไว้ / ที่ตัวเองไม่มี = 422
    const locked = await admin.put("/api/v1/permissions/roles/manager").send({ keys: [...before, "leave.approve_any"] });
    expect(locked.status).toBe(422);
    expect(locked.body.errors.keys[0]).toContain("สงวนไว้");

    // กลุ่มระดับเดียวกัน / สูงกว่า = 422
    expect((await admin.put("/api/v1/permissions/roles/admin").send({ keys: await keysOf("admin") })).status).toBe(422);
    expect((await admin.put("/api/v1/permissions/roles/super_admin").send({ keys: [] })).status).toBe(404);
    expect((await admin.put("/api/v1/permission-groups/admin").send({ name_th: "ไอที", name_en: "IT" })).status).toBe(422);
  });

  it("creates, renames and deletes custom groups, but not groups they belong to", async () => {
    const adminUser = await makeUser({ role: "admin" });
    const admin = await as(adminUser, "th");
    const created = await admin.post("/api/v1/permission-groups").send({ name_th: "HR สาขา", name_en: "Branch HR" });
    expect(created.status).toBe(201);
    const key = created.body.data.key as string;
    expect((await admin.put(`/api/v1/permissions/roles/${key}`).send({ keys: ["leave.view_all"] })).status).toBe(200);
    expect((await admin.put(`/api/v1/permission-groups/${key}`).send({ name_th: "HR สาขาสระบุรี", name_en: "Saraburi HR" })).status).toBe(200);

    // อยู่ในกลุ่มเอง = แก้ไม่ได้ (กันขยายสิทธิ์กลุ่มของตัวเอง)
    await exec("INSERT INTO user_groups (user_id, group_key, created_at) VALUES (?, ?, NOW())", [adminUser.id, key]);
    const own = await admin.put(`/api/v1/permissions/roles/${key}`).send({ keys: [] });
    expect(own.status).toBe(422);
    expect(own.body.errors.keys[0]).toContain("ตัวเองอยู่");
    expect((await admin.get("/api/v1/permissions")).body.editable_groups).not.toContain(key);
    await exec("DELETE FROM user_groups WHERE user_id = ?", [adminUser.id]);

    // ลบกลุ่มที่มีสิทธิ์ที่ตัวเองถอดไม่ได้ = 422 / ปกติลบได้
    const root = await as(await makeUser({ role: "super_admin" }));
    expect((await root.put(`/api/v1/permissions/roles/${key}`).send({ keys: ["leave.view_all", "settings.manage"] })).status).toBe(200);
    expect((await admin.delete(`/api/v1/permission-groups/${key}`)).status).toBe(422);
    expect((await root.put(`/api/v1/permissions/roles/${key}`).send({ keys: ["leave.view_all"] })).status).toBe(200);
    expect((await admin.delete(`/api/v1/permission-groups/${key}`)).status).toBe(204);
  });

  it("managers without access.groups only view; access.groups itself is reserved for super admins", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.put("/api/v1/permissions/roles/viewer").send({ keys: [] })).status).toBe(403);
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const target = await makeUser({ role: "manager" });
    const grant = await admin.put(`/api/v1/users/${target.id}/permissions`).send({ overrides: { "access.groups": "allow" } });
    expect(grant.status).toBe(422);
    expect(grant.body.errors.overrides[0]).toContain("สงวนไว้");
  });
});

describe("admins set menu visibility and scopes for lower groups", () => {
  it("hides menus only for lower groups — hidden flags of their own level and above stay as they were", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    expect((await root.put("/api/v1/ui-config").send({ ui_permissions: { "/kpi": ["admin"] } })).status).toBe(200);
    const admin = await as(await makeUser({ role: "admin" }));
    const res = await admin.put("/api/v1/ui-config").send({ ui_permissions: { "/kpi": ["viewer"], "/vault": ["super_admin", "manager"] }, menu_labels: { "/kpi": { th: "ตัวชี้วัด", en: "KPI" } } });
    expect(res.status).toBe(200);
    // admin ถอดการซ่อนของกลุ่ม admin เองไม่ได้ / ซ่อนจาก super_admin ไม่ได้
    expect(res.body.data.ui_permissions).toEqual({ "/kpi": ["viewer", "admin"], "/vault": ["manager"] });
    expect(res.body.data.menu_labels).toEqual({ "/kpi": { th: "ตัวชี้วัด", en: "KPI" } });
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'settings.ui_config_updated'"))).toBe(2);
    // ไม่มี access.groups / access.manage
    expect((await (await as(await makeUser({ role: "manager" }))).put("/api/v1/ui-config").send({ ui_permissions: {} })).status).toBe(403);
    // ตั้งค่าระบบอื่นใน /settings ยังไม่ได้ (settings.manage)
    expect((await admin.put("/api/v1/settings").send({ ui_permissions: {} })).status).toBe(403);
  });

  it("sets calendar / leave / booking scopes only for lower groups", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const cal = await admin.put("/api/v1/calendar/scope").send({ scopes: { manager: "branch", admin: "all", super_admin: "self" }, leave_scopes: { viewer: "self" } });
    expect(cal.status).toBe(200);
    expect(cal.body.data.calendar).toEqual({ manager: "branch" });
    expect(cal.body.data.leave).toEqual({ viewer: "self" });
    const booking = await admin.put("/api/v1/booking-scope").send({ meeting: { viewer: "branch", admin: "branch" } });
    expect(booking.status).toBe(200);
    expect(booking.body.data.meeting).toEqual({ viewer: "branch" });
    expect((await (await as(await makeUser({ role: "manager" }))).put("/api/v1/booking-scope").send({ meeting: {} })).status).toBe(403);
  });
});

describe("super admin login alert", () => {
  const login = (email: string) => {
    resetRateLimits();
    return guest().post("/api/v1/auth/login").send({ email, password: "password", device_name: "test" });
  };

  it("notifies the other active super admins and audits the login; other roles are not reported", async () => {
    const a = await makeUser({ role: "super_admin", name: "สูงสุด ก" });
    const b = await makeUser({ role: "super_admin" });
    const off = await makeUser({ role: "super_admin", is_active: false });
    expect((await login(a.email!)).status).toBe(200);

    const notice = async (id: number) =>
      Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data->>'$.kind' = 'super_admin_login'", [id]));
    expect(await notice(b.id)).toBe(1);
    expect(await notice(a.id)).toBe(0);
    expect(await notice(off.id)).toBe(0);
    expect(await scalar("SELECT data->>'$.method' FROM notifications WHERE notifiable_id = ? AND data->>'$.kind' = 'super_admin_login'", [b.id])).toBe("password");
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.super_admin_login' AND subject_id = ?", [String(a.id)]))).toBe(1);

    const admin = await makeUser({ role: "admin" });
    expect((await login(admin.email!)).status).toBe(200);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.super_admin_login'"))).toBe(1);
    expect(await notice(b.id)).toBe(1);
  });
});
