import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar, select } from "../src/db.js";
import { localToday, nowDb } from "../src/lib/time.js";
import type { UserRow } from "../src/models/user.js";
import { ensurePermissions, permissionsOf } from "../src/services/permissions.js";
import { encryptString } from "../src/lib/laravel-crypt.js";
import { createToken } from "../src/lib/tokens.js";
import { toDbDateTime } from "../src/lib/time.js";
import { as, guest, localDay, makeUser } from "./helpers.js";

/** ระบบสิทธิ์ใหม่: super_admin / admin + กลุ่มหลายกลุ่มต่อคน + วันหมดอายุ + กติกาการมอบ + แจ้งเตือนผู้ดูแลระบบ */

const keysOf = async (u: UserRow) => [...(await permissionsOf((await first<UserRow>("SELECT * FROM users WHERE id = ?", [u.id]))!))];
const notices = (userId: number) =>
  select<{ data: string }>("SELECT data FROM notifications WHERE notifiable_id = ? AND type = 'App\\\\Notifications\\\\AccessChanged' ORDER BY created_at", [userId]);

async function apiUser(attrs: Record<string, unknown> = {}): Promise<UserRow> {
  const conn = await insert("api_connections", { name: `C${Math.random()}`, is_enabled: true, base_url: "https://hr.example.com", login_path: "/login", created_at: nowDb(), updated_at: nowDb() });
  const id = await insert("users", { name: "API Person", role: "viewer", type: "API", connection_id: conn, external_id: `E-${Math.random()}`, created_at: nowDb(), updated_at: nowDb(), ...attrs });
  return (await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
}

/** client ของ API User ที่ login แล้ว (มี session ต้นทาง) */
async function asApiUser(user: UserRow) {
  const token = await createToken(user.id, "t", null);
  await insert("external_sessions", {
    token_id: token.id, user_id: user.id, connection_id: user.connection_id, access_token: encryptString("x"),
    expires_at: toDbDateTime(new Date(Date.now() + 3600_000)), profile_checked_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
  });
  const auth = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("Accept", "application/json").set("Accept-Language", "th").set("Authorization", `Bearer ${token.plainText}`);
  return { patch: (url: string) => auth(guest().patch(url)), delete: (url: string) => auth(guest().delete(url)) };
}

describe("permission groups", () => {
  it("a user can be in several groups; group permissions add up and are audited + notified to admins", async () => {
    const root = await makeUser({ role: "super_admin", name: "Root" });
    const deputy = await makeUser({ role: "admin", name: "Deputy" });
    const api = await as(root);
    const person = await apiUser();

    const g = await api.post("/api/v1/permission-groups").send({ name_th: "ทีมสินทรัพย์", name_en: "Asset team" });
    expect(g.status).toBe(201);
    expect((await api.post("/api/v1/permission-groups").send({ name_th: "ทีมสินทรัพย์", name_en: "Other" })).status).toBe(422); // ชื่อซ้ำ
    await api.put(`/api/v1/permissions/roles/${g.body.data.key}`).send({ keys: ["assets.view_all", "assets.update"] });

    const res = await api.put(`/api/v1/users/${person.id}/permissions`).send({ groups: [{ key: g.body.data.key }, { key: "it_staff" }] });
    expect(res.status).toBe(200);
    expect([...res.body.data.groups].sort()).toEqual(["viewer", g.body.data.key, "it_staff"].sort());
    expect(res.body.data.effective).toEqual(expect.arrayContaining(["assets.update", "it_tickets.queue", "vault.view"]));

    // แจ้งเตือนผู้ดูแลระบบรอง (ไม่แจ้งผู้ทำเอง)
    expect((await notices(deputy.id)).map((n) => JSON.parse(n.data).change).sort()).toEqual(["group_created", "group_permissions", "user"]);
    expect(await notices(root.id)).toHaveLength(0);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action IN ('permission_group.created', 'role.permissions_updated', 'user.permissions_updated')")).toBe(3);

    // ลบกลุ่มที่สร้างเอง = สมาชิกหลุดจากกลุ่ม; กลุ่มตามตำแหน่งลบไม่ได้
    expect((await api.delete(`/api/v1/permission-groups/${g.body.data.key}`)).status).toBe(204);
    expect(await keysOf(person)).not.toContain("assets.update");
    expect((await api.delete("/api/v1/permission-groups/manager")).status).toBe(422);
  });

  it("expiry dates only apply while the switch is on", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const person = await makeUser();
    const yesterday = localDay(-1);
    // ตั้งวันที่ผ่านไปแล้วผ่าน API ไม่ได้ — จำลองรายการที่หมดอายุแล้ว
    expect((await api.put(`/api/v1/users/${person.id}/permissions`).send({ groups: [{ key: "it_staff", expires_on: yesterday }] })).status).toBe(422);
    await exec("INSERT INTO user_groups (user_id, group_key, expires_on, created_at) VALUES (?, 'it_staff', ?, ?)", [person.id, yesterday, nowDb()]);
    await api.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "users.view": { effect: "allow", expires_on: localToday() } } });

    expect(await keysOf(person)).toContain("vault.view"); // สวิตช์ปิด = ไม่สนใจวันหมดอายุ
    expect((await api.put("/api/v1/permission-expiry").send({ enabled: true })).status).toBe(200);
    expect(await keysOf(person)).not.toContain("vault.view");
    expect(await keysOf(person)).toContain("users.view"); // หมดอายุสิ้นวันนี้ = ยังใช้ได้วันนี้
    expect((await api.get("/api/v1/permissions")).body.expiry_enabled).toBe(true);
    expect((await (await as(await makeUser({ role: "admin" }))).put("/api/v1/permission-expiry").send({ enabled: false })).status).toBe(403);
  });
});

describe("grant rules (no privilege escalation)", () => {
  it("admins grant only what they hold, never reserved permissions, never to themselves or super admins", async () => {
    const deputyUser = await makeUser({ role: "admin" });
    const deputy = await as(deputyUser, "th");
    const root = await makeUser({ role: "super_admin" });
    const person = await apiUser();

    // มอบตำแหน่ง/กลุ่ม/สิทธิ์ที่ตัวเองมีได้ (รวมตั้ง admin ให้ผู้ใช้ API)
    expect((await deputy.put(`/api/v1/users/${person.id}/permissions`).send({ role: "admin" })).status).toBe(200);
    expect((await deputy.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "vault.delete": "allow" } })).status).toBe(200);

    const reserved = await deputy.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "access.manage": "allow" } });
    expect(reserved.status).toBe(422);
    expect(reserved.body.errors.overrides[0]).toContain("สงวนไว้");
    expect((await deputy.put(`/api/v1/users/${person.id}/permissions`).send({ role: "super_admin" })).status).toBe(422);
    expect((await deputy.put(`/api/v1/users/${deputyUser.id}/permissions`).send({ overrides: { "users.view": "deny" } })).status).toBe(422);
    expect((await deputy.put(`/api/v1/users/${root.id}/permissions`).send({ role: "viewer" })).status).toBe(422);
    expect((await deputy.patch(`/api/v1/users/${root.id}`).send({ name: "x" })).status).toBe(403);

    // ถอดสิทธิ์ที่สงวนไว้ของตัวเอง → มอบสิทธิ์ที่ไม่มีไม่ได้
    await exec("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = 'admin' AND p.key = 'kpi.edit_all'");
    const missing = await deputy.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "kpi.edit_all": "allow" } });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.overrides[0]).toContain("KPI");

    // แก้ตารางสิทธิ์ของกลุ่ม / สร้างกลุ่ม = access.manage (สงวนไว้ให้ super_admin)
    expect((await deputy.put("/api/v1/permissions/roles/viewer").send({ keys: [] })).status).toBe(403);
    expect((await deputy.post("/api/v1/permission-groups").send({ name_th: "x", name_en: "x" })).status).toBe(403);
    // super_admin มอบสิทธิ์ที่สงวนไว้ได้ → ผู้ได้รับแก้ตารางสิทธิ์ได้ แต่ยังมอบสิทธิ์ที่สงวนไว้ต่อไม่ได้
    await (await as(root)).put(`/api/v1/users/${deputyUser.id}/permissions`).send({ overrides: { "access.manage": "allow" } });
    expect((await deputy.put("/api/v1/permissions/roles/viewer").send({ keys: ["signature.manage_own", "users.search"] })).status).toBe(200);
    expect((await deputy.put("/api/v1/permissions/roles/viewer").send({ keys: ["access.manage"] })).status).toBe(422);
  });

  it("users.update without access.assign cannot change roles; there is always one active LOCAL super admin", async () => {
    const hr = await makeUser({ role: "manager" });
    const viewerPerm = await scalar<number>("SELECT id FROM permissions WHERE \"key\" = 'users.update'");
    await exec("INSERT INTO user_permissions (user_id, permission_id, effect, created_at) VALUES (?, ?, 'allow', ?)", [hr.id, viewerPerm, nowDb()]);
    const person = await makeUser();
    const hrApi = await as(hr, "th");
    const res = await hrApi.patch(`/api/v1/users/${person.id}`).send({ role: "admin" });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors)).toEqual(["role"]);
    expect((await hrApi.patch(`/api/v1/users/${person.id}`).send({ department: "บัญชี" })).status).toBe(200);

    const rootUser = await makeUser({ role: "super_admin" });
    const root = await as(rootUser, "th");
    const apiHead = await apiUser({ role: "super_admin" }); // super_admin ที่เป็น API ไม่นับเป็นทางสำรอง
    const head = await asApiUser(apiHead);
    expect((await head.patch(`/api/v1/users/${rootUser.id}`).send({ is_active: false })).status).toBe(422);
    expect((await head.delete(`/api/v1/users/${rootUser.id}`)).status).toBe(422);
    const second = await makeUser({ role: "super_admin" });
    expect((await root.patch(`/api/v1/users/${second.id}`).send({ role: "admin" })).status).toBe(200);
  });

  it("admins can change the shared PIN; every change notifies the other admins", async () => {
    const deputyUser = await makeUser({ role: "admin", password: "Deputy-1234" });
    const root = await makeUser({ role: "super_admin" });
    const other = await apiUser({ role: "admin" });
    const res = await (await as(deputyUser)).put("/api/v1/secret-pin").send({ password: "Deputy-1234", pin: "246810", pin_confirmation: "246810" });
    expect(res.status).toBe(200);
    for (const id of [root.id, other.id]) {
      expect((await notices(id)).map((n) => JSON.parse(n.data))).toEqual([expect.objectContaining({ change: "pin", first_time: true })]);
    }
    expect(await notices(deputyUser.id)).toHaveLength(0);
  });

  it("menu visibility is part of access management (reserved)", async () => {
    const deputy = await as(await makeUser({ role: "admin" }), "th");
    expect((await deputy.put("/api/v1/settings").send({ contract_notify_days: 20 })).status).toBe(200);
    expect((await deputy.put("/api/v1/settings").send({ ui_permissions: { "/vault": ["viewer"] } })).status).toBe(403);
    const root = await as(await makeUser({ role: "super_admin" }), "th");
    expect((await root.put("/api/v1/settings").send({ ui_permissions: { "/vault": ["viewer", "it_staff"] } })).status).toBe(200);
    expect((await root.put("/api/v1/settings").send({ ui_permissions: { "/vault": ["nope"] } })).status).toBe(422);
  });
});

describe("upgrade from the old permission model", () => {
  it("split keys copy group and per-user grants from the old key; legacy menu hiding also hides from super admins", async () => {
    // จำลองฐานเดิม: มีแต่ vault.use + การกำหนดสิทธิ์เดิม
    await exec("DELETE FROM permissions WHERE \"key\" LIKE 'vault.%'");
    const old = await insert("permissions", { key: "vault.use", group: "it_data", name_th: "คลัง", name_en: "Vault", sort_order: 1, created_at: nowDb(), updated_at: nowDb() });
    await exec("INSERT INTO role_permissions (role, permission_id) VALUES ('manager', ?)", [old]);
    const person = await makeUser();
    await exec("INSERT INTO user_permissions (user_id, permission_id, effect) VALUES (?, ?, 'allow')", [person.id, old]);
    await exec("DELETE FROM app_settings WHERE \"key\" = 'ui_permissions_v2'");
    await exec("INSERT INTO app_settings (\"key\", \"value\") VALUES ('ui_permissions', ?) AS new ON DUPLICATE KEY UPDATE \"value\" = new.\"value\"", [JSON.stringify({ "/kpi": ["admin", "viewer"] })]);

    await ensurePermissions();
    expect(await keysOf(await makeUser({ role: "manager" }))).toEqual(expect.arrayContaining(["vault.view", "vault.create", "vault.update", "vault.delete"]));
    expect(await keysOf(person)).toContain("vault.delete");
    expect((await first<{ value: unknown }>("SELECT \"value\" FROM app_settings WHERE \"key\" = 'ui_permissions'"))!.value).toEqual({ "/kpi": ["admin", "viewer", "super_admin"] });
  });
});
