import { afterEach, describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import type { ApiConnectionRow } from "../src/models/api-connection.js";
import type { UserRow } from "../src/models/user.js";
import { dueConnections, syncConnection } from "../src/services/directory-sync.js";
import { setUpstreamTestHooks, type UpstreamHttpRequest } from "../src/services/upstream-http.js";
import { as, guest, makeUser } from "./helpers.js";

/** login ด้วยอีเมลหรือชื่อผู้ใช้ + ซิงค์รายชื่อ API User ตามเวลา */

afterEach(() => setUpstreamTestHooks(null));

describe("login with e-mail or username", () => {
  it("LOCAL users sign in with either (case-insensitive); wrong input gives one generic message", async () => {
    await makeUser({ email: "somsri@example.com", password: "Pass-1234", username: "Somsri" } as Partial<UserRow> & { password: string });
    const login = (body: Record<string, string>) => guest().post("/api/v1/auth/login").set("Accept-Language", "th").send({ password: "Pass-1234", device_name: "t", ...body });

    expect((await login({ login: "somsri" })).status).toBe(200);
    expect((await login({ login: "SOMSRI@example.com" })).status).toBe(200);
    expect((await login({ email: "somsri@example.com" })).status).toBe(200); // client เดิม
    const bad = await login({ login: "nobody" });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.email[0]).toBe("อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง");
    expect((await login({ login: "somsri", password: "wrong" })).body.errors).toEqual(bad.body.errors);
  });

  it("admins set a username: unique (case-insensitive), no @, searchable", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const u = await makeUser({ name: "Kanya" });
    expect((await admin.patch(`/api/v1/users/${u.id}`).send({ username: "kanya.p" })).body.data.username).toBe("kanya.p");
    const other = await makeUser();
    const dup = await admin.patch(`/api/v1/users/${other.id}`).send({ username: "KANYA.P" });
    expect(dup.status).toBe(422);
    expect((await admin.patch(`/api/v1/users/${other.id}`).send({ username: "a@b" })).status).toBe(422);
    expect((await admin.get("/api/v1/users?manage=1&search=kanya.p")).body.data.map((x: { id: number }) => x.id)).toEqual([u.id]);
    expect((await admin.patch(`/api/v1/users/${u.id}`).send({ username: null })).body.data.username).toBeNull();
  });
});

describe("scheduled directory sync for API users", () => {
  let directory: Array<{ id: string; name: string; email?: string; status: string; position?: string }> = [];
  let calls: string[] = [];

  function upstream(fail = false) {
    calls = [];
    setUpstreamTestHooks({
      resolve: async () => ["93.184.216.34"],
      transport: async (req: UpstreamHttpRequest) => {
        const url = new URL(req.url);
        calls.push(`${url.pathname}${url.search}|${req.headers["X-API-Key"] ?? ""}`);
        if (fail) return { status: 503, headers: {}, body: "" };
        const page = Number(url.searchParams.get("page") ?? 1);
        const size = Number(url.searchParams.get("per_page") ?? 100);
        const items = directory.slice((page - 1) * size, page * size);
        return { status: 200, headers: {}, body: JSON.stringify({ data: { items } }) };
      },
    });
  }

  async function connection(attrs: Record<string, unknown> = {}): Promise<ApiConnectionRow> {
    const { encryptString } = await import("../src/lib/laravel-crypt.js");
    const id = await insert("api_connections", {
      name: "HR",
      is_enabled: true,
      base_url: "https://hr.example.com",
      login_path: "/login",
      auth_type: "api_key",
      auth_header_name: "X-API-Key",
      auth_secret: encryptString("dir-key"),
      field_map: JSON.stringify({ external_id: "id", name: "name", email: "email", role_code: "position", status: "status" }),
      role_rules: JSON.stringify([{ value: "MGR", role: "manager" }]),
      users_list_path: "/users",
      users_list_root_path: "data.items",
      users_page_param: "page",
      users_page_size_param: "per_page",
      users_page_size: 2,
      active_values: JSON.stringify(["active"]),
      sync_interval_minutes: 60,
      created_at: nowDb(),
      updated_at: nowDb(),
      ...attrs,
    });
    return (await first<ApiConnectionRow>("SELECT * FROM api_connections WHERE id = ?", [id]))!;
  }
  const byExt = (ext: string) => first<UserRow>("SELECT * FROM users WHERE external_id = ?", [ext]);

  it("pre-creates active users (all pages, connection auth), skips disabled ones, keeps the role in line with the source", async () => {
    directory = [
      { id: "E1", name: "สมชาย", email: "somchai@corp.example", status: "active", position: "MGR" },
      { id: "E2", name: "สุดา", status: "active" },
      { id: "E3", name: "ปิดอยู่", status: "disabled" },
    ];
    upstream();
    const conn = await connection();
    const r = await syncConnection(conn);
    expect(r).toMatchObject({ ok: true, fetched: 3, created: 2, skipped: 1, disabled: 0 });
    expect(calls).toEqual(["/users?page=1&per_page=2|dir-key", "/users?page=2&per_page=2|dir-key"]);
    expect(await byExt("E1")).toMatchObject({ role: "manager", is_active: true, external_status: "active", password: null });
    expect(await byExt("E3")).toBeNull();

    await exec("UPDATE users SET role = 'viewer' WHERE external_id = 'E1'");
    directory[0].name = "สมชาย (ใหม่)";
    await syncConnection(conn);
    // role ตามต้นทาง (position MGR → manager) ทุกรอบซิงก์
    expect(await byExt("E1")).toMatchObject({ role: "manager", name: "สมชาย (ใหม่)" });
  });

  it("disables users disabled or removed at the source (cutting sessions) and re-enables only those it disabled", async () => {
    directory = [
      { id: "E1", name: "A", status: "active" },
      { id: "E2", name: "B", status: "active" },
      { id: "E3", name: "C", status: "active" },
    ];
    upstream();
    const conn = await connection();
    await syncConnection(conn);
    const e1 = (await byExt("E1"))!;
    await createToken(e1.id, "session", null);

    directory = [
      { id: "E1", name: "A", status: "disabled" },
      { id: "E2", name: "B", status: "active" },
    ];
    // admin ปิด E2 เอง → ซิงค์ต้องไม่เปิดคืน
    await exec("UPDATE users SET is_active = false WHERE external_id = 'E2'");
    const r = await syncConnection(conn);
    expect(r).toMatchObject({ ok: true, disabled: 1, missing: 1, reactivated: 0 });
    expect(await byExt("E1")).toMatchObject({ is_active: false, external_status: "disabled" });
    expect(await byExt("E3")).toMatchObject({ is_active: false, external_status: "missing" });
    expect(await scalar("SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_id = ?", [e1.id])).toBe(0);

    directory = [
      { id: "E1", name: "A", status: "active" },
      { id: "E2", name: "B", status: "active" },
      { id: "E3", name: "C", status: "active" },
    ];
    const back = await syncConnection(conn);
    expect(back.reactivated).toBe(2);
    expect((await byExt("E1"))!.is_active).toBe(true);
    expect((await byExt("E3"))!.is_active).toBe(true);
    expect((await byExt("E2"))!.is_active).toBe(false); // admin ปิดไว้
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'api_connection.synced'")).toBeGreaterThan(0);
  });

  it("a failed or empty fetch never disables anyone", async () => {
    directory = [{ id: "E1", name: "A", status: "active" }];
    upstream();
    const conn = await connection();
    await syncConnection(conn);

    upstream(true);
    const failed = await syncConnection(conn);
    expect(failed).toMatchObject({ ok: false, error: "http_503", missing: 0 });
    directory = [];
    upstream();
    expect((await syncConnection(conn)).missing).toBe(0);
    expect((await byExt("E1"))!.is_active).toBe(true);
    const saved = await first<ApiConnectionRow>("SELECT * FROM api_connections WHERE id = ?", [conn.id]);
    expect(saved!.last_sync_result).toMatchObject({ ok: true, fetched: 0 });
  });

  it("only due connections are synced by the scheduler; local admins can sync now", async () => {
    directory = [{ id: "E1", name: "A", status: "active" }];
    upstream();
    const conn = await connection();
    await connection({ name: "Off", sync_interval_minutes: 0 });
    expect((await dueConnections()).map((c) => c.id)).toEqual([conn.id]);
    await syncConnection(conn);
    expect(await dueConnections()).toEqual([]);

    const admin = await as(await makeUser({ role: "super_admin" }));
    const res = await admin.post(`/api/v1/api-connections/${conn.id}/sync`);
    expect(res.body.data).toMatchObject({ ok: true, fetched: 1 });
    expect((await (await as(await makeUser({ role: "manager" }))).post(`/api/v1/api-connections/${conn.id}/sync`)).status).toBe(403);
    const plain = await connection({ name: "No list", users_list_path: null });
    expect((await admin.post(`/api/v1/api-connections/${plain.id}/sync`)).status).toBe(422);
  });
});
