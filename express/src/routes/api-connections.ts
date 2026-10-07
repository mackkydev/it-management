import { Router, type Request } from "express";
import { exec, insert, scalar, select, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import { isValidPath } from "../lib/json-path.js";
import { encryptString } from "../lib/laravel-crypt.js";
import { limits } from "../lib/rate-limit.js";
import { nowDb } from "../lib/time.js";
import { bool, custom, regex, validate, type ErrorBag } from "../lib/validator.js";
import { me } from "../http.js";
import { apiConnectionResource, AUTH_TYPES, ERROR_KINDS, HTTP_METHODS, LOGIN_BODY_TYPES, type ApiConnectionRow } from "../models/api-connection.js";
import { isLocalAdmin } from "../models/user.js";
import { API_ROLES, ApiLoginError, callUpstream, LOGIN_USERNAME, loadConnection, upstreamLogin, upstreamLogout } from "../services/api-auth.js";
import { audit } from "../services/audit.js";
import { syncConnection } from "../services/directory-sync.js";
import { isEnvManaged } from "../services/env-connection.js";
import { isValidAllowEntry, UpstreamError } from "../services/upstream-http.js";

/**
 * การเชื่อมต่อ REST API ต้นทางสำหรับ API User — เฉพาะ Local Admin
 *   GET    /api-connections                รายการ (+ จำนวนผู้ใช้)
 *   GET    /api-connections/{id}
 *   POST   /api-connections                สร้าง
 *   PUT|PATCH /api-connections/{id}        แก้ไข (auth_secret: ส่งมา = เปลี่ยน, ไม่ส่ง = คงเดิม, clear_auth_secret = ลบ)
 *   DELETE /api-connections/{id}           ลบได้เมื่อยังไม่มีผู้ใช้จากการเชื่อมต่อนี้
 *   POST   /api-connections/{id}/test      { username, password } ลอง login จริงแล้วแสดงผลการ map (ไม่สร้างผู้ใช้/ไม่คืน token)
 *   POST   /api-connections/{id}/sync      ซิงค์รายชื่อผู้ใช้จากต้นทางตอนนี้ (สร้างล่วงหน้า / ปิดคนที่ถูกปิดหรือหายจากต้นทาง)
 * auth_secret เข้ารหัสด้วย APP_KEY และไม่ถูกส่งกลับ frontend; ทุกการแก้ไขบันทึก audit_logs (ก่อน-หลัง ไม่มี secret)
 */
export const apiConnectionRoutes = Router();

const MAX_ITEMS = 50;
/** path ของ endpoint ใต้ base_url — ขึ้นต้นด้วย / ห้าม // และ .. */
const ENDPOINT_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;
const FIELD_NAME = /^[A-Za-z0-9_.\-[\]]+$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

const isHttpsUrl = (v: unknown) => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname !== "";
  } catch {
    return false;
  }
};
const isEndpointPath = (v: unknown) => typeof v === "string" && ENDPOINT_PATH.test(v) && !v.split(/[/?]/).includes("..");
const isJsonPath = (v: unknown) => typeof v === "string" && isValidPath(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function guard(req: Request) {
  const u = me(req);
  authorize(isLocalAdmin(u));
  return u;
}

async function find(id: string): Promise<ApiConnectionRow> {
  if (!/^\d+$/.test(id)) throw notFound();
  const row = await loadConnection(Number(id));
  if (!row) throw notFound();
  return row;
}

const usersCount = async (id: number) => Number(await scalar("SELECT COUNT(*) FROM users WHERE connection_id = ?", [id]));
const resource = async (c: ApiConnectionRow) => ({ ...apiConnectionResource(c), users_count: await usersCount(c.id), managed_by_env: isEnvManaged(c.id) });

/** โหมด API_CONN_SOURCE=env: การเชื่อมต่อนี้ตั้งจาก .env — แก้/ลบผ่านหน้าเว็บไม่ได้ */
function assertNotEnvManaged(req: Request, c: ApiConnectionRow) {
  if (isEnvManaged(c.id)) throw ValidationError.withMessages({ connection: trans(req.locale, "eam.api_connection.managed_by_env") });
}

/** ตรวจ field ที่เป็น JSON (field_map / role_rules / error_messages / allowed_hosts) + secret ที่จำเป็น */
function checkJsonFields(req: Request, data: Record<string, unknown>, errors: ErrorBag, current: ApiConnectionRow | null) {
  const t = (key: string) => trans(req.locale, `eam.api_connection.${key}`);

  if ("field_map" in data) {
    const fm = data.field_map;
    if (!isPlainObject(fm)) errors.add("field_map", t("invalid_json_path"));
    else
      for (const key of ["external_id", "name", "email", "role_code", "status"]) {
        const v = fm[key];
        // "$login" = ใช้ชื่อผู้ใช้ที่กรอกตอน login (ต้นทางไม่มีข้อมูลโปรไฟล์ เช่น STEC SyteLine API) — ใช้ได้กับรหัส/ชื่อ
        if (v === LOGIN_USERNAME && (key === "external_id" || key === "name")) continue;
        if (v !== undefined && v !== null && v !== "" && !isJsonPath(v)) errors.add(`field_map.${key}`, t("invalid_json_path"));
      }
  }
  if ("role_rules" in data) {
    const rules = data.role_rules;
    if (!Array.isArray(rules) || rules.length > MAX_ITEMS) errors.add("role_rules", t("invalid_rule"));
    else
      rules.forEach((r, i) => {
        if (!isPlainObject(r) || typeof r.value !== "string" || r.value.trim() === "" || r.value.length > 100) errors.add(`role_rules.${i}.value`, t("invalid_rule"));
        if (!isPlainObject(r) || !API_ROLES.includes(r.role as never)) errors.add(`role_rules.${i}.role`, t("invalid_role"));
      });
  }
  if ("error_messages" in data) {
    const map = data.error_messages;
    if (!isPlainObject(map) || Object.keys(map).length > MAX_ITEMS) errors.add("error_messages", t("invalid_error_map"));
    else
      for (const [code, v] of Object.entries(map)) {
        const okEntry =
          code.length > 0 && code.length <= 100 && isPlainObject(v) && (ERROR_KINDS as readonly string[]).includes(v.kind as string) &&
          ["message_th", "message_en"].every((k) => v[k] === undefined || v[k] === null || (typeof v[k] === "string" && (v[k] as string).length <= 255));
        if (!okEntry) errors.add(`error_messages.${code}`, t("invalid_error_map"));
      }
  }
  if ("active_values" in data) {
    const values = data.active_values;
    if (!Array.isArray(values) || values.length > MAX_ITEMS || values.some((v) => typeof v !== "string" || v.trim() === "" || v.length > 100)) {
      errors.add("active_values", t("invalid_rule"));
    }
  }
  if ("allowed_hosts" in data) {
    const hosts = data.allowed_hosts;
    if (!Array.isArray(hosts) || hosts.length > MAX_ITEMS) errors.add("allowed_hosts", t("invalid_host"));
    else hosts.forEach((h, i) => (typeof h !== "string" || !isValidAllowEntry(h.trim())) && errors.add(`allowed_hosts.${i}`, t("invalid_host")));
  }

  const authType = (data.auth_type as string | undefined) ?? current?.auth_type ?? "none";
  const newSecret = typeof data.auth_secret === "string" && data.auth_secret !== "";
  const keepsSecret = Boolean(current?.auth_secret) && !bool(data.clear_auth_secret);
  if (authType !== "none" && !newSecret && !keepsSecret) errors.add("auth_secret", t("secret_required"));
}

async function validated(req: Request, current: ApiConnectionRow | null) {
  const msg = (key: string) => trans(req.locale, `eam.api_connection.${key}`);
  const https = custom(isHttpsUrl, msg("https_required"));
  const path = custom(isEndpointPath, msg("invalid_path"));
  const jsonPath = custom(isJsonPath, msg("invalid_json_path"));
  const req_ = current ? "sometimes" : "required";

  return validate(
    req.input,
    {
      name: [req_, "string", "max:100"],
      is_enabled: ["sometimes", "boolean"],
      base_url: [req_, "string", "max:500", https],
      timeout_ms: ["sometimes", "integer", "min:1000", "max:60000"],
      login_method: ["sometimes", `in:${HTTP_METHODS.join(",")}`],
      login_path: [req_, "string", "max:255", path],
      login_username_field: ["sometimes", "string", "max:100", regex(FIELD_NAME)],
      login_password_field: ["sometimes", "string", "max:100", regex(FIELD_NAME)],
      login_body_type: ["sometimes", `in:${LOGIN_BODY_TYPES.join(",")}`],
      profile_method: ["sometimes", "in:GET,POST"],
      profile_path: ["sometimes", "nullable", "string", "max:255", path],
      profile_root_path: ["sometimes", "nullable", "string", "max:255", jsonPath],
      logout_path: ["sometimes", "nullable", "string", "max:255", path],
      refresh_path: ["sometimes", "nullable", "string", "max:255", path],
      health_path: ["sometimes", "nullable", "string", "max:255", path],
      token_path: ["sometimes", "string", "max:255", jsonPath],
      token_ttl_path: ["sometimes", "nullable", "string", "max:255", jsonPath],
      refresh_token_path: ["sometimes", "nullable", "string", "max:255", jsonPath],
      default_token_ttl_seconds: ["sometimes", "integer", "min:60", "max:2592000"],
      profile_cache_seconds: ["sometimes", "integer", "min:60", "max:86400"],
      default_role: ["sometimes", `in:${API_ROLES.join(",")}`],
      error_code_path: ["sometimes", "nullable", "string", "max:255", jsonPath],
      auth_type: ["sometimes", `in:${AUTH_TYPES.join(",")}`],
      auth_header_name: ["sometimes", "nullable", "string", "max:100", regex(HEADER_NAME)],
      auth_username: ["sometimes", "nullable", "string", "max:255"],
      auth_secret: ["sometimes", "nullable", "string", "max:2000"],
      clear_auth_secret: ["sometimes", "boolean"],
      max_redirects: ["sometimes", "integer", "min:0", "max:5"],
      register_url: ["sometimes", "nullable", "string", "max:500", https],
      forgot_password_url: ["sometimes", "nullable", "string", "max:500", https],
      change_password_url: ["sometimes", "nullable", "string", "max:500", https],
      users_list_path: ["sometimes", "nullable", "string", "max:255", path],
      users_list_root_path: ["sometimes", "nullable", "string", "max:255", jsonPath],
      users_page_param: ["sometimes", "nullable", "string", "max:50", regex(FIELD_NAME)],
      users_page_size_param: ["sometimes", "nullable", "string", "max:50", regex(FIELD_NAME)],
      users_page_size: ["sometimes", "integer", "min:1", "max:1000"],
      sync_interval_minutes: ["sometimes", "integer", "min:0", "max:10080"],
    },
    { locale: req.locale, after: ({ errors }) => checkJsonFields(req, req.input, errors, current) },
  );
}

const SCALARS = [
  "name", "base_url", "timeout_ms", "login_method", "login_path", "login_username_field", "login_password_field", "login_body_type",
  "profile_method", "profile_path", "profile_root_path", "logout_path", "refresh_path", "health_path", "token_path", "token_ttl_path", "refresh_token_path",
  "default_token_ttl_seconds", "profile_cache_seconds", "default_role", "error_code_path", "auth_type", "auth_header_name", "auth_username",
  "max_redirects", "register_url", "forgot_password_url", "change_password_url",
  "users_list_path", "users_list_root_path", "users_page_param", "users_page_size_param", "users_page_size", "sync_interval_minutes",
] as const;
const JSON_FIELDS = ["field_map", "role_rules", "error_messages", "allowed_hosts", "active_values"] as const;

/** ค่าที่จะบันทึก — secret: ส่งค่าใหม่ = เข้ารหัสแล้วเก็บ / clear_auth_secret = ลบ / auth_type none = ลบ */
function toRow(req: Request, data: Record<string, unknown>) {
  const input = req.input;
  const row: Record<string, unknown> = {};
  for (const k of SCALARS) if (k in data) row[k] = data[k] === "" ? null : data[k];
  if ("login_method" in row) row.login_method = String(row.login_method).toUpperCase();
  if ("is_enabled" in data) row.is_enabled = bool(data.is_enabled);
  for (const k of JSON_FIELDS) {
    if (!(k in input)) continue;
    const v = input[k];
    row[k] = JSON.stringify(
      k === "allowed_hosts" || k === "active_values" ? (v as string[]).map((h) => h.trim()) : k === "role_rules" ? (v as Array<{ value: string; role: string }>).map((r) => ({ value: r.value.trim(), role: r.role })) : v,
    );
  }
  let secretChanged = false;
  if (typeof input.auth_secret === "string" && input.auth_secret !== "") {
    row.auth_secret = encryptString(input.auth_secret);
    secretChanged = true;
  } else if (bool(input.clear_auth_secret) || data.auth_type === "none") {
    row.auth_secret = null;
    secretChanged = true;
  }
  return { row, secretChanged };
}

/** ตรวจ + แปลงค่าเป็นแถวที่จะบันทึก ด้วยกฎเดียวกับหน้าเว็บ — ใช้ตอนสร้างการเชื่อมต่อจาก .env (services/env-connection.ts) */
export async function connectionRowFromInput(input: Record<string, unknown>, locale: Locale): Promise<Record<string, unknown>> {
  const req = { input, locale } as unknown as Request;
  return toRow(req, await validated(req, null)).row;
}

apiConnectionRoutes.get("/api-connections", async (req, res) => {
  guard(req);
  const rows = await select<ApiConnectionRow>("SELECT * FROM api_connections ORDER BY name, id");
  res.json({ data: await Promise.all(rows.map(resource)) });
});

apiConnectionRoutes.get("/api-connections/:id", async (req, res) => {
  guard(req);
  res.json({ data: await resource(await find(req.params.id as string)) });
});

apiConnectionRoutes.post("/api-connections", async (req, res) => {
  const u = guard(req);
  const data = await validated(req, null);
  const { row } = toRow(req, data);
  const now = nowDb();
  const id = await insert("api_connections", { ...row, created_by: u.id, updated_by: u.id, created_at: now, updated_at: now });
  const created = (await loadConnection(id))!;
  await audit(req, { action: "api_connection.created", subjectType: "api_connection", subjectId: id, after: apiConnectionResource(created) });
  res.status(201).json({ data: await resource(created) });
});

const save = async (req: Request, res: import("express").Response) => {
  const u = guard(req);
  const current = await find(req.params.id as string);
  assertNotEnvManaged(req, current);
  const data = await validated(req, current);
  const { row, secretChanged } = toRow(req, data);
  await update("api_connections", { ...row, updated_by: u.id, updated_at: nowDb() }, "id = ?", [current.id]);
  const saved = (await loadConnection(current.id))!;
  await audit(req, {
    action: "api_connection.updated",
    subjectType: "api_connection",
    subjectId: current.id,
    before: apiConnectionResource(current),
    after: { ...apiConnectionResource(saved), ...(secretChanged ? { auth_secret_changed: true } : {}) },
  });
  // ปิดการเชื่อมต่อ → ตัด session ของผู้ใช้จากการเชื่อมต่อนี้ทันที
  if (current.is_enabled && !saved.is_enabled) {
    await exec("DELETE FROM personal_access_tokens WHERE id IN (SELECT token_id FROM external_sessions WHERE connection_id = ?)", [saved.id]);
  }
  res.json({ data: await resource(saved) });
};
apiConnectionRoutes.put("/api-connections/:id", save);
apiConnectionRoutes.patch("/api-connections/:id", save);

apiConnectionRoutes.delete("/api-connections/:id", async (req, res) => {
  guard(req);
  const current = await find(req.params.id as string);
  assertNotEnvManaged(req, current);
  if ((await usersCount(current.id)) > 0) {
    throw ValidationError.withMessages({ connection: trans(req.locale, "eam.api_connection.in_use") });
  }
  await exec("DELETE FROM api_connections WHERE id = ?", [current.id]);
  await audit(req, { action: "api_connection.deleted", subjectType: "api_connection", subjectId: current.id, before: apiConnectionResource(current) });
  res.status(204).end();
});

/** ทดสอบการเชื่อมต่อด้วยบัญชีจริง — คืนผลการ map เท่านั้น (ไม่คืน token, ไม่สร้างผู้ใช้/session) แล้ว logout ที่ต้นทาง */
apiConnectionRoutes.post("/api-connections/:id/test", limits.apiLogin, async (req, res) => {
  guard(req);
  const conn = await find(req.params.id as string);
  const data = await validate(req.input, { username: ["required", "string", "max:255"], password: ["required", "string", "max:255"] }, { locale: req.locale });
  try {
    const result = await upstreamLogin(conn, String(data.username), String(data.password));
    await upstreamLogout(conn, result.token);
    res.json({
      data: {
        ok: true,
        profile: result.profile,
        token_expires_in: Math.round((result.expiresAt.getTime() - Date.now()) / 1000),
        has_refresh_token: result.refreshToken !== null,
      },
    });
  } catch (e) {
    if (!(e instanceof ApiLoginError)) throw e;
    const custom = req.locale === "th" ? e.custom?.message_th : e.custom?.message_en;
    res.json({ data: { ok: false, kind: e.kind, message: custom?.trim() || trans(req.locale, `eam.api_auth.${e.kind === "invalid" ? "failed" : e.kind}`) } });
  }
});


/**
 * ตรวจว่าเข้าถึงต้นทางได้ (GET health_path เช่น /health ของ STEC) — ไม่ใช้บัญชีผู้ใช้
 * คืนเฉพาะสถานะ HTTP + เวลาที่ใช้ (ไม่ส่งเนื้อหาจากต้นทางกลับไปหน้าเว็บ)
 */
apiConnectionRoutes.post("/api-connections/:id/health", async (req, res) => {
  guard(req);
  const conn = await find(req.params.id as string);
  if (!conn.health_path) throw ValidationError.withMessages({ health_path: trans(req.locale, "eam.api_connection.health_not_configured") });
  const started = Date.now();
  try {
    const r = await callUpstream(conn, { method: "GET", path: conn.health_path });
    res.json({ data: { ok: r.status >= 200 && r.status < 300, status: r.status, ms: Date.now() - started } });
  } catch (e) {
    const kind = e instanceof UpstreamError ? e.kind : "network";
    res.json({ data: { ok: false, status: 0, ms: Date.now() - started, error: trans(req.locale, `eam.api_connection.health_${kind === "blocked" || kind === "insecure" ? "blocked" : "unreachable"}`) } });
  }
});

/** ซิงค์รายชื่อผู้ใช้จากต้นทางตอนนี้ — คืนสรุปผล (สร้าง / อัปเดต / ปิด / เปิดคืน / หายจากต้นทาง) */
apiConnectionRoutes.post("/api-connections/:id/sync", async (req, res) => {
  guard(req);
  const conn = await find(req.params.id as string);
  if (!conn.users_list_path) {
    throw ValidationError.withMessages({ users_list_path: trans(req.locale, "eam.api_connection.sync_not_configured") });
  }
  res.json({ data: await syncConnection(conn, req) });
});
