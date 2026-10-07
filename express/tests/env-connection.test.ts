import { afterEach, describe, expect, it } from "vitest";
import { exec, first } from "../src/db.js";
import type { ApiConnectionRow } from "../src/models/api-connection.js";
import { ensureEnvConnection } from "../src/services/env-connection.js";
import { as, makeUser } from "./helpers.js";

const ENV = {
  API_CONN_BASE_URL: "https://stec.example.com",
  API_CONN_ROLE_RULES: "7:manager, 9:viewer",
  API_CONN_ALLOWED_HOSTS: "stec.example.com, 10.0.0.0/8",
};

afterEach(() => ensureEnvConnection({})); // ล้างสถานะล็อก (โหมด env) ระหว่างเทสต์

describe("API connection from .env (fallback when not set up in the web UI)", () => {
  it("does nothing without API_CONN_BASE_URL", async () => {
    expect(await ensureEnvConnection({})).toEqual({ status: "skipped" });
    expect(await first("SELECT 1 FROM api_connections")).toBeNull();
  });

  it("creates the connection once with the STEC defaults, then leaves it to the web UI", async () => {
    const r = await ensureEnvConnection(ENV);
    expect(r.status).toBe("created");
    const c = (await first<ApiConnectionRow>("SELECT * FROM api_connections WHERE name = 'STEC SyteLine API'"))!;
    expect(c).toMatchObject({
      is_enabled: true,
      base_url: "https://stec.example.com",
      login_path: "/api/v1/auth/login",
      profile_path: "/api/v1/auth/permissions",
      logout_path: "/api/v1/auth/logout",
      health_path: "/health",
      token_path: "token",
      token_ttl_path: "expiresAt",
      field_map: { external_id: "$login", name: "$login", role_code: "appIds" },
      role_rules: [{ value: "7", role: "manager" }, { value: "9", role: "viewer" }],
      default_role: "viewer",
      allowed_hosts: ["stec.example.com", "10.0.0.0/8"],
      auth_type: "none",
    });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'api_connection.created' AND subject_id = ?", [String(c.id)])).toBeTruthy();

    // admin แก้ในหน้าเว็บแล้ว — เปิด server ใหม่ (หรือแก้ .env) ไม่เขียนทับ
    await exec("UPDATE api_connections SET base_url = 'https://new.example.com' WHERE id = ?", [c.id]);
    expect(await ensureEnvConnection({ ...ENV, API_CONN_BASE_URL: "https://other.example.com" })).toEqual({ status: "exists", id: c.id });
    expect((await first<ApiConnectionRow>("SELECT base_url FROM api_connections WHERE id = ?", [c.id]))!.base_url).toBe("https://new.example.com");
  });

  it("invalid values are reported and nothing is created", async () => {
    const r = await ensureEnvConnection({ API_CONN_BASE_URL: "http://stec.example.com", API_CONN_ROLE_RULES: "7:admin" });
    expect(r.status).toBe("invalid");
    expect(Object.keys((r as { errors: Record<string, string[]> }).errors).sort()).toEqual(["base_url", "role_rules.0.role"]);
    expect(await first("SELECT 1 FROM api_connections")).toBeNull();
  });
});

describe("API_CONN_SOURCE=env: .env is the source of truth and the web UI is locked", () => {
  it("updates the existing row from .env on every start and blocks edits/deletes in the UI", async () => {
    const created = await ensureEnvConnection({ ...ENV, API_CONN_SOURCE: "env" });
    expect(created.status).toBe("created");
    const id = (created as { id: number }).id;

    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.get(`/api/v1/api-connections/${id}`)).body.data.managed_by_env).toBe(true);
    const put = await admin.put(`/api/v1/api-connections/${id}`).send({ base_url: "https://hack.example.com" });
    expect(put.status).toBe(422);
    expect(put.body.errors).toHaveProperty("connection");
    expect((await admin.delete(`/api/v1/api-connections/${id}`)).status).toBe(422);

    // แก้ .env แล้วเปิด server ใหม่ → อัปเดตแถวเดิม (ผู้ใช้ API ยังผูกกับ id เดิม)
    expect(await ensureEnvConnection({ ...ENV, API_CONN_SOURCE: "env", API_CONN_BASE_URL: "https://stec2.example.com", API_CONN_ENABLED: "false" })).toEqual({ status: "updated", id });
    expect(await first<ApiConnectionRow>("SELECT base_url, is_enabled FROM api_connections WHERE id = ?", [id])).toMatchObject({ base_url: "https://stec2.example.com", is_enabled: false });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'api_connection.updated' AND subject_id = ?", [String(id)])).toBeTruthy();

    // สลับกลับเป็น ui → ปลดล็อก ค่าล่าสุดยังอยู่
    expect(await ensureEnvConnection({ ...ENV, API_CONN_SOURCE: "ui" })).toEqual({ status: "exists", id });
    expect((await admin.get(`/api/v1/api-connections/${id}`)).body.data.managed_by_env).toBe(false);
    expect((await admin.put(`/api/v1/api-connections/${id}`).send({ base_url: "https://ui.example.com" })).status).toBe(200);
  });
});
