import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec, first, insert } from "../src/db.js";
import { nowDb, toDbDateTime } from "../src/lib/time.js";
import type { UserRow } from "../src/models/user.js";
import { clearConnectionStatusCache } from "../src/routes/auth.js";
import { setUpstreamTestHooks, type UpstreamHttpRequest } from "../src/services/upstream-http.js";
import { as, guest, makeUser } from "./helpers.js";

/**
 * การเชื่อมต่อตามคู่มือ STEC SyteLine API (Part III):
 *   POST /api/v1/auth/login {username,password} → { token, expiresAt (ISO), tokenType: "Bearer" }
 *   GET  /api/v1/auth/permissions (Bearer)       → { appIds, loadedAt, cacheExpiresAt }   — ไม่มี endpoint โปรไฟล์/รายชื่อผู้ใช้
 *   POST /api/v1/auth/logout (Bearer)            → 204
 *   GET  /health                                 → { status: "ok" }
 */

const PASSWORD = "Stec-Pass-123";
type Call = { method: string; path: string; auth?: string; body?: string };
let calls: Call[] = [];
let accounts: Record<string, number[]> = {};
let expiresAt = "";
let healthStatus = 200;

beforeEach(() => {
  clearConnectionStatusCache();
  calls = [];
  accounts = { somchai: [3, 7], suda: [3] };
  expiresAt = new Date(Date.now() + 8 * 3600_000).toISOString();
  healthStatus = 200;
  setUpstreamTestHooks({
    resolve: async () => ["93.184.216.34"],
    transport: async (req: UpstreamHttpRequest) => {
      const url = new URL(req.url);
      calls.push({ method: req.method, path: url.pathname, auth: req.headers.Authorization, body: req.body });
      const reply = (status: number, body?: unknown) => ({ status, headers: {}, body: body === undefined ? "" : JSON.stringify(body) });
      const user = req.headers.Authorization?.replace("Bearer tok-", "");
      switch (`${req.method} ${url.pathname}`) {
        case "POST /api/v1/auth/login": {
          const b = JSON.parse(req.body ?? "{}");
          return accounts[b.username] && b.password === PASSWORD ? reply(200, { token: `tok-${b.username}`, expiresAt, tokenType: "Bearer" }) : reply(401, {});
        }
        case "GET /api/v1/auth/permissions":
          return user && accounts[user] ? reply(200, { appIds: accounts[user], loadedAt: nowDb(), cacheExpiresAt: nowDb() }) : reply(401, {});
        case "POST /api/v1/auth/logout":
          return reply(204);
        case "GET /health":
          return reply(healthStatus, { status: "ok" });
        default:
          return reply(404);
      }
    },
  });
});

afterEach(() => setUpstreamTestHooks(null));

/** ค่าที่ปุ่ม "ตั้งค่าตามคู่มือ STEC" ในหน้าการเชื่อมต่อใส่ให้ */
const stecConnection = () =>
  insert("api_connections", {
    name: "STEC SyteLine API",
    is_enabled: true,
    base_url: "https://stec.example.com",
    login_method: "POST",
    login_path: "/api/v1/auth/login",
    login_username_field: "username",
    login_password_field: "password",
    login_body_type: "json",
    profile_method: "GET",
    profile_path: "/api/v1/auth/permissions",
    logout_path: "/api/v1/auth/logout",
    health_path: "/health",
    token_path: "token",
    token_ttl_path: "expiresAt",
    field_map: JSON.stringify({ external_id: "$login", name: "$login", role_code: "appIds" }),
    role_rules: JSON.stringify([{ value: "7", role: "manager" }]),
    default_role: "viewer",
    created_at: nowDb(),
    updated_at: nowDb(),
  });

const login = (connectionId: number, username: string, password = PASSWORD) =>
  guest().post("/api/v1/auth/api-login").set("Accept", "application/json").send({ connection_id: connectionId, username, password, device_name: "vitest" });
const withToken = (token: string) => ({
  get: (url: string) => guest().get(url).set("Accept", "application/json").set("Authorization", `Bearer ${token}`),
  post: (url: string) => guest().post(url).set("Accept", "application/json").set("Authorization", `Bearer ${token}`),
});

describe("STEC SyteLine API connection", () => {
  it("logs in with the STEC account: user = login name, role from appIds, session ends at expiresAt", async () => {
    const conn = await stecConnection();
    const res = await login(conn, "somchai");
    expect(res.status).toBe(200);

    const user = (await first<UserRow>("SELECT * FROM users WHERE connection_id = ? AND external_id = 'somchai'", [conn]))!;
    expect(user).toMatchObject({ type: "API", name: "somchai", role: "manager", password: null });
    // appIds [3] ไม่ตรงกฎ → default_role
    await login(conn, "suda");
    expect((await first<UserRow>("SELECT role FROM users WHERE external_id = 'suda'"))!.role).toBe("viewer");

    const session = await first<{ expires_at: string }>("SELECT expires_at FROM external_sessions WHERE user_id = ?", [user.id]);
    expect(Math.abs(new Date(`${session!.expires_at.replace(" ", "T")}Z`).getTime() - Date.parse(expiresAt))).toBeLessThan(2000);

    // ตรวจกับต้นทางซ้ำ (GET /auth/permissions) — ชื่อที่ admin แก้ไว้ไม่ถูกเขียนทับด้วยชื่อผู้ใช้ login
    await exec("UPDATE users SET name = 'สมชาย ใจดี' WHERE id = ?", [user.id]);
    await exec("UPDATE external_sessions SET profile_checked_at = ? WHERE user_id = ?", [toDbDateTime(new Date(Date.now() - 11 * 60_000)), user.id]);
    const me = await withToken(res.body.token).get("/api/v1/auth/me");
    expect(me.body.data.name).toBe("สมชาย ใจดี");
    expect(calls.some((c) => c.path === "/api/v1/auth/permissions" && c.auth === "Bearer tok-somchai")).toBe(true);

    // logout → แจ้งต้นทางด้วย Bearer token ของต้นทาง (browser ไม่เคยเห็น)
    expect((await withToken(res.body.token).post("/api/v1/auth/logout")).status).toBe(204);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/auth/logout" && c.auth === "Bearer tok-somchai")).toBe(true);
  });

  it("role follows appIds on every re-check; an admin cannot change it per user", async () => {
    const conn = await stecConnection();
    const res = await login(conn, "suda");
    const user = (await first<UserRow>("SELECT * FROM users WHERE external_id = 'suda'"))!;
    expect(user.role).toBe("viewer");

    const admin = await as(await makeUser({ role: "super_admin" }));
    const view = await admin.get(`/api/v1/users/${user.id}/permissions`);
    expect(view.body.data.role_synced).toBe(true);
    expect((await admin.put(`/api/v1/users/${user.id}/permissions`).send({ role: "manager" })).status).toBe(422);
    // สิทธิ์รายคนยังปรับได้
    expect((await admin.put(`/api/v1/users/${user.id}/permissions`).send({ role: "viewer", overrides: { "assets.view_all": "allow" } })).status).toBe(200);

    // STEC เพิ่ม app_id 7 → ผู้จัดการ ในการตรวจรอบถัดไป
    accounts.suda = [3, 7];
    const stale = () => exec("UPDATE external_sessions SET profile_checked_at = ? WHERE user_id = ?", [toDbDateTime(new Date(Date.now() - 11 * 60_000)), user.id]);
    await stale();
    expect((await withToken(res.body.token).get("/api/v1/auth/me")).body.data.role).toBe("manager");
    const log = await first<{ before: unknown; after: unknown }>("SELECT \"before\", \"after\" FROM audit_logs WHERE action = 'api_user.role_synced' AND subject_id = ?", [String(user.id)]);
    expect(log).toMatchObject({ before: { role: "viewer" }, after: { role: "manager", role_code: "3,7" } });

    // ถอด app_id 7 → กลับเป็นบทบาทตั้งต้น
    accounts.suda = [3];
    await stale();
    expect((await withToken(res.body.token).get("/api/v1/auth/me")).body.data.role).toBe("viewer");

    // ตำแหน่งผู้ดูแลระบบตั้งในโปรแกรม IT ได้ (แม้ซิงก์ตำแหน่งอยู่) และการซิงก์ไม่ทับ
    expect((await admin.put(`/api/v1/users/${user.id}/permissions`).send({ role: "super_admin" })).status).toBe(200);
    accounts.suda = [3, 7];
    await stale();
    expect((await withToken(res.body.token).get("/api/v1/auth/me")).body.data.role).toBe("super_admin");
  });

  it("wrong password is a normal login failure; revoked access at the source ends the session", async () => {
    const conn = await stecConnection();
    expect((await login(conn, "somchai", "wrong")).status).toBe(422);

    const res = await login(conn, "somchai");
    const user = (await first<UserRow>("SELECT id FROM users WHERE external_id = 'somchai'"))!;
    delete accounts.somchai; // ต้นทางยกเลิกบัญชี → /auth/permissions ตอบ 401
    await exec("UPDATE external_sessions SET profile_checked_at = ? WHERE user_id = ?", [toDbDateTime(new Date(Date.now() - 11 * 60_000)), user.id]);
    expect((await withToken(res.body.token).get("/api/v1/auth/me")).status).toBe(401);
  });

  it("admin tools: health check, test login shows the mapping, $login only allowed for id/name", async () => {
    const conn = await stecConnection();
    const admin = await as(await makeUser({ role: "super_admin" }));

    const health = await admin.post(`/api/v1/api-connections/${conn}/health`);
    expect(health.body.data).toMatchObject({ ok: true, status: 200 });
    healthStatus = 503;
    expect((await admin.post(`/api/v1/api-connections/${conn}/health`)).body.data).toMatchObject({ ok: false, status: 503 });

    const test = await admin.post(`/api/v1/api-connections/${conn}/test`).send({ username: "somchai", password: PASSWORD });
    expect(test.body.data).toMatchObject({ ok: true, profile: { external_id: "somchai", name: "somchai", role_code: "3,7", role: "manager" } });

    const ok = await admin.put(`/api/v1/api-connections/${conn}`).send({ field_map: { external_id: "$login", name: "$login", role_code: "appIds" } });
    expect(ok.status).toBe(200);
    const bad = await admin.put(`/api/v1/api-connections/${conn}`).send({ field_map: { external_id: "$login", role_code: "$login" } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toHaveProperty(["field_map.role_code"]);
  });

  it("login page status: online/offline from /health, cached for a minute, unknown without health_path", async () => {
    const conn = await stecConnection();
    const status = () => guest().get(`/api/v1/auth/connections/${conn}/status`).set("Accept", "application/json");

    expect((await status()).body.data.status).toBe("online");
    healthStatus = 503;
    expect((await status()).body.data.status).toBe("online"); // cache — ต้นทางถูกเรียกครั้งเดียว
    expect(calls.filter((c) => c.path === "/health")).toHaveLength(1);

    clearConnectionStatusCache();
    expect((await status()).body.data.status).toBe("offline");

    await exec("UPDATE api_connections SET health_path = NULL WHERE id = ?", [conn]);
    expect((await status()).body.data.status).toBe("unknown");
    await exec("UPDATE api_connections SET is_enabled = false WHERE id = ?", [conn]);
    expect((await status()).status).toBe(404);
  });
});
