import { BlockList, isIP } from "node:net";
import type { Request } from "express";
import { first, select, update } from "../db.js";
import { HttpError, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb, toDbDateTime } from "../lib/time.js";
import { verifyHash } from "../lib/validator.js";
import { me } from "../http.js";
import { isLocal, type UserRow } from "../models/user.js";
import { ApiLoginError, loadConnection, LOGIN_USERNAME, upstreamLogin, upstreamLogout } from "./api-auth.js";
import { notifyUsers } from "./notifications.js";
import { getSetting } from "./settings.js";

/** DATETIME (UTC) จาก DB → Date */
const parseDb = (v: string) => new Date(`${String(v).replace(" ", "T")}Z`);

/**
 * การป้องกันตอนเปิดดูข้อมูลลับ (รหัสผ่านในคลังบัญชี / License key) — เปิด-ปิดแยกกันได้ที่หน้าตั้งค่าระบบ (app_settings.secret_guard)
 *   reauth       ต้องยืนยันตัวตนซ้ำ — ยืนยันแล้วเปิดดูต่อได้ reauth_minutes นาที (ต่อ session)
 *                reauth_method: password = รหัสผ่าน login ของแต่ละคน / pin = PIN กลางอันเดียว (app_settings.secret_pin)
 *                PIN กลางตั้งได้โดยผู้มีสิทธิ์ secrets.pin_manage — กรอกผิดติดกัน 5 ครั้ง = ล็อกคนนั้น 15 นาที
 *   ip_restrict  เปิดดูได้เฉพาะจาก IP / ช่วง IP ที่กำหนด (สำนักงาน / VPN)
 *   notify_heads แจ้งเตือนหัวหน้า IT ทุกครั้งที่มีคนเปิดดู
 * การบันทึกประวัติการเปิดดู (ใคร / เมื่อไร / IP) ทำทุกครั้งเสมอ — ปิดไม่ได้
 * IP มาจาก X-Forwarded-For ที่ frontend ส่งต่อ: เชื่อถือได้เมื่อมี reverse proxy (Caddy/Nginx) เขียนทับ header นี้หน้า Next.js
 */
export type ReauthMethod = "password" | "pin";
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MINUTES = 15;

export interface SecretGuard {
  reauth: boolean;
  reauth_method: ReauthMethod;
  reauth_minutes: number;
  ip_restrict: boolean;
  allowed_ips: string[];
  notify_heads: boolean;
}

export const SECRET_GUARD_DEFAULTS: SecretGuard = { reauth: true, reauth_method: "password", reauth_minutes: 5, ip_restrict: false, allowed_ips: [], notify_heads: true };

export async function secretGuard(): Promise<SecretGuard> {
  const stored = (await getSetting("secret_guard")) as Partial<SecretGuard> | null;
  return { ...SECRET_GUARD_DEFAULTS, ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) };
}

/** IP / CIDR (IPv4 / IPv6) */
export function isValidIpEntry(entry: string): boolean {
  const [ip, prefix, extra] = entry.trim().split("/");
  const family = isIP(ip);
  if (family === 0 || extra !== undefined) return false;
  if (prefix === undefined) return true;
  const n = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && n >= 0 && n <= (family === 4 ? 32 : 128);
}

const unmap = (ip: string) => (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip);

export function ipAllowed(address: string | undefined, entries: string[]): boolean {
  if (!address) return false;
  const ip = unmap(address);
  const family = isIP(ip);
  if (family === 0) return false;
  const list = new BlockList();
  for (const e of entries) {
    if (!isValidIpEntry(e)) continue;
    const [net, prefix] = e.trim().split("/");
    const type = isIP(net) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(net, type);
    else list.addSubnet(net, Number(prefix), type);
  }
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * ตรวจก่อนเปิดดูข้อมูลลับ: IP (ถ้าเปิดใช้) → การยืนยันรหัสผ่านซ้ำ (ถ้าเปิดใช้)
 * 403 = IP ไม่อยู่ในรายการ / 428 = ต้องยืนยันรหัสผ่านก่อน (frontend แสดงช่องยืนยันแล้วลองใหม่)
 */
export async function assertCanReveal(req: Request, opts: { reauth?: boolean } = {}): Promise<void> {
  const g = await secretGuard();
  if (g.ip_restrict && !ipAllowed(req.ip, g.allowed_ips)) {
    throw new HttpError(403, trans(req.locale, "eam.secret_guard.ip_blocked", { ip: req.ip ?? "-" }));
  }
  // reauth: false = รายการนี้ไม่ต้องยืนยัน (คลังบัญชีตั้งรายบัญชีได้)
  if (g.reauth && opts.reauth !== false) {
    const row = req.tokenId ? await first<{ reauth_at: string | null }>("SELECT reauth_at FROM personal_access_tokens WHERE id = ?", [req.tokenId]) : null;
    const fresh = row?.reauth_at && Date.now() - parseDb(row.reauth_at).getTime() <= g.reauth_minutes * 60_000;
    if (!fresh) {
      const u = me(req);
      const pin = g.reauth_method === "pin";
      const set = pin && (await centralPin()) !== null;
      const locked = pin && pinLockedMinutes(u) > 0;
      const key = !pin ? "reauth_required" : !set ? "pin_not_set" : locked ? "pin_locked" : "pin_required";
      // reauth = วิธียืนยัน (frontend แสดงช่องรหัสผ่าน / PIN), pin_set = ตั้ง PIN กลางแล้วหรือยัง, pin_locked = คนนี้ถูกล็อกชั่วคราว
      throw new HttpError(428, trans(req.locale, `eam.secret_guard.${key}`, { minutes: pinLockedMinutes(u) }), {}, { reauth: g.reauth_method, pin_set: set, pin_locked: locked });
    }
  }
}

/** แจ้งเตือนหัวหน้า IT (ยกเว้นคนที่เปิดดูเอง) เมื่อเปิดใช้ notify_heads */
export async function notifyReveal(req: Request, kind: "vault" | "license", subject: { id: string | number; title: string }): Promise<void> {
  if (!(await secretGuard()).notify_heads) return;
  const u = me(req);
  const heads = await select<{ id: number }>("SELECT id FROM users WHERE is_active = true AND is_it_head = true AND id <> ?", [u.id]);
  if (!heads.length) return;
  await notifyUsers(
    heads.map((h) => h.id),
    "App\\Notifications\\SecretRevealed",
    { kind: "secret_revealed", secret: kind, subject_id: subject.id, title: subject.title, actor: u.name, ip: req.ip ?? null },
  );
}

/** PIN: 4–32 ตัว เป็นตัวอักษร/ตัวเลข/สัญลักษณ์ได้ แต่ห้ามมีช่องว่าง */
export const PIN_PATTERN = /^\S{4,32}$/;

/* ---------------------------------------------------------------- PIN กลาง */

export interface CentralPin {
  hash: string;
  set_at: string;
  set_by: { id: number; name: string };
}

/** PIN กลาง (app_settings.secret_pin) — null = ยังไม่ได้ตั้ง; hash ห้ามส่งออกนอก API */
export async function centralPin(): Promise<CentralPin | null> {
  const v = (await getSetting("secret_pin")) as CentralPin | null;
  return v && typeof v === "object" && typeof v.hash === "string" ? v : null;
}

/** สถานะ PIN กลางสำหรับหน้าเว็บ (ไม่มี hash) */
export async function centralPinStatus() {
  const p = await centralPin();
  return { set: p !== null, set_at: p?.set_at ?? null, set_by: p?.set_by.name ?? null };
}

/** นาทีที่ยังถูกล็อก (0 = ไม่ถูกล็อก) */
export function pinLockedMinutes(u: Pick<UserRow, "secret_pin_locked_until">): number {
  if (!u.secret_pin_locked_until) return 0;
  const left = parseDb(u.secret_pin_locked_until).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * ตรวจ PIN กลาง — ผิดติดกันครบ PIN_MAX_FAILURES = ล็อกคนนั้น PIN_LOCK_MINUTES นาที (คนอื่นใช้ได้ตามปกติ)
 * คืน true = ถูก / โยน ValidationError พร้อมข้อความเมื่อผิด / ถูกล็อก / ยังไม่ได้ตั้ง
 */
export async function checkCentralPin(req: Request, u: UserRow, pin: string): Promise<true> {
  const t = (key: string, p: Record<string, number> = {}) => trans(req.locale, `eam.secret_guard.${key}`, p);
  const central = await centralPin();
  if (!central) throw ValidationError.withMessages({ pin: t("pin_not_set") });
  const lockedFor = pinLockedMinutes(u);
  if (lockedFor > 0) throw ValidationError.withMessages({ pin: t("pin_locked", { minutes: lockedFor }) });
  if (verifyHash(pin, central.hash)) {
    if (Number(u.secret_pin_failures ?? 0) > 0 || u.secret_pin_locked_until) await update("users", { secret_pin_failures: 0, secret_pin_locked_until: null }, "id = ?", [u.id]);
    return true;
  }
  const failures = Number(u.secret_pin_failures ?? 0) + 1;
  if (failures >= PIN_MAX_FAILURES) {
    await update("users", { secret_pin_failures: 0, secret_pin_locked_until: toDbDateTime(new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)) }, "id = ?", [u.id]);
    throw ValidationError.withMessages({ pin: t("pin_locked", { minutes: PIN_LOCK_MINUTES }) });
  }
  await update("users", { secret_pin_failures: failures }, "id = ?", [u.id]);
  throw ValidationError.withMessages({ pin: t("wrong_pin", { left: PIN_MAX_FAILURES - failures }) });
}

/**
 * ตรวจรหัสผ่าน login ของผู้ใช้ — บัญชีในระบบ: เทียบ hash / ผู้ใช้จาก API: login ที่ต้นทางซ้ำ (เฉพาะการเชื่อมต่อที่รหัสผู้ใช้ = ชื่อ login) แล้ว logout ทันที
 * ใช้กับการยืนยันตัวตนซ้ำ และการตั้ง PIN กลาง
 */
export async function verifyLoginPassword(req: Request, u: UserRow, pass: string): Promise<boolean> {
  if (isLocal(u)) return verifyHash(pass, u.password);
  const conn = u.connection_id ? await loadConnection(u.connection_id) : null;
  if (!conn || !conn.is_enabled || conn.field_map?.external_id !== LOGIN_USERNAME || !u.external_id) {
    throw ValidationError.withMessages({ password: trans(req.locale, "eam.secret_guard.not_supported") });
  }
  try {
    const login = await upstreamLogin(conn, u.external_id, pass);
    await upstreamLogout(conn, login.token);
    return true;
  } catch (e) {
    if (e instanceof ApiLoginError) return false;
    throw e;
  }
}

/** เวลาปัจจุบันสำหรับบันทึก set_at */
export const pinSetAt = () => nowDb();
