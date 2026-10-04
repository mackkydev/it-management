import { describe, expect, it } from "vitest";
import { first, insert } from "../src/db.js";
import { encryptString } from "../src/lib/laravel-crypt.js";
import { nowDb, toDbDateTime } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import { apiConnectionResource, type ApiConnectionRow } from "../src/models/api-connection.js";
import type { UserRow } from "../src/models/user.js";
import { as, guest, makeUser } from "./helpers.js";

/** เฟส 1 (API User): โครงสร้างตาราง + ผู้ใช้เดิม (LOCAL) ต้องใช้งานได้เหมือนเดิม */

async function makeConnection(attrs: Record<string, unknown> = {}): Promise<number> {
  return insert("api_connections", { name: "HR", base_url: "https://hr.example.com", login_path: "/auth/login", created_at: nowDb(), updated_at: nowDb(), ...attrs });
}

async function makeApiUser(connectionId: number, attrs: Record<string, unknown> = {}): Promise<UserRow> {
  const id = await insert("users", {
    name: "API Person",
    email: "api.person@example.com",
    role: "viewer",
    type: "API",
    connection_id: connectionId,
    external_id: "E-001",
    created_at: nowDb(),
    updated_at: nowDb(),
    ...attrs,
  });
  return (await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
}

describe("API users — schema (phase 1)", () => {
  it("existing users default to LOCAL and keep logging in with email + password", async () => {
    const local = await makeUser({ email: "local@example.com", password: "secret-pass" });
    expect(local.type).toBe("LOCAL");
    const ok = await guest().post("/api/v1/auth/login").send({ email: "local@example.com", password: "secret-pass", device_name: "vitest" });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: "local@example.com", type: "LOCAL" });
  });

  it("the local login form never signs in an API user (same generic message as a wrong password)", async () => {
    const api = await makeApiUser(await makeConnection());
    const res = await guest().post("/api/v1/auth/login").set("Accept-Language", "th").send({ email: api.email, password: "anything", device_name: "vitest" });
    const wrong = await guest().post("/api/v1/auth/login").set("Accept-Language", "th").send({ email: "nobody@example.com", password: "anything", device_name: "vitest" });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(wrong.body.errors);
  });

  it("API users cannot change a password in our system", async () => {
    const conn = await makeConnection({ is_enabled: true });
    const user = await makeApiUser(conn);
    // session ของ API User ต้องมี token ต้นทางคู่กัน (token ที่ไม่มี session → 401)
    const token = await createToken(user.id, "t", null);
    await insert("external_sessions", {
      token_id: token.id, user_id: user.id, connection_id: conn, access_token: encryptString("upstream"),
      expires_at: toDbDateTime(new Date(Date.now() + 3600_000)), profile_checked_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
    });
    const res = await guest()
      .put("/api/v1/auth/password")
      .set("Authorization", `Bearer ${token.plainText}`)
      .send({ current_password: "x", password: "NewPass-123", password_confirmation: "NewPass-123" });
    expect(res.status).toBe(403);
    expect((await (await as(user)).get("/api/v1/auth/me")).status).toBe(401);
  });

  it("database rules: LOCAL needs email + password, API needs connection + external id and no password", async () => {
    const conn = await makeConnection();
    const base = { name: "x", role: "viewer", created_at: nowDb(), updated_at: nowDb() };
    await expect(insert("users", { ...base, email: "nopass@example.com" })).rejects.toThrow(/users_local_credentials_check/);
    await expect(insert("users", { ...base, type: "API", connection_id: conn, external_id: "E-9", password: "hash" })).rejects.toThrow(/users_api_identity_check/);
    await expect(insert("users", { ...base, type: "API" })).rejects.toThrow(/users_api_identity_check/);
    await expect(insert("users", { ...base, type: "OTHER", email: "o@example.com", password: "h" })).rejects.toThrow(/users_type_check/);

    // API User ไม่มีอีเมลได้ / external_id ซ้ำในการเชื่อมต่อเดียวกันไม่ได้ แต่ซ้ำข้ามการเชื่อมต่อได้
    await makeApiUser(conn, { email: null, external_id: "E-1" });
    await expect(makeApiUser(conn, { email: null, external_id: "E-1" })).rejects.toThrow(/users_connection_id_external_id_unique/);
    await makeApiUser(await makeConnection({ name: "ERP" }), { email: null, external_id: "E-1" });
  });

  it("connection JSON never contains the stored secret", async () => {
    const id = await makeConnection({ auth_type: "bearer", auth_secret: "ciphertext-value" });
    const row = (await first<ApiConnectionRow>("SELECT * FROM api_connections WHERE id = ?", [id]))!;
    const json = apiConnectionResource(row);
    expect(json).not.toHaveProperty("auth_secret");
    expect(json.has_auth_secret).toBe(true);
    expect(JSON.stringify(json)).not.toContain("ciphertext-value");
  });
});
