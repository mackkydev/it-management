import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar, select } from "../src/db.js";
import { encryptString } from "../src/lib/laravel-crypt.js";
import { nowDb, toDbDateTime } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import { PERMISSIONS } from "../src/models/permission.js";
import type { UserRow } from "../src/models/user.js";
import { ensurePermissions, permissionsOf } from "../src/services/permissions.js";
import { as, guest, makeUser } from "./helpers.js";

/** เฟส 3: สิทธิ์ตาม permission — สิทธิ์ของกลุ่ม + เพิ่มรายคน − ถอดรายคน และพฤติกรรมเดิมต้องไม่เปลี่ยน */

const permissionId = async (key: string) => (await scalar<number>("SELECT id FROM permissions WHERE \"key\" = ?", [key]))!;
const override = async (user: UserRow, key: string, effect: "allow" | "deny") =>
  insert("user_permissions", { user_id: user.id, permission_id: await permissionId(key), effect, created_at: nowDb() }).catch(async () => {
    // ตาราง user_permissions ไม่มีคอลัมน์ id (AUTO_INCREMENT) — ใช้ exec แทน insert()
    await exec("INSERT INTO user_permissions (user_id, permission_id, effect, created_at) VALUES (?, ?, ?, ?)", [user.id, await permissionId(key), effect, nowDb()]);
  });

async function apiUser(attrs: Record<string, unknown> = {}) {
  const conn = await insert("api_connections", { name: "HR", is_enabled: true, base_url: "https://hr.example.com", login_path: "/login", created_at: nowDb(), updated_at: nowDb() });
  const id = await insert("users", { name: "API", role: "manager", type: "API", connection_id: conn, external_id: `E${Date.now()}`, created_at: nowDb(), updated_at: nowDb(), ...attrs });
  const user = (await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
  const token = await createToken(id, "t", null);
  await insert("external_sessions", {
    token_id: token.id, user_id: id, connection_id: conn, access_token: encryptString("x"),
    expires_at: toDbDateTime(new Date(Date.now() + 3600_000)), profile_checked_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
  });
  const auth = (r: ReturnType<ReturnType<typeof guest>["get"]>) => r.set("Accept", "application/json").set("Authorization", `Bearer ${token.plainText}`);
  return { user, get: (url: string) => auth(guest().get(url)), post: (url: string) => auth(guest().post(url)) };
}

describe("permissions", () => {
  it("seeds the catalog with defaults per group; IT staff / IT head are no longer groups (merged into admin / super_admin)", async () => {
    expect(await scalar("SELECT COUNT(*) FROM permissions")).toBe(PERMISSIONS.length);
    const cases: [Pick<Partial<UserRow>, "role" | "is_it_staff" | "is_it_head">, string[]][] = [
      [{ role: "admin" }, ["admin"]],
      [{ role: "manager" }, ["manager"]],
      [{ role: "viewer" }, ["viewer"]],
    ];
    for (const [attrs, groups] of cases) {
      const sample = await makeUser(attrs);
      const expected = PERMISSIONS.filter((p) => p.defaults.some((d) => groups.includes(d))).map((p) => p.key);
      expect([...(await permissionsOf(sample))].sort()).toEqual(expected.sort());
    }
    // ผู้ดูแลระบบ (admin) = ทุกอย่าง ยกเว้นสิทธิ์ที่สงวนไว้ (จัดการสิทธิ์) และ KPI ของคนอื่น (เฉพาะผู้ดูแลระบบสูงสุด = หัวหน้า IT)
    const superOnly = ["kpi.view_all", "kpi.edit_all"];
    expect([...(await permissionsOf(await makeUser({ role: "admin" })))].sort()).toEqual(PERMISSIONS.filter((p) => !p.locked && !superOnly.includes(p.key)).map((p) => p.key).sort());
  });

  it("re-running the seeder never overwrites what an admin changed", async () => {
    await exec("UPDATE permissions SET name_th = 'ชื่อที่ admin ตั้ง', sort_order = 99 WHERE \"key\" = 'vault.view'");
    await exec("DELETE FROM role_permissions WHERE role = 'it_staff' AND permission_id = ?", [await permissionId("vault.view")]);
    await ensurePermissions();
    expect(await first("SELECT name_th, sort_order FROM permissions WHERE \"key\" = 'vault.view'")).toEqual({ name_th: "ชื่อที่ admin ตั้ง", sort_order: 99 });
    expect(await scalar("SELECT COUNT(*) FROM role_permissions WHERE role = 'it_staff' AND permission_id = ?", [await permissionId("vault.view")])).toBe(0);
  });

  it("effective = role permissions + per-user allow − per-user deny (enforced by the API)", async () => {
    const viewer = await makeUser();
    expect((await (await as(viewer)).get("/api/v1/credentials")).status).toBe(403);
    await override(viewer, "vault.view", "allow");
    expect((await (await as(viewer)).get("/api/v1/credentials")).status).toBe(200);

    const it = await makeUser({ is_it_staff: true });
    expect((await (await as(it)).get("/api/v1/tickets?scope=it")).status).toBe(200);
    await override(it, "it_tickets.queue", "deny");
    expect((await (await as(it)).get("/api/v1/tickets?scope=it")).status).toBe(403);

    const manager = await makeUser({ role: "manager" });
    expect((await (await as(manager)).get("/api/v1/locations?include_inactive=1")).status).toBe(200);
    await override(manager, "locations.manage", "deny");
    expect((await (await as(manager)).get("/api/v1/locations?include_inactive=1")).status).toBe(403);
  });

  it("changing a role's permissions applies to everyone in that role", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.get("/api/v1/users?search=a")).status).toBe(200);
    await exec("DELETE FROM role_permissions WHERE role = 'manager' AND permission_id = ?", [await permissionId("users.search")]);
    expect((await manager.get("/api/v1/users?search=a")).status).toBe(403);
  });

  it("super admins pass every check, even with a deny override", async () => {
    const admin = await makeUser({ role: "super_admin" });
    await override(admin, "settings.manage", "deny");
    const res = await (await as(admin)).get("/api/v1/auth/me");
    expect(res.body.data.permissions).toEqual(PERMISSIONS.map((p) => p.key).sort());
    expect((await (await as(admin)).get("/api/v1/settings")).status).toBe(200);
  });

  it("API users get their role's permissions and per-user overrides; API connections are for LOCAL super admins only", async () => {
    const mgr = await apiUser({ role: "manager" });
    const me = (await mgr.get("/api/v1/auth/me")).body.data;
    expect(me.permissions).toContain("assets.update");
    expect(me.permissions).not.toContain("vault.view");
    await override(mgr.user, "vault.view", "allow");
    expect((await mgr.get("/api/v1/credentials")).status).toBe(200);

    const boss = await apiUser({ role: "admin", external_id: "BOSS" });
    await override(boss.user, "settings.manage", "deny");
    expect((await boss.get("/api/v1/settings")).status).toBe(403);
    expect((await boss.get("/api/v1/api-connections")).status).toBe(403);

    // API User เป็น super_admin ได้ (ผ่านทุกสิทธิ์) — แต่หน้าการเชื่อมต่อ API เฉพาะ super_admin บัญชี LOCAL
    const head = await apiUser({ role: "super_admin", external_id: "HEAD" });
    expect((await head.get("/api/v1/auth/me")).body.data.permissions).toEqual(PERMISSIONS.map((p) => p.key).sort());
    expect((await head.get("/api/v1/settings")).status).toBe(200);
    expect((await head.get("/api/v1/api-connections")).status).toBe(403);
    expect((await (await as(await makeUser({ role: "super_admin" }))).get("/api/v1/api-connections")).status).toBe(200);
  });

  it("/ui-config exposes each group's permissions for the menu simulator", async () => {
    const res = await (await as(await makeUser())).get("/api/v1/ui-config");
    expect(res.body.data.role_permissions.admin).toEqual(expect.arrayContaining(["it_tickets.close", "kpi.use"]));
    expect(res.body.data.role_permissions.admin).not.toContain("kpi.view_all");
    expect(res.body.data.role_permissions.viewer).toEqual(["locations.view", "signature.manage_own"]); // หน้าสถานที่ + ลายเซ็นของตัวเอง = ทุกกลุ่ม
    expect(Object.keys(res.body.data.role_permissions).sort()).toEqual(["admin", "division_manager", "manager", "super_admin", "viewer"]);
    expect(res.body.data.role_permissions.super_admin).toHaveLength(PERMISSIONS.length);
  });

  it("ticket workflow follows permissions: a non-IT user granted the IT queue sees approved tickets", async () => {
    const rows = await select("SELECT \"key\" FROM permissions WHERE \"key\" LIKE 'it_tickets.%' ORDER BY \"key\"");
    expect(rows.map((r) => r.key)).toEqual(["it_tickets.accept", "it_tickets.close", "it_tickets.manage_all", "it_tickets.queue"]);
    const helper = await makeUser({ role: "manager" });
    expect((await (await as(helper)).get("/api/v1/tickets?scope=it")).status).toBe(403);
    await override(helper, "it_tickets.queue", "allow");
    expect((await (await as(helper)).get("/api/v1/tickets?scope=it")).status).toBe(200);
  });
});

describe("menus follow real permissions (permissions page merged into group permissions)", () => {
  it("old per-group hidden menus become real permission removals, once; user search still works", async () => {
    await exec("DELETE FROM app_settings WHERE \"key\" IN ('ui_permissions_v3', 'ui_permissions_converted')");
    await exec("DELETE FROM app_settings WHERE \"key\" = 'ui_permissions'");
    await insert("app_settings", { key: "ui_permissions", value: JSON.stringify({ "/users": ["manager"], "/locations": ["viewer"], "/tickets/approvals": ["viewer"], "/vault": ["super_admin"] }), created_at: nowDb(), updated_at: nowDb() });
    await ensurePermissions();

    const manager = await makeUser({ role: "manager" });
    const keys = await permissionsOf(manager);
    expect(keys.has("users.view")).toBe(false);
    expect(keys.has("users.search")).toBe(true); // ยังค้นหา/เลือกผู้ใช้ในฟอร์มได้
    expect((await (await as(manager)).get("/api/v1/users?manage=1")).status).toBe(403); // หน้ารายการ/จัดการผู้ใช้
    expect((await (await as(manager)).get("/api/v1/users?search=a&per_page=10")).status).toBe(200); // ช่องค้นหาผู้ใช้ (users.search)
    expect((await permissionsOf(await makeUser())).has("locations.view")).toBe(false);

    const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    const converted = await first<{ value: unknown }>("SELECT \"value\" FROM app_settings WHERE \"key\" = 'ui_permissions_converted'");
    expect(json(converted?.value).skipped).toEqual(["/tickets/approvals"]);
    expect(json(await scalar("SELECT \"value\" FROM app_settings WHERE \"key\" = 'ui_permissions'"))).toEqual({});

    // รันซ้ำไม่แปลงอีก (ให้สิทธิ์คืนแล้วต้องคงอยู่)
    await exec("INSERT IGNORE INTO role_permissions (role, permission_id, created_at) SELECT 'manager', id, ? FROM permissions WHERE \"key\" = 'users.view'", [nowDb()]);
    await ensurePermissions();
    expect((await permissionsOf(manager)).has("users.view")).toBe(true);
  });

  it("the approvals menu shows only for people who can actually approve", async () => {
    const me = async (u: UserRow) => (await (await as(u)).get("/api/v1/auth/me")).body.data.can_approve;
    const staff = await makeUser();
    expect(await me(staff)).toBe(false);
    expect(await me(await makeUser({ role: "manager" }))).toBe(true);
    const boss = await makeUser(); // พนักงานที่เป็นหัวหน้าของใคร
    await exec("UPDATE users SET supervisor_id = ? WHERE id = ?", [boss.id, staff.id]);
    expect(await me(boss)).toBe(true);
  });
});
