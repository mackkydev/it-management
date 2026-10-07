import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import type { UserRow } from "../src/models/user.js";
import { as, makeAsset, makeUser } from "./helpers.js";

/** จัดการสิทธิ์รายคน / รายการ API User / ผูกบัญชี / audit log — ผู้มีสิทธิ์ access.assign / audit_logs.view (super_admin ผ่านทุกสิทธิ์) */

async function connection(name = "HR") {
  return insert("api_connections", { name, is_enabled: true, base_url: "https://hr.example.com", login_path: "/login", created_at: nowDb(), updated_at: nowDb() });
}

async function apiUser(conn: number, attrs: Record<string, unknown> = {}): Promise<UserRow> {
  const id = await insert("users", { name: "API Person", role: "viewer", type: "API", connection_id: conn, external_id: `E-${Math.random()}`, created_at: nowDb(), updated_at: nowDb(), ...attrs });
  return (await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
}

describe("access management (local admin)", () => {
  it("only local admins can use these screens", async () => {
    for (const u of [await makeUser({ role: "manager" }), await makeUser({ is_it_head: true })]) {
      const api = await as(u);
      for (const url of ["/api/v1/permissions", "/api/v1/api-users", "/api/v1/audit-logs", `/api/v1/users/${u.id}/permissions`]) {
        expect((await api.get(url)).status).toBe(403);
      }
    }
  });

  it("shows inherited, per-user and effective permissions, and saves role + overrides with an audit entry", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const person = await apiUser(await connection());

    const view = (await admin.get(`/api/v1/users/${person.id}/permissions`)).body.data;
    expect(view).toMatchObject({ groups: ["viewer"], inherited: ["locations.view", "signature.manage_own"], overrides: {}, effective: ["locations.view", "signature.manage_own"], is_super_admin: false });

    const saved = await admin.put(`/api/v1/users/${person.id}/permissions`).send({ role: "manager", overrides: { "vault.view": "allow", "assets.update": "deny" } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.user.role).toBe("manager");
    expect(saved.body.data.overrides).toEqual({ "assets.update": { effect: "deny", expires_on: null }, "vault.view": { effect: "allow", expires_on: null } });
    expect(saved.body.data.effective).toContain("vault.view");
    expect(saved.body.data.effective).not.toContain("assets.update");
    expect(saved.body.data.inherited).toContain("assets.update");

    // inherit = ลบ override
    const back = await admin.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "assets.update": "inherit" } });
    expect(back.body.data.overrides).toEqual({ "vault.view": { effect: "allow", expires_on: null } });

    const logs = await first<{ before: { role: string }; after: { role: string; overrides: Record<string, string> } }>(
      `SELECT "before", "after" FROM audit_logs WHERE action = 'user.permissions_updated' ORDER BY id LIMIT 1`,
    );
    expect(logs).toMatchObject({ before: { role: "viewer", overrides: {} }, after: { role: "manager" } });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'user.permissions_updated'")).toBe(2);
  });

  it("API users can hold any role (super_admin too); unknown permission keys are rejected", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    const person = await apiUser(await connection());
    const res = await admin.put(`/api/v1/users/${person.id}/permissions`).send({ role: "admin", overrides: { "nope.key": "allow", "vault.view": "maybe" } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(["overrides.nope.key", "overrides.vault.view"].sort());

    expect((await admin.put(`/api/v1/users/${person.id}/permissions`).send({ role: "super_admin" })).body.data).toMatchObject({ user: { role: "super_admin" }, is_super_admin: true });
    const local = await makeUser({ role: "viewer" });
    expect((await admin.put(`/api/v1/users/${local.id}/permissions`).send({ role: "manager" })).status).toBe(200);
  });

  it("lists API users with filters and flags e-mail conflicts", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const hr = await connection("HR");
    const erp = await connection("ERP");
    const somchai = await apiUser(hr, { name: "สมชาย", role: "manager", email: null, external_id: "E1" });
    await apiUser(erp, { name: "สุดา", is_active: false, external_id: "E2" });
    await makeUser({ name: "Local", email: "somchai@corp.example" });
    await insert("audit_logs", { action: "api_user.email_conflict", subject_type: "user", subject_id: String(somchai.id), after: JSON.stringify({ email: "somchai@corp.example" }), created_at: nowDb() });

    const all = (await admin.get("/api/v1/api-users")).body;
    expect(all.meta.total).toBe(2);
    expect(all.data[0]).toMatchObject({ name: "สมชาย", connection_name: "HR", conflict_email: "somchai@corp.example", overrides_count: 0 });
    expect((await admin.get("/api/v1/api-users?role=manager")).body.data.map((u: { name: string }) => u.name)).toEqual(["สมชาย"]);
    expect((await admin.get("/api/v1/api-users?status=inactive")).body.data.map((u: { name: string }) => u.name)).toEqual(["สุดา"]);
    expect((await admin.get(`/api/v1/api-users?connection_id=${erp}`)).body.meta.total).toBe(1);
    expect((await admin.get("/api/v1/api-users?conflict=1")).body.meta.total).toBe(1);
    expect((await admin.get("/api/v1/api-users?search=E2")).body.data[0].name).toBe("สุดา");
  });

  it("links an API identity to the existing local account (keeps its history, removes its password)", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const conn = await connection();
    const local = await makeUser({ name: "สมชาย (เดิม)", email: "somchai@corp.example", role: "manager" });
    await makeAsset({ custodian_id: local.id });
    await createToken(local.id, "old-device", null);
    const fresh = await apiUser(conn, { external_id: "E100", email: null });

    const res = await admin.post(`/api/v1/api-users/${fresh.id}/link`).send({ local_user_id: local.id });
    expect(res.status).toBe(200);
    const linked = (await first<UserRow>("SELECT * FROM users WHERE id = ?", [local.id]))!;
    expect(linked).toMatchObject({ type: "API", connection_id: conn, external_id: "E100", password: null, role: "manager", email: "somchai@corp.example" });
    expect(await scalar("SELECT COUNT(*) FROM users WHERE id = ?", [fresh.id])).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_id = ?", [local.id])).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'api_user.linked'")).toBe(1);
  });

  it("refuses to link a super admin (unless done by a super admin) or when the API user already has history", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const deputy = await as(await makeUser({ role: "admin" }));
    const conn = await connection();
    const otherAdmin = await makeUser({ role: "super_admin" });
    const a = await apiUser(conn);
    expect((await deputy.post(`/api/v1/api-users/${a.id}/link`).send({ local_user_id: otherAdmin.id })).status).toBe(422);
    const b = await apiUser(conn);
    await makeAsset({ custodian_id: b.id });
    expect((await admin.post(`/api/v1/api-users/${b.id}/link`).send({ local_user_id: (await makeUser()).id })).status).toBe(422);
  });

  it("audit log lists changes with filters, newest first, without secrets", async () => {
    const adminUser = await makeUser({ role: "super_admin", name: "Root" });
    const admin = await as(adminUser);
    await admin.post("/api/v1/api-connections").send({ name: "HR", base_url: "https://hr.example.com", login_path: "/login", auth_type: "bearer", auth_secret: "top-secret" });
    const person = await apiUser(await connection("ERP"));
    await admin.put(`/api/v1/users/${person.id}/permissions`).send({ overrides: { "vault.view": "allow" } });

    const res = await admin.get("/api/v1/audit-logs");
    expect(res.body.data.map((l: { action: string }) => l.action)).toEqual(["user.permissions_updated", "api_connection.created"]);
    expect(res.body.data[0]).toMatchObject({ actor_name: "Root", subject_name: "API Person" });
    expect(JSON.stringify(res.body)).not.toContain("top-secret");
    expect((await admin.get("/api/v1/audit-logs?action=api_connection")).body.meta.total).toBe(1);
    expect((await admin.get("/api/v1/audit-logs/actions")).body.data).toEqual(["api_connection.created", "user.permissions_updated"]);
  });

  it("the user form: API users cannot get a password; role/status changes are audited", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    const person = await apiUser(await connection(), { email: null });
    const bad = await admin.patch(`/api/v1/users/${person.id}`).send({ password: "NewPass-123", role: "admin" });
    expect(Object.keys(bad.body.errors).sort()).toEqual(["password"]);
    expect((await admin.patch(`/api/v1/users/${person.id}`).send({ email: null, role: "manager", department: "IT" })).status).toBe(200);

    const local = await makeUser({ role: "viewer" });
    await admin.patch(`/api/v1/users/${local.id}`).send({ is_it_staff: true });
    const actions = (await admin.get("/api/v1/audit-logs?action=user.access_updated")).body.data;
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ before: { is_it_staff: false }, after: { is_it_staff: true } });
    await exec("SELECT 1");
  });
});
