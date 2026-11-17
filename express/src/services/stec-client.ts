import { UpstreamError, upstreamFetch, type UpstreamErrorKind } from "./upstream-http.js";

/**
 * Client ของ STEC SyteLine API แบบ "บัญชีระบบ" (คู่มือ STEC API Portal บทที่ 10) — ใช้ดึงรายงาน (Fixed Assets)
 * - ค่าเชื่อมต่ออยู่ใน .env ของ API เท่านั้น (อ่านทุกครั้งที่เรียก): STEC_API_BASE_URL (https), STEC_API_USERNAME, STEC_API_PASSWORD,
 *   STEC_API_ALLOWED_HOSTS (host/IP/CIDR ภายในที่อนุญาต คั่นด้วย ,) — ไม่เก็บในฐาน ไม่ส่งถึงหน้าเว็บ
 * - token เก็บในหน่วยความจำต่อ process: login ใหม่ก่อนหมดอายุ 60 วินาที, login พร้อมกันรวมเป็นครั้งเดียว, 401 = login ใหม่แล้วลองซ้ำ 1 ครั้ง
 * - ไม่ log รหัสผ่าน / token / body
 */

export type StecErrorKind = "not_configured" | "auth" | "forbidden" | "bad_request" | "rate_limited" | "unavailable" | "upstream" | "invalid_response" | UpstreamErrorKind;

export class StecError extends Error {
  constructor(
    public readonly kind: StecErrorKind,
    public readonly status?: number,
    /** จาก body { error: { code, requestId } } — แจ้ง STEC พร้อม requestId (คู่มือ Rev 4.6 ข้อ 3.2) */
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    const detail = status ? ` (${status}${code ? ` ${code}` : ""})` : "";
    super(`stec ${kind}${detail}${requestId ? ` requestId=${requestId}` : ""}`);
  }
}

export interface StecEnv {
  baseUrl: string;
  username: string;
  password: string;
  allowedHosts: string[];
}

/** รายงานใช้เวลานาน (Fixed Assets ~15 วินาที/สาขา, API ตั้ง REPORT_TIMEOUT_MS 60 วินาที) */
const REPORT_TIMEOUT_MS = 90_000;
const AUTH_TIMEOUT_MS = 20_000;
/** API จำกัด 20,000 แถว/รายงาน (เกิน = 503 REPORT_LIMIT_EXCEEDED ไม่ตัดผลเงียบๆ) × ~1.5KB — เผื่อไว้ */
const REPORT_MAX_BYTES = 48 * 1024 * 1024;

const env = (key: string) => (process.env[key] ?? "").trim().replace(/^"(.*)"$/, "$1");
/** รหัสผ่าน: คงตัวพิมพ์และช่องว่างตามจริง (คู่มือ Rev 4.6 ข้อ 1.3 — ห้าม trim) */
const rawEnv = (key: string) => (process.env[key] ?? "").replace(/^"(.*)"$/, "$1");

export function stecEnv(): StecEnv {
  return {
    baseUrl: env("STEC_API_BASE_URL").replace(/\/+$/, ""),
    username: env("STEC_API_USERNAME"),
    password: rawEnv("STEC_API_PASSWORD"),
    allowedHosts: env("STEC_API_ALLOWED_HOSTS").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export const stecConfigured = (e: StecEnv = stecEnv()) => Boolean(e.baseUrl && e.username && e.password);

/** ข้อมูลที่แสดงในหน้าตั้งค่าได้ (ไม่มีรหัสผ่าน) */
export function stecPublicInfo() {
  const e = stecEnv();
  let host: string | null = null;
  try {
    host = e.baseUrl ? new URL(e.baseUrl).host : null;
  } catch {
    host = null;
  }
  return { configured: stecConfigured(e), host, username: e.username || null, has_password: Boolean(e.password) };
}

let session: { token: string; expiresAt: number; key: string } | undefined;
let pending: Promise<{ token: string; expiresAt: number; key: string }> | undefined;

/** ล้าง token ที่จำไว้ (เทสต์ / เปลี่ยนค่าใน .env) */
export function resetStecSession(): void {
  session = undefined;
  pending = undefined;
}

const sessionKey = (e: StecEnv) => `${e.baseUrl}|${e.username}`;

async function call(e: StecEnv, method: string, path: string, opts: { token?: string; body?: unknown; timeoutMs: number; maxBytes?: number }) {
  try {
    return await upstreamFetch({
      url: `${e.baseUrl}${path}`,
      method,
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      timeoutMs: opts.timeoutMs,
      maxRedirects: 0,
      allowedHosts: e.allowedHosts,
      maxBytes: opts.maxBytes,
    });
  } catch (err) {
    if (err instanceof UpstreamError) throw new StecError(err.kind);
    throw new StecError("network");
  }
}

function parse<T>(body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new StecError("invalid_response");
  }
}

function statusError(status: number, body = ""): StecError {
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; requestId?: unknown } }).error;
    if (typeof e?.code === "string") code = e.code.slice(0, 50);
    if (typeof e?.requestId === "string") requestId = e.requestId.slice(0, 100);
  } catch {
    // body ไม่ใช่ JSON
  }
  const kind: StecErrorKind =
    status === 401 ? "auth" : status === 403 ? "forbidden" : status === 400 ? "bad_request" : status === 429 ? "rate_limited" : status === 503 ? "unavailable" : "upstream";
  return new StecError(kind, status, code, requestId);
}

async function login(e: StecEnv) {
  const res = await call(e, "POST", "/api/v1/auth/login", { body: { username: e.username, password: e.password }, timeoutMs: AUTH_TIMEOUT_MS });
  if (res.status !== 200) throw statusError(res.status, res.body);
  const data = parse<{ token?: unknown; expiresAt?: unknown }>(res.body);
  if (typeof data.token !== "string" || !data.token) throw new StecError("invalid_response");
  const exp = typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  // ไม่มีอายุ = ตามคู่มือ 24 ชม.
  return { token: data.token, expiresAt: Number.isNaN(exp) ? Date.now() + 24 * 3600_000 : exp, key: sessionKey(e) };
}

async function token(e: StecEnv): Promise<string> {
  if (session && session.key === sessionKey(e) && session.expiresAt > Date.now() + 60_000) return session.token;
  pending ??= login(e).finally(() => {
    pending = undefined;
  });
  session = await pending;
  return session.token;
}

function requireEnv(): StecEnv {
  const e = stecEnv();
  if (!stecConfigured(e)) throw new StecError("not_configured");
  return e;
}

/** GET ที่ต้องใช้ token — 401 ครั้งแรก = login ใหม่แล้วลองซ้ำ */
export async function stecGet<T>(path: string, query: Record<string, string> = {}, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<T> {
  const e = requireEnv();
  const qs = new URLSearchParams(query).toString();
  const full = qs ? `${path}?${qs}` : path;
  for (let attempt = 0; ; attempt++) {
    const current = await token(e);
    const res = await call(e, "GET", full, { token: current, timeoutMs: opts.timeoutMs ?? REPORT_TIMEOUT_MS, maxBytes: opts.maxBytes ?? REPORT_MAX_BYTES });
    if (res.status === 401 && attempt === 0) {
      if (session?.token === current) session = undefined;
      continue;
    }
    if (res.status !== 200) throw statusError(res.status, res.body);
    return parse<T>(res.body);
  }
}

/** รายงาน = { recordsets: Row[][] } → แถวของ recordset แรก */
export async function stecReport(path: string, query: Record<string, string>): Promise<Record<string, unknown>[]> {
  const data = await stecGet<{ recordsets?: unknown }>(path, query);
  const sets = data?.recordsets;
  if (!Array.isArray(sets)) throw new StecError("invalid_response");
  const rows = sets[0] ?? [];
  if (!Array.isArray(rows)) throw new StecError("invalid_response");
  return rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r));
}

/** ปุ่ม "ทดสอบการเชื่อมต่อ": /health → login → /auth/permissions (appIds ของบัญชีระบบ) */
export async function stecTest(): Promise<{ health: boolean; login: boolean; app_ids: number[] | null; error: StecErrorKind | null; status: number | null }> {
  const out = { health: false, login: false, app_ids: null as number[] | null, error: null as StecErrorKind | null, status: null as number | null };
  try {
    const e = requireEnv();
    const h = await call(e, "GET", "/health", { timeoutMs: AUTH_TIMEOUT_MS });
    out.health = h.status === 200;
    resetStecSession();
    await token(e);
    out.login = true;
    const rights = await stecGet<{ appIds?: unknown }>("/api/v1/auth/permissions", {}, { timeoutMs: AUTH_TIMEOUT_MS });
    out.app_ids = Array.isArray(rights.appIds) ? rights.appIds.map(Number).filter((n) => Number.isFinite(n)) : [];
  } catch (err) {
    out.error = err instanceof StecError ? err.kind : "upstream";
    out.status = err instanceof StecError ? (err.status ?? null) : null;
  }
  return out;
}
