import { exec, first, insert, update } from "../db.js";
import { ValidationError } from "../lib/errors.js";
import { nowDb } from "../lib/time.js";
import { apiConnectionResource } from "../models/api-connection.js";
import { connectionRowFromInput } from "../routes/api-connections.js";
import { loadConnection, LOGIN_USERNAME } from "./api-auth.js";
import { audit } from "./audit.js";

type Env = Record<string, string | undefined>;

export type EnvConnectionResult =
  | { status: "skipped" } // ไม่ได้ตั้ง API_CONN_BASE_URL
  | { status: "exists"; id: number } // มีการเชื่อมต่อชื่อนี้แล้ว — ค่าจากหน้าเว็บมีผล
  | { status: "created"; id: number }
  | { status: "updated"; id: number } // โหมด env: อัปเดตตาม .env แล้ว
  | { status: "invalid"; errors: Record<string, string[]> };

const val = (env: Env, key: string): string | undefined => {
  const v = env[key]?.trim().replace(/^"(.*)"$/, "$1");
  return v === undefined || v === "" ? undefined : v;
};
const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** "7:manager, 9:viewer" → [{ value: "7", role: "manager" }, ...] */
const roleRules = (s: string | undefined) =>
  list(s).map((pair) => {
    const i = pair.lastIndexOf(":");
    return i < 0 ? { value: pair, role: "" } : { value: pair.slice(0, i).trim(), role: pair.slice(i + 1).trim() };
  });

/** ค่าจาก API_CONN_* — ค่าที่ไม่ได้ตั้ง = ค่าตามคู่มือ STEC SyteLine API (เหมือนปุ่ม "ตั้งค่าตามคู่มือ STEC" ในหน้าเว็บ) */
export function envConnectionInput(env: Env): Record<string, unknown> | null {
  const baseUrl = val(env, "API_CONN_BASE_URL");
  if (!baseUrl) return null;
  const input: Record<string, unknown> = {
    name: val(env, "API_CONN_NAME") ?? "STEC SyteLine API",
    is_enabled: (val(env, "API_CONN_ENABLED") ?? "true").toLowerCase() !== "false",
    base_url: baseUrl,
    login_method: "POST",
    login_path: val(env, "API_CONN_LOGIN_PATH") ?? "/api/v1/auth/login",
    login_username_field: "username",
    login_password_field: "password",
    login_body_type: "json",
    token_path: val(env, "API_CONN_TOKEN_PATH") ?? "token",
    token_ttl_path: val(env, "API_CONN_TOKEN_TTL_PATH") ?? "expiresAt",
    logout_path: val(env, "API_CONN_LOGOUT_PATH") ?? "/api/v1/auth/logout",
    health_path: val(env, "API_CONN_HEALTH_PATH") ?? "/health",
    profile_method: "GET",
    profile_path: val(env, "API_CONN_PROFILE_PATH") ?? "/api/v1/auth/permissions",
    field_map: { external_id: LOGIN_USERNAME, name: LOGIN_USERNAME, role_code: val(env, "API_CONN_ROLE_CODE_PATH") ?? "appIds" },
    role_rules: roleRules(val(env, "API_CONN_ROLE_RULES")),
    default_role: val(env, "API_CONN_DEFAULT_ROLE") ?? "viewer",
    allowed_hosts: list(val(env, "API_CONN_ALLOWED_HOSTS")),
    auth_type: "none",
    sync_interval_minutes: 0,
  };
  const timeout = val(env, "API_CONN_TIMEOUT_MS");
  if (timeout) input.timeout_ms = Number(timeout);
  for (const [key, field] of [["API_CONN_FORGOT_PASSWORD_URL", "forgot_password_url"], ["API_CONN_CHANGE_PASSWORD_URL", "change_password_url"]] as const) {
    const v = val(env, key);
    if (v) input[field] = v;
  }
  return input;
}

/** แหล่งค่าการเชื่อมต่อ: ui = หน้า "การเชื่อมต่อ API" (ค่าเริ่มต้น) / env = .env เป็นหลัก (หน้าเว็บแก้ไม่ได้) */
export type ConnectionSource = "ui" | "env";
export const connectionSource = (env: Env = process.env): ConnectionSource => (val(env, "API_CONN_SOURCE")?.toLowerCase() === "env" ? "env" : "ui");

/** id ของการเชื่อมต่อที่ .env คุม (โหมด env) — หน้าเว็บ/API แก้หรือลบไม่ได้ */
let envManagedId: number | null = null;
export const isEnvManaged = (id: number) => envManagedId === id;

/**
 * การเชื่อมต่อ API User จาก .env (API_CONN_*) — เรียกตอนเปิด server (ตรวจด้วยกฎเดียวกับหน้าเว็บ + audit)
 *   API_CONN_SOURCE=ui  (ค่าเริ่มต้น): ค่าสำรอง — ยังไม่มีการเชื่อมต่อชื่อนี้ → สร้างครั้งเดียว แล้วให้หน้าเว็บจัดการต่อ
 *   API_CONN_SOURCE=env: .env เป็นหลัก — สร้าง/อัปเดตตาม .env ทุกครั้งที่เปิด server และล็อกไม่ให้แก้ในหน้าเว็บ
 *                        (ผู้ใช้ API เดิมยังผูกกับการเชื่อมต่อเดิม เพราะอัปเดตแถวเดิมตามชื่อ)
 * สลับกลับเป็น ui → ปลดล็อก ค่าล่าสุดจาก .env ยังอยู่ให้แก้ต่อในหน้าเว็บ
 */
export async function ensureEnvConnection(env: Env = process.env): Promise<EnvConnectionResult> {
  envManagedId = null;
  const input = envConnectionInput(env);
  if (!input) return { status: "skipped" };
  const mode = connectionSource(env);

  const existing = await first<{ id: number }>("SELECT id FROM api_connections WHERE name = ? ORDER BY id LIMIT 1", [input.name]);
  if (existing && mode === "ui") return { status: "exists", id: existing.id };

  let row: Record<string, unknown>;
  try {
    row = await connectionRowFromInput(input, "en");
  } catch (e) {
    if (e instanceof ValidationError) return { status: "invalid", errors: e.errors };
    throw e;
  }
  const now = nowDb();

  if (existing) {
    const before = apiConnectionResource((await loadConnection(existing.id))!);
    await update("api_connections", { ...row, updated_by: null, updated_at: now }, "id = ?", [existing.id]);
    const after = apiConnectionResource((await loadConnection(existing.id))!);
    const strip = (r: Record<string, unknown>) => JSON.stringify({ ...r, updated_at: null, updated_by: null });
    if (strip(before) !== strip(after)) {
      await audit({}, { action: "api_connection.updated", subjectType: "api_connection", subjectId: existing.id, before, after: { ...after, source: ".env" } });
    }
    // ปิดการเชื่อมต่อจาก .env → ตัด session ของผู้ใช้จากการเชื่อมต่อนี้ (เหมือนปิดในหน้าเว็บ)
    if (before.is_enabled && !after.is_enabled) {
      await exec("DELETE FROM personal_access_tokens WHERE id IN (SELECT token_id FROM external_sessions WHERE connection_id = ?)", [existing.id]);
    }
    envManagedId = existing.id;
    return { status: "updated", id: existing.id };
  }

  const id = await insert("api_connections", { ...row, created_by: null, updated_by: null, created_at: now, updated_at: now });
  await audit({}, { action: "api_connection.created", subjectType: "api_connection", subjectId: id, after: { ...apiConnectionResource((await loadConnection(id))!), source: ".env" } });
  if (mode === "env") envManagedId = id;
  return { status: "created", id };
}
