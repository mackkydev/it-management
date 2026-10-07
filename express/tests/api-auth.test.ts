import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, first, insert, scalar, select } from "../src/db.js";
import { encryptString } from "../src/lib/laravel-crypt.js";
import { nowDb, toDbDateTime } from "../src/lib/time.js";
import type { UserRow } from "../src/models/user.js";
import { guardUrl, isPrivateAddress, setUpstreamTestHooks, UpstreamError, type UpstreamHttpRequest } from "../src/services/upstream-http.js";
import { as, guest, makeUser } from "./helpers.js";

/** เฟส 2 (API User): login ผ่านต้นทาง / JIT / session / การตั้งค่าการเชื่อมต่อ — ใช้ upstream จำลอง (ไม่ออกเน็ตจริง) */

const PASSWORD = "Upstream-Pass-123";
const UPSTREAM_TOKEN = "upstream-token-abc";

type Call = { method: string; url: URL; headers: Record<string, string>; body: string | undefined };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Handler = (c: Call) => Reply;

let calls: Call[] = [];
let routes: Record<string, Handler> = {};
let people: Record<string, { id: string; name: string; email?: string; position?: string }> = {};

/** ต้นทางจำลอง: POST /auth/login, GET /me, POST /auth/logout — host internal.corp = IP ภายใน */
function upstream(extra: Record<string, Handler> = {}) {
  calls = [];
  routes = {
    "POST /auth/login": (c) => {
      const body = JSON.parse(c.body ?? "{}");
      const person = people[body.user];
      if (!person) return { status: 404, body: { error: { code: "USER_NOT_FOUND" } } };
      if (body.pass !== PASSWORD) return { status: 401, body: { error: { code: "BAD_PASSWORD" } } };
      return { status: 200, body: { data: { access_token: `${UPSTREAM_TOKEN}-${person.id}`, expires_in: 86400 } } };
    },
    "GET /me": (c) => {
      const id = c.headers.Authorization?.replace(`Bearer ${UPSTREAM_TOKEN}-`, "");
      const person = Object.values(people).find((p) => p.id === id);
      return person ? { status: 200, body: { profile: person } } : { status: 401, body: {} };
    },
    "POST /auth/logout": () => ({ status: 204 }),
    ...extra,
  };
  setUpstreamTestHooks({
    resolve: async (host) => (host === "internal.corp" ? ["10.0.0.5"] : ["93.184.216.34"]),
    transport: async (req: UpstreamHttpRequest) => {
      const url = new URL(req.url);
      const call = { method: req.method, url, headers: req.headers, body: req.body };
      calls.push(call);
      const h = routes[`${req.method} ${url.pathname.replace(/^\/api/, "")}`];
      const r = h ? h(call) : { status: 404 };
      return { status: r.status, headers: r.headers ?? {}, body: r.body === undefined ? "" : JSON.stringify(r.body) };
    },
  });
}

async function makeConnection(attrs: Record<string, unknown> = {}): Promise<number> {
  return insert("api_connections", {
    name: "HR",
    is_enabled: true,
    base_url: "https://hr.example.com/api",
    login_path: "/auth/login",
    login_username_field: "user",
    login_password_field: "pass",
    profile_path: "/me",
    profile_root_path: "profile",
    logout_path: "/auth/logout",
    token_path: "data.access_token",
    token_ttl_path: "data.expires_in",
    field_map: JSON.stringify({ external_id: "id", name: "name", email: "email", role_code: "position" }),
    role_rules: JSON.stringify([{ value: "MGR", role: "manager" }]),
    error_code_path: "error.code",
    error_messages: JSON.stringify({
      USER_NOT_FOUND: { kind: "invalid", message_th: "ไม่พบผู้ใช้นี้" },
      PWD_EXPIRED: { kind: "password_expired", message_th: "รหัสผ่านหมดอายุ — เปลี่ยนที่ hr.example.com" },
      LOCKED: { kind: "locked" },
    }),
    created_at: nowDb(),
    updated_at: nowDb(),
    ...attrs,
  });
}

const login = (connectionId: number, username: string, password = PASSWORD) =>
  guest().post("/api/v1/auth/api-login").set("Accept", "application/json").set("Accept-Language", "th").send({ connection_id: connectionId, username, password, device_name: "vitest" });

const withToken = (token: string) => ({
  get: (url: string) => guest().get(url).set("Accept", "application/json").set("Authorization", `Bearer ${token}`),
  post: (url: string) => guest().post(url).set("Accept", "application/json").set("Authorization", `Bearer ${token}`),
});

const userByExternal = (externalId: string) => first<UserRow>("SELECT * FROM users WHERE external_id = ?", [externalId]);

beforeEach(() => {
  people = {
    somchai: { id: "E100", name: "สมชาย ใจดี", email: "somchai@corp.example", position: "MGR" },
    suda: { id: "E200", name: "สุดา", position: "STAFF" },
  };
  upstream();
});

afterEach(() => setUpstreamTestHooks(null));

describe("API users — login through the upstream API", () => {
  it("first login creates the user (JIT) with the mapped role, stores no password and keeps the upstream token server-side only", async () => {
    const conn = await makeConnection();
    const res = await login(conn, "somchai");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "สมชาย ใจดี", email: "somchai@corp.example", role: "manager", type: "API" });
    expect(JSON.stringify(res.body)).not.toContain(UPSTREAM_TOKEN);

    // ส่งชื่อ field ตามที่ตั้งค่าไว้
    expect(JSON.parse(calls[0].body!)).toEqual({ user: "somchai", pass: PASSWORD });
    expect(calls[0].url.toString()).toBe("https://hr.example.com/api/auth/login");

    const user = (await userByExternal("E100"))!;
    expect(user.password).toBeNull();
    expect(user.connection_id).toBe(conn);
    const session = await first<{ access_token: string; expires_at: string }>("SELECT * FROM external_sessions WHERE user_id = ?", [user.id]);
    expect(session!.access_token).not.toContain(UPSTREAM_TOKEN); // เข้ารหัสแล้ว

    expect((await withToken(res.body.token).get("/api/v1/auth/me")).body.data).toMatchObject({ id: user.id, type: "API" });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'api_user.provisioned'")).toBe(1);
  });

  it("unmapped role codes become the least-privileged role", async () => {
    const res = await login(await makeConnection(), "suda");
    expect(res.body.user).toMatchObject({ role: "viewer", email: null });
  });

  it("later logins update the profile and the mapped role — never the IT flags or other data set by an admin", async () => {
    const conn = await makeConnection();
    await login(conn, "somchai");
    const user = (await userByExternal("E100"))!;
    await exec("UPDATE users SET role = 'viewer', is_it_staff = true, department = 'IT' WHERE id = ?", [user.id]);
    people.somchai.name = "สมชาย (เปลี่ยนชื่อ)";

    // role ตามต้นทาง (position MGR → manager) ทุกครั้ง
    const again = await login(conn, "somchai");
    expect(again.body.user).toMatchObject({ name: "สมชาย (เปลี่ยนชื่อ)", role: "manager", is_it_staff: true, department: "IT" });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'api_user.role_synced' AND subject_id = ?", [String(user.id)])).toBeTruthy();
  });

  it("without a role_code mapping the role set by an admin is kept", async () => {
    const conn = await makeConnection({ field_map: JSON.stringify({ external_id: "id", name: "name", email: "email" }) });
    await login(conn, "somchai");
    const user = (await userByExternal("E100"))!;
    expect(user.role).toBe("viewer");
    await exec("UPDATE users SET role = 'manager' WHERE id = ?", [user.id]);
    expect((await login(conn, "somchai")).body.user.role).toBe("manager");
  });

  it("wrong password and unknown user give the same generic message (even if an admin wrote a revealing one)", async () => {
    const conn = await makeConnection();
    const bad = await login(conn, "somchai", "wrong");
    const unknown = await login(conn, "nobody");
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual({ username: ["ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"] });
    expect(unknown.body.errors).toEqual(bad.body.errors);
  });

  it("maps upstream error codes: expired password, locked account", async () => {
    const conn = await makeConnection();
    routes["POST /auth/login"] = () => ({ status: 403, body: { error: { code: "PWD_EXPIRED" } } });
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("รหัสผ่านหมดอายุ — เปลี่ยนที่ hr.example.com");
    routes["POST /auth/login"] = () => ({ status: 423, body: { error: { code: "LOCKED" } } });
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("บัญชีถูกล็อก กรุณาติดต่อผู้ดูแลระบบต้นทาง");
  });

  it("an upstream outage or a broken config gives a clear message", async () => {
    const conn = await makeConnection();
    setUpstreamTestHooks({ resolve: async () => ["93.184.216.34"], transport: async () => Promise.reject(new UpstreamError("timeout")) });
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("ไม่สามารถเชื่อมต่อระบบต้นทางได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง");

    upstream();
    await exec("UPDATE api_connections SET token_path = 'data.missing' WHERE id = ?", [conn]);
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("การตั้งค่าการเชื่อมต่อไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ");
    expect(await scalar("SELECT COUNT(*) FROM users WHERE type = 'API'")).toBe(0);
  });

  it("disabled users and disabled connections cannot sign in", async () => {
    const conn = await makeConnection();
    await login(conn, "somchai");
    await exec("UPDATE users SET is_active = false WHERE external_id = 'E100'");
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("บัญชีนี้ถูกปิดใช้งาน");
    expect(calls.some((c) => c.url.pathname === "/api/auth/logout")).toBe(true); // คืน token ที่ต้นทาง

    await exec("UPDATE api_connections SET is_enabled = false WHERE id = ?", [conn]);
    expect((await login(conn, "suda")).body.errors.username[0]).toBe("ช่องทางเข้าสู่ระบบนี้ปิดใช้งานอยู่");
  });

  it("e-mail: a clash with another user leaves it empty and logs a conflict; no upstream e-mail keeps ours", async () => {
    await makeUser({ email: "somchai@corp.example" }); // LOCAL ที่ใช้อีเมลนี้อยู่แล้ว
    const conn = await makeConnection();
    expect((await login(conn, "somchai")).body.user.email).toBeNull();
    await login(conn, "somchai");
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'api_user.email_conflict'")).toBe(1); // ไม่บันทึกซ้ำ

    await login(conn, "suda");
    await exec("UPDATE users SET email = 'suda@local.example' WHERE external_id = 'E200'");
    expect((await login(conn, "suda")).body.user.email).toBe("suda@local.example");
  });

  it("the local login form and the API login never mix", async () => {
    const conn = await makeConnection();
    await login(conn, "somchai");
    const local = await guest().post("/api/v1/auth/login").send({ email: "somchai@corp.example", password: PASSWORD, device_name: "t" });
    expect(local.status).toBe(422);
  });

  it("passwords and tokens never reach the logs", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const conn = await makeConnection();
    await login(conn, "somchai");
    await login(conn, "somchai", "wrong");
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
    spies.forEach((s) => s.mockRestore());
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(UPSTREAM_TOKEN);
  });
});

describe("API users — session", () => {
  async function signedIn() {
    const conn = await makeConnection();
    const res = await login(conn, "somchai");
    const tokenId = Number(String(res.body.token).split("|")[0]);
    return { conn, token: res.body.token as string, tokenId };
  }

  it("session never outlives the upstream token", async () => {
    const conn = await makeConnection({ token_ttl_path: null, default_token_ttl_seconds: 600 });
    const res = await login(conn, "somchai");
    const expires = new Date(res.body.expires_at).getTime();
    expect(expires).toBeLessThanOrEqual(Date.now() + 600_000 + 2000);
  });

  it("idle for more than 30 minutes → must sign in again", async () => {
    const { token, tokenId } = await signedIn();
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(200);
    await exec("UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?", [toDbDateTime(new Date(Date.now() - 31 * 60_000)), tokenId]);
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(401);
    expect(await scalar("SELECT COUNT(*) FROM external_sessions")).toBe(0);
  });

  it("upstream token expired (no refresh token) → 401 and the session is cleared", async () => {
    const { token, tokenId } = await signedIn();
    await exec("UPDATE external_sessions SET expires_at = ? WHERE token_id = ?", [toDbDateTime(new Date(Date.now() - 1000)), tokenId]);
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(401);
    expect(await scalar("SELECT COUNT(*) FROM personal_access_tokens WHERE id = ?", [tokenId])).toBe(0);
  });

  it("revalidates with the upstream every 10 minutes: 401 there ends the session, otherwise the profile syncs", async () => {
    const { token, tokenId } = await signedIn();
    const stale = () => exec("UPDATE external_sessions SET profile_checked_at = ? WHERE token_id = ?", [toDbDateTime(new Date(Date.now() - 11 * 60_000)), tokenId]);

    people.somchai.name = "ชื่อใหม่จากต้นทาง";
    await stale();
    expect((await withToken(token).get("/api/v1/auth/me")).body.data.name).toBe("ชื่อใหม่จากต้นทาง");

    const before = calls.length;
    await withToken(token).get("/api/v1/auth/me"); // ยังอยู่ใน cache → ไม่เรียกต้นทาง
    expect(calls.length).toBe(before);

    routes["GET /me"] = () => ({ status: 401 });
    await stale();
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(401);
  });

  it("an upstream outage during revalidation does not log the user out", async () => {
    const { token, tokenId } = await signedIn();
    await exec("UPDATE external_sessions SET profile_checked_at = ? WHERE token_id = ?", [toDbDateTime(new Date(Date.now() - 11 * 60_000)), tokenId]);
    routes["GET /me"] = () => ({ status: 503 });
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(200);
  });

  it("deactivating the user or the connection cuts existing sessions", async () => {
    const a = await signedIn();
    await exec("UPDATE users SET is_active = false WHERE id = (SELECT user_id FROM external_sessions WHERE token_id = ?)", [a.tokenId]);
    expect((await withToken(a.token).get("/api/v1/auth/me")).status).toBe(401);

    const res = await login(a.conn, "suda");
    const admin = await as(await makeUser({ role: "super_admin" }));
    expect((await admin.patch(`/api/v1/api-connections/${a.conn}`).send({ is_enabled: false })).status).toBe(200);
    expect((await withToken(res.body.token).get("/api/v1/auth/me")).status).toBe(401);
  });

  it("logout revokes at the upstream and clears our session", async () => {
    const { token } = await signedIn();
    expect((await withToken(token).post("/api/v1/auth/logout")).status).toBe(204);
    const logout = calls.find((c) => c.url.pathname === "/api/auth/logout")!;
    expect(logout.headers.Authorization).toBe(`Bearer ${UPSTREAM_TOKEN}-E100`);
    expect(await scalar("SELECT COUNT(*) FROM external_sessions")).toBe(0);
    expect((await withToken(token).get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("API users — SSRF protection", () => {
  it("blocks private / loopback / link-local addresses unless allow-listed", async () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.1", "::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    await expect(guardUrl("http://hr.example.com", [])).rejects.toMatchObject({ kind: "insecure" });
    await expect(guardUrl("https://user:pw@hr.example.com", [])).rejects.toMatchObject({ kind: "insecure" });
    await expect(guardUrl("https://169.254.169.254/latest", [])).rejects.toMatchObject({ kind: "blocked" });
    await expect(guardUrl("https://internal.corp", [])).rejects.toMatchObject({ kind: "blocked" });
    await expect(guardUrl("https://internal.corp", ["internal.corp"])).resolves.toBeInstanceOf(URL);
    await expect(guardUrl("https://internal.corp", ["10.0.0.0/8"])).resolves.toBeInstanceOf(URL);
  });

  it("an internal upstream needs an allowlist entry; redirects are limited and re-checked", async () => {
    const conn = await makeConnection({ base_url: "https://internal.corp/api" });
    expect((await login(conn, "somchai")).body.errors.username[0]).toBe("การตั้งค่าการเชื่อมต่อไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ");
    expect(calls).toHaveLength(0); // ไม่ได้ส่ง request ออกไปเลย

    await exec("UPDATE api_connections SET allowed_hosts = ? WHERE id = ?", [JSON.stringify(["internal.corp"]), conn]);
    expect((await login(conn, "somchai")).status).toBe(200);

    const other = await makeConnection({ name: "Redirect", max_redirects: 1 });
    routes["POST /auth/login"] = () => ({ status: 307, headers: { location: "https://169.254.169.254/steal" } });
    expect((await login(other, "somchai")).body.errors.username[0]).toBe("การตั้งค่าการเชื่อมต่อไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ");
    expect(calls.some((c) => c.url.hostname === "169.254.169.254")).toBe(false);
  });
});

describe("API connections — admin settings", () => {
  const body = {
    name: "ระบบ HR",
    base_url: "https://hr.example.com/api",
    login_path: "/auth/login",
    login_username_field: "user",
    login_password_field: "pass",
    token_path: "data.access_token",
    profile_path: "/me",
    profile_root_path: "profile",
    field_map: { external_id: "id", name: "name", email: "email", role_code: "position" },
    role_rules: [{ value: "MGR", role: "manager" }],
    auth_type: "api_key",
    auth_header_name: "X-Api-Key",
    auth_secret: "super-secret-key",
  };

  it("only local admins can manage connections", async () => {
    expect((await (await as(await makeUser({ role: "manager" }))).get("/api/v1/api-connections")).status).toBe(403);
    // API User ที่ admin ตั้ง role เป็น admin ก็ยังจัดการการเชื่อมต่อไม่ได้ (เฉพาะ Local Admin)
    const conn = await makeConnection();
    const res = await login(conn, "somchai");
    await exec("UPDATE users SET role = 'admin' WHERE external_id = 'E100'");
    expect((await withToken(res.body.token).get("/api/v1/api-connections")).status).toBe(403);
  });

  it("creates a connection: secret is encrypted, never returned, and every change is audited without it", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const created = await admin.post("/api/v1/api-connections").send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "ระบบ HR", has_auth_secret: true, is_enabled: false, users_count: 0 });
    expect(JSON.stringify(created.body)).not.toContain("super-secret-key");
    const stored = await scalar<string>("SELECT auth_secret FROM api_connections WHERE id = ?", [created.body.data.id]);
    expect(stored).not.toContain("super-secret-key");

    // แก้โดยไม่ส่ง secret → คงเดิม
    const id = created.body.data.id;
    const edited = await admin.patch(`/api/v1/api-connections/${id}`).send({ name: "HR ใหม่", is_enabled: true });
    expect(edited.body.data).toMatchObject({ name: "HR ใหม่", has_auth_secret: true, is_enabled: true });
    expect(await scalar("SELECT auth_secret FROM api_connections WHERE id = ?", [id])).toBe(stored);

    const logs = await select<{ action: string; before: unknown; after: unknown }>('SELECT action, "before", "after" FROM audit_logs ORDER BY id');
    expect(logs.map((l) => l.action)).toEqual(["api_connection.created", "api_connection.updated"]);
    expect(JSON.stringify(logs)).not.toContain("super-secret-key");
    expect(JSON.stringify(logs)).not.toContain(stored!);

    // secret ถูกส่งไปที่ต้นทางใน header ที่ตั้งไว้
    await admin.post(`/api/v1/api-connections/${id}/test`).send({ username: "somchai", password: PASSWORD });
    expect(calls[0].headers["X-Api-Key"]).toBe("super-secret-key");
  });

  it("rejects insecure or malformed settings", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    const res = await admin.post("/api/v1/api-connections").send({
      ...body,
      base_url: "http://hr.example.com",
      login_path: "https://evil.example.com/x",
      token_path: "data[0]",
      role_rules: [{ value: "BOSS", role: "admin" }],
      allowed_hosts: ["10.0.0.0/99", "ok.host"],
      error_messages: { X: { kind: "whatever" } },
      auth_type: "bearer",
      auth_secret: null,
      forgot_password_url: "javascript:alert(1)",
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(
      ["allowed_hosts.0", "auth_secret", "base_url", "error_messages.X", "forgot_password_url", "login_path", "role_rules.0.role", "token_path"].sort(),
    );
    expect(res.body.errors.base_url[0]).toContain("https://");
  });

  it("test button logs in for real, shows the mapping, returns no token and logs out again", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const conn = await makeConnection({ is_enabled: false });
    const res = await admin.post(`/api/v1/api-connections/${conn}/test`).send({ username: "somchai", password: PASSWORD });
    expect(res.body.data).toMatchObject({
      ok: true,
      profile: { external_id: "E100", name: "สมชาย ใจดี", email: "somchai@corp.example", role_code: "MGR", role: "manager" },
    });
    expect(JSON.stringify(res.body)).not.toContain(UPSTREAM_TOKEN);
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/auth/login", "/api/me", "/api/auth/logout"]);
    expect(await scalar("SELECT COUNT(*) FROM users WHERE type = 'API'")).toBe(0);

    const fail = await admin.post(`/api/v1/api-connections/${conn}/test`).send({ username: "somchai", password: "x" });
    expect(fail.body.data).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("the login page lists only enabled connections, without any settings", async () => {
    await makeConnection({ name: "On", forgot_password_url: "https://hr.example.com/forgot", auth_type: "bearer", auth_secret: encryptString("s") });
    await makeConnection({ name: "Off", is_enabled: false });
    const res = await guest().get("/api/v1/auth/connections");
    expect(res.body.data).toEqual([{ id: 1, name: "On", register_url: null, forgot_password_url: "https://hr.example.com/forgot" }]);
  });

  it("a connection with users cannot be deleted", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const conn = await makeConnection();
    await login(conn, "somchai");
    expect((await admin.delete(`/api/v1/api-connections/${conn}`)).status).toBe(422);
    const empty = await makeConnection({ name: "Empty" });
    expect((await admin.delete(`/api/v1/api-connections/${empty}`)).status).toBe(204);
  });
});
