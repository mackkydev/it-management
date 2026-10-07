import { config } from "../config.js";
import { exec, first, insert, update } from "../db.js";
import { readPath, readString } from "../lib/json-path.js";
import { decryptString, encryptNullable, encryptString } from "../lib/laravel-crypt.js";
import { nowDb, toDbDateTime } from "../lib/time.js";
import { createToken, deleteToken } from "../lib/tokens.js";
import { ERROR_KINDS, type ApiConnectionRow, type ErrorKind, type ErrorMessage } from "../models/api-connection.js";
import type { Role, UserRow } from "../models/user.js";
import { audit } from "./audit.js";
import { upstreamFetch, UpstreamError } from "./upstream-http.js";

/**
 * Login ผ่าน REST API ต้นทาง (API User) + JIT provisioning + session
 * - ระบบเราไม่เก็บรหัสผ่านของ API User (ส่งต่อไปต้นทางแล้วทิ้ง) และไม่ log token/รหัสผ่าน
 * - token ต้นทางเก็บเข้ารหัสใน external_sessions ผูกกับ token ของเรา — browser ได้แค่ token ของเรา (httpOnly cookie)
 * - อายุ session = ค่าที่น้อยกว่าระหว่างอายุ token ต้นทาง กับ EAM_TOKEN_TTL_MINUTES + idle timeout (API_SESSION_IDLE_MINUTES)
 */

/** ตำแหน่งผู้ดูแลระบบ — กำหนดในโปรแกรม IT เท่านั้น (การซิงก์ตำแหน่งจากต้นทางไม่ตั้ง/ไม่ทับ) */
export const ADMIN_ROLES: Role[] = ["super_admin", "admin"];
/** role ที่ API User ได้จากการ map (ไม่มีทางได้ admin) */
export const API_ROLES: Role[] = ["manager", "viewer"];

/* ---------------------------------------------------------------- เรียก API ต้นทาง (wrapper กลาง) */

export interface UpstreamResult {
  status: number;
  json: unknown;
}

const parseDb = (v: string) => new Date(`${v.replace(" ", "T")}Z`);

export async function loadConnection(id: number): Promise<ApiConnectionRow | null> {
  return first<ApiConnectionRow>("SELECT * FROM api_connections WHERE id = ?", [id]);
}

export async function callUpstream(
  conn: ApiConnectionRow,
  opts: { method: string; path: string; json?: unknown; form?: Record<string, string>; userToken?: string },
): Promise<UpstreamResult> {
  const base = conn.base_url.replace(/\/+$/, "");
  // path ต้องเป็น path ใต้ base_url เท่านั้น (ห้ามใส่ URL เต็มเพื่อไปที่ host อื่น)
  if (!opts.path.startsWith("/") || opts.path.startsWith("//")) throw new UpstreamError("insecure");
  const url = new URL(`${base}${opts.path}`);
  if (url.origin !== new URL(base).origin) throw new UpstreamError("insecure");

  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "IT-SYSTEM" };
  let body: string | undefined;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const secret = conn.auth_secret ? decryptString(conn.auth_secret) : null;
  if (conn.auth_type === "api_key" && secret) headers[conn.auth_header_name || "X-API-Key"] = secret;
  if (opts.userToken) headers.Authorization = `Bearer ${opts.userToken}`;
  else if (conn.auth_type === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
  else if (conn.auth_type === "basic" && secret) headers.Authorization = `Basic ${Buffer.from(`${conn.auth_username ?? ""}:${secret}`).toString("base64")}`;

  const res = await upstreamFetch({
    url: url.toString(),
    method: opts.method.toUpperCase(),
    headers,
    body,
    timeoutMs: conn.timeout_ms,
    maxRedirects: conn.max_redirects,
    allowedHosts: Array.isArray(conn.allowed_hosts) ? conn.allowed_hosts : [],
  });
  let json: unknown = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const ok = (status: number) => status >= 200 && status < 300;

/* ---------------------------------------------------------------- login ที่ต้นทาง */

/** เหตุที่ login ไม่สำเร็จ — invalid = ข้อความกลางเสมอ (ไม่บอกว่ามี username หรือไม่) */
export type LoginFailureKind = ErrorKind | "unavailable" | "misconfigured" | "connection_disabled";

export class ApiLoginError extends Error {
  constructor(
    public readonly kind: LoginFailureKind,
    public readonly custom?: ErrorMessage,
  ) {
    super(`api login ${kind}`);
  }
}

export interface MappedProfile {
  external_id: string;
  name: string;
  /** ชื่อมาจากชื่อผู้ใช้ที่ login (ต้นทางไม่มีชื่อจริง) — ไม่เขียนทับชื่อที่ admin แก้ไว้ */
  name_from_login: boolean;
  email: string | null;
  role_code: string | null;
  role: Role;
}

/**
 * ค่าพิเศษใน field_map: ใช้ "ชื่อผู้ใช้ที่กรอกตอน login" แทน path ใน response
 * สำหรับต้นทางที่ login แล้วได้แค่ token ไม่มีข้อมูลโปรไฟล์ (เช่น STEC SyteLine API)
 */
export const LOGIN_USERNAME = "$login";

export interface UpstreamLogin {
  token: string;
  refreshToken: string | null;
  /** เวลาหมดอายุของ token ต้นทาง */
  expiresAt: Date;
  profile: MappedProfile;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * role จากรหัสของต้นทาง — กฎแรก (ตามลำดับที่ตั้ง) ที่ตรงกับรหัสใดรหัสหนึ่ง
 * รหัสเป็นรายการได้ (เช่น appIds = [1, 5] ของ STEC) → ส่งมาเป็น "1,5"
 */
export function mapRole(conn: ApiConnectionRow, code: string | null): Role {
  const rules = Array.isArray(conn.role_rules) ? conn.role_rules : [];
  const codes = code === null ? [] : code.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const hit = rules.find((r) => codes.includes(String(r.value).trim().toLowerCase()));
  const role = hit?.role ?? conn.default_role;
  return API_ROLES.includes(role) ? role : "viewer";
}

/** รหัส role จาก path — ค่าเดียว หรือรายการ (array ของข้อความ/ตัวเลข) → รวมเป็น "a,b" */
function readRoleCode(data: unknown, path: string): string | null {
  const v = readPath(data, path);
  if (Array.isArray(v)) {
    const list = v.filter((x) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x))).map((x) => String(x).trim()).filter(Boolean);
    return list.length ? list.join(",").slice(0, 255) : null;
  }
  return readString(data, path);
}

/** loginUsername = ชื่อผู้ใช้ที่กรอกตอน login (ใช้กับค่า "$login" ใน field_map) */
export function mapProfile(conn: ApiConnectionRow, data: unknown, loginUsername: string | null = null): MappedProfile | null {
  const fm = conn.field_map ?? {};
  const pick = (path: string | undefined, fallback: string) => (path === LOGIN_USERNAME ? loginUsername?.trim() || null : readString(data, path || fallback));
  const externalId = pick(fm.external_id, "id");
  if (!externalId || externalId.length > 191) return null;
  const email = pick(fm.email, "email")?.toLowerCase() ?? null;
  const roleCode = fm.role_code ? readRoleCode(data, fm.role_code) : null;
  return {
    external_id: externalId,
    name: (pick(fm.name, "name") ?? externalId).slice(0, 255),
    name_from_login: fm.name === LOGIN_USERNAME || !readString(data, fm.name || "name"),
    email: email && email.length <= 255 && EMAIL.test(email) ? email : null,
    role_code: roleCode,
    role: mapRole(conn, roleCode),
  };
}

/** อายุ token: จาก token_ttl_path (วินาที หรือวันเวลาหมดอายุ) — ไม่มี/อ่านไม่ได้ = default_token_ttl_seconds */
export function tokenExpiry(conn: ApiConnectionRow, json: unknown, now = Date.now()): Date {
  const raw = conn.token_ttl_path ? readPath(json, conn.token_ttl_path) : undefined;
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return new Date(now + Math.min(seconds, 30 * 86400) * 1000);
  if (typeof raw === "string") {
    const at = Date.parse(raw);
    if (Number.isFinite(at) && at > now) return new Date(Math.min(at, now + 30 * 86400 * 1000));
  }
  return new Date(now + conn.default_token_ttl_seconds * 1000);
}

function mapError(conn: ApiConnectionRow, res: UpstreamResult): ApiLoginError {
  const code = conn.error_code_path ? readString(res.json, conn.error_code_path) : null;
  const messages = conn.error_messages ?? {};
  const entry = (code !== null ? messages[code] : undefined) ?? messages[String(res.status)];
  if (entry && (ERROR_KINDS as readonly string[]).includes(entry.kind)) return new ApiLoginError(entry.kind, entry);
  if (res.status >= 500 || res.status === 0) return new ApiLoginError("unavailable");
  return new ApiLoginError("invalid");
}

async function fetchProfileData(conn: ApiConnectionRow, token: string): Promise<UpstreamResult> {
  return callUpstream(conn, { method: conn.profile_method, path: conn.profile_path!, userToken: token });
}

/** เรียก login (+ โปรไฟล์) ที่ต้นทาง แล้ว map ข้อมูล — ยังไม่สร้างผู้ใช้/session (ใช้กับปุ่ม "ทดสอบการเชื่อมต่อ" ด้วย) */
export async function upstreamLogin(conn: ApiConnectionRow, username: string, password: string): Promise<UpstreamLogin> {
  const fields = { [conn.login_username_field]: username, [conn.login_password_field]: password };
  let res: UpstreamResult;
  try {
    res = await callUpstream(conn, { method: conn.login_method, path: conn.login_path, ...(conn.login_body_type === "form" ? { form: fields } : { json: fields }) });
  } catch (e) {
    throw new ApiLoginError(e instanceof UpstreamError && e.kind !== "timeout" && e.kind !== "network" ? "misconfigured" : "unavailable");
  }
  if (!ok(res.status)) throw mapError(conn, res);

  const token = readString(res.json, conn.token_path);
  if (!token) throw new ApiLoginError("misconfigured");
  const expiresAt = tokenExpiry(conn, res.json);
  const refreshToken = conn.refresh_token_path ? readString(res.json, conn.refresh_token_path) : null;

  let profileSource: unknown = res.json;
  if (conn.profile_path) {
    let p: UpstreamResult;
    try {
      p = await fetchProfileData(conn, token);
    } catch {
      throw new ApiLoginError("unavailable");
    }
    if (!ok(p.status)) throw new ApiLoginError(p.status >= 500 ? "unavailable" : "misconfigured");
    profileSource = p.json;
  }
  const profile = mapProfile(conn, readPath(profileSource, conn.profile_root_path), username);
  if (!profile) throw new ApiLoginError("misconfigured");
  return { token, refreshToken, expiresAt, profile };
}

/** แจ้งต้นทางให้เพิกถอน token (ถ้ามี endpoint) — ผิดพลาดก็ไม่เป็นไร */
export async function upstreamLogout(conn: ApiConnectionRow, token: string): Promise<void> {
  if (!conn.logout_path) return;
  try {
    await callUpstream(conn, { method: "POST", path: conn.logout_path, userToken: token });
  } catch {
    // ต้นทางล่ม/ช้า — session ฝั่งเราถูกลบอยู่แล้ว
  }
}

/* ---------------------------------------------------------------- JIT provisioning */

type Actor = { ip?: string; user?: { id: number } };

async function emailOwner(email: string, exceptId: number | null): Promise<number | null> {
  const row = await first<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER(?)${exceptId ? " AND id <> ?" : ""} LIMIT 1`,
    exceptId ? [email, exceptId] : [email],
  );
  return row?.id ?? null;
}

/**
 * ครั้งแรก: สร้างผู้ใช้ type=API ด้วย role จาก role mapping (ไม่ตรงกฎ = default_role)
 * ครั้งถัดไป: อัปเดตชื่อ/อีเมล และตำแหน่ง (role) ตามรหัสจากต้นทาง (เช่น appIds) เมื่อตั้ง field_map.role_code ไว้
 *   — ตำแหน่งผู้ดูแลระบบ / ผู้ดูแลระบบรอง (ADMIN_ROLES) ตั้งในโปรแกรม IT เท่านั้น ไม่ถูกซิงก์ทับ
 *   — ห้ามแตะกลุ่มสิทธิ์ / สิทธิ์รายคน / จนท.IT / หัวหน้า IT / สถานะ / ลายเซ็น ที่ admin ตั้งไว้ (สิทธิ์กำหนดในโปรแกรม IT)
 * อีเมลซ้ำกับผู้ใช้อื่น → ไม่ใช้อีเมลนั้น (เว้นว่าง/คงค่าเดิม) และบันทึก audit api_user.email_conflict ให้ admin ผูกบัญชีเอง
 * ต้นทางไม่ส่งอีเมล → คงค่าเดิมในระบบเรา
 */
export async function provisionUser(conn: ApiConnectionRow, profile: MappedProfile, actor: Actor): Promise<UserRow> {
  const now = nowDb();
  const find = () => first<UserRow>("SELECT * FROM users WHERE connection_id = ? AND external_id = ?", [conn.id, profile.external_id]);
  let user = await find();
  const conflictWith = profile.email ? await emailOwner(profile.email, user?.id ?? null) : null;

  if (!user) {
    try {
      const id = await insert("users", {
        name: profile.name,
        email: conflictWith ? null : profile.email,
        role: profile.role,
        type: "API",
        connection_id: conn.id,
        external_id: profile.external_id,
        is_active: true,
        external_synced_at: now,
        created_at: now,
        updated_at: now,
      });
      await audit(actor, {
        action: "api_user.provisioned",
        subjectType: "user",
        subjectId: id,
        after: { connection_id: conn.id, external_id: profile.external_id, role: profile.role, role_code: profile.role_code },
      });
    } catch (e) {
      // login ครั้งแรกพร้อมกันสองที่ — อีกฝั่งสร้างไปแล้ว
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
    }
    user = (await find())!;
  } else {
    const changes: Record<string, unknown> = { external_synced_at: now };
    // ชื่อจากต้นทางจริงเท่านั้น — ชื่อที่ได้จากชื่อผู้ใช้ login ไม่เขียนทับชื่อที่ admin แก้ไว้
    if (!profile.name_from_login && user.name !== profile.name) changes.name = profile.name;
    if (profile.email && !conflictWith && user.email !== profile.email) changes.email = profile.email;
    // บทบาทตามต้นทางทุกครั้งที่ login/ตรวจซ้ำ — ไม่ได้ map รหัส role ไว้ = admin กำหนดเอง
    const roleBefore = user.role;
    if (conn.field_map?.role_code && user.role !== profile.role && !ADMIN_ROLES.includes(user.role)) changes.role = profile.role;
    if (Object.keys(changes).length > 1) changes.updated_at = now;
    await update("users", changes, "id = ?", [user.id]);
    user = (await find())!;
    if (changes.role) {
      await audit(actor, {
        action: "api_user.role_synced",
        subjectType: "user",
        subjectId: user.id,
        before: { role: roleBefore },
        after: { role: user.role, role_code: profile.role_code },
      });
    }
  }

  if (conflictWith && profile.email && user.email !== profile.email) {
    const already = await first(
      "SELECT 1 FROM audit_logs WHERE action = 'api_user.email_conflict' AND subject_type = 'user' AND subject_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(\"after\", '$.email')) = ? LIMIT 1",
      [String(user.id), profile.email],
    );
    if (!already) {
      await audit(actor, { action: "api_user.email_conflict", subjectType: "user", subjectId: user.id, after: { email: profile.email, conflicts_with_user_id: conflictWith } });
    }
  }
  return user;
}

/* ---------------------------------------------------------------- session */

export interface IssuedSession {
  plainText: string;
  expiresAt: Date;
  user: UserRow;
}

/** login สำเร็จที่ต้นทาง → สร้าง/อัปเดตผู้ใช้ → ออก token ของเรา + เก็บ token ต้นทาง (เข้ารหัส) */
export async function loginWithApi(conn: ApiConnectionRow, username: string, password: string, deviceName: string, actor: Actor): Promise<IssuedSession> {
  if (!conn.is_enabled) throw new ApiLoginError("connection_disabled");
  const result = await upstreamLogin(conn, username, password);
  const user = await provisionUser(conn, result.profile, actor);
  if (!user.is_active) {
    await upstreamLogout(conn, result.token);
    throw new ApiLoginError("disabled");
  }

  const ours = new Date(Date.now() + config.tokenTtlMinutes * 60_000);
  const expiresAt = result.expiresAt < ours ? result.expiresAt : ours;
  const token = await createToken(user.id, deviceName, expiresAt);
  const now = nowDb();
  await insert("external_sessions", {
    token_id: token.id,
    user_id: user.id,
    connection_id: conn.id,
    access_token: encryptString(result.token),
    refresh_token: encryptNullable(result.refreshToken),
    expires_at: toDbDateTime(result.expiresAt),
    profile_checked_at: now,
    created_at: now,
    updated_at: now,
  });
  return { plainText: token.plainText, expiresAt, user };
}

interface SessionRow {
  id: number;
  token_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  profile_checked_at: string | null;
}

/** ตัด session: ลบ token ของเรา (external_sessions ถูกลบตาม) */
async function kill(tokenId: number): Promise<null> {
  await deleteToken(tokenId);
  return null;
}

/** ลอง refresh token ต้นทาง (ถ้ามี endpoint + refresh token) — อายุ session ฝั่งเราไม่ยืดออก */
async function refresh(conn: ApiConnectionRow, s: SessionRow): Promise<string | null> {
  if (!conn.refresh_path || !s.refresh_token) return null;
  try {
    const res = await callUpstream(conn, { method: "POST", path: conn.refresh_path, json: { refresh_token: decryptString(s.refresh_token) } });
    const token = ok(res.status) ? readString(res.json, conn.token_path) : null;
    if (!token) return null;
    const newRefresh = conn.refresh_token_path ? readString(res.json, conn.refresh_token_path) : null;
    await update(
      "external_sessions",
      { access_token: encryptString(token), ...(newRefresh ? { refresh_token: encryptString(newRefresh) } : {}), expires_at: toDbDateTime(tokenExpiry(conn, res.json)), updated_at: nowDb() },
      "id = ?",
      [s.id],
    );
    return token;
  } catch {
    return null;
  }
}

/**
 * ตรวจ session ของ API User ทุก request (เรียกจาก middleware auth — ผู้ใช้ LOCAL ไม่ผ่านที่นี่)
 * - ผู้ใช้ถูกปิดใช้งาน / การเชื่อมต่อถูกปิด / token ต้นทางหมดอายุ / ไม่ได้ใช้งานเกิน idle timeout → ตัด session
 * - ตรวจกับต้นทางซ้ำทุก profile_cache_seconds (ถ้ามี profile endpoint): 401/403 → ตัด session, สำเร็จ → ซิงก์ชื่อ/อีเมล
 *   ต้นทางล่ม → ให้ใช้งานต่อ แล้วลองใหม่ในอีก 1 นาที
 * คืนผู้ใช้ล่าสุด (หลังซิงก์โปรไฟล์) หรือ null = ต้อง login ใหม่
 */
export async function checkApiSession(tokenId: number, user: UserRow, lastUsedAt: string | null): Promise<UserRow | null> {
  if (!user.is_active || user.connection_id === null) return kill(tokenId);
  const s = await first<SessionRow>("SELECT * FROM external_sessions WHERE token_id = ?", [tokenId]);
  const conn = await loadConnection(user.connection_id);
  if (!s || !conn || !conn.is_enabled) return kill(tokenId);

  const now = Date.now();
  if (parseDb(s.expires_at).getTime() <= now) {
    if (!(await refresh(conn, s))) return kill(tokenId);
  }
  if (lastUsedAt && now - parseDb(lastUsedAt).getTime() > config.apiSessionIdleMinutes * 60_000) return kill(tokenId);

  const checkedAt = s.profile_checked_at ? parseDb(s.profile_checked_at).getTime() : 0;
  if (!conn.profile_path || now - checkedAt < conn.profile_cache_seconds * 1000) return user;

  let token = decryptString(s.access_token);
  try {
    let res = await fetchProfileData(conn, token);
    if (res.status === 401) {
      const renewed = await refresh(conn, s);
      if (!renewed) return kill(tokenId);
      token = renewed;
      res = await fetchProfileData(conn, token);
    }
    if (res.status === 401 || res.status === 403) return kill(tokenId);
    if (ok(res.status)) {
      // external_id มาจากชื่อผู้ใช้ตอน login ("$login") = external_id ที่เก็บไว้
      const profile = mapProfile(conn, readPath(res.json, conn.profile_root_path), user.external_id);
      const synced = profile && profile.external_id === user.external_id ? await provisionUser(conn, profile, { user: { id: user.id } }) : user;
      await exec("UPDATE external_sessions SET profile_checked_at = ?, updated_at = ? WHERE id = ?", [nowDb(), nowDb(), s.id]);
      return synced;
    }
  } catch {
    // ต้นทางล่ม — ใช้งานต่อได้
  }
  const retryAt = new Date(now - conn.profile_cache_seconds * 1000 + 60_000);
  await exec("UPDATE external_sessions SET profile_checked_at = ? WHERE id = ?", [toDbDateTime(retryAt), s.id]);
  return user;
}

/** logout ของ API User: เรียก logout ที่ต้นทาง (ถ้ามี) ก่อนลบ session ฝั่งเรา */
export async function revokeApiSession(tokenId: number, user: UserRow): Promise<void> {
  if (user.connection_id === null) return;
  const s = await first<SessionRow>("SELECT * FROM external_sessions WHERE token_id = ?", [tokenId]);
  const conn = await loadConnection(user.connection_id);
  if (s && conn) await upstreamLogout(conn, decryptString(s.access_token));
}
