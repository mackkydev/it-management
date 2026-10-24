import type { Request } from "express";
import { update } from "../db.js";
import { ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb, toDbDateTime } from "../lib/time.js";
import { isLocal, type UserRow } from "../models/user.js";
import { audit } from "./audit.js";
import { notifyUsers } from "./notifications.js";
import { adminRecipients } from "./permissions.js";
import { getSetting } from "./settings.js";

/**
 * นโยบายรหัสผ่าน (app_settings.password_policy — แก้ที่หน้าตั้งค่าระบบ ด้วยสิทธิ์ access.manage) เฉพาะผู้ใช้ LOCAL
 * - ล็อกบัญชี: login ผิด (รหัสผ่าน / รหัส 2FA) ติดกันครบ lockout_attempts = ล็อก lockout_minutes นาที (0 = ไม่ล็อก)
 *   นับที่ users.login_failures — ล้างเมื่อ login สำเร็จจนได้ token (ไม่ล้างตอนรหัสผ่านถูกแต่ยังไม่ผ่าน 2FA กันเดารหัส 2FA)
 *   ล็อกแล้ว → audit auth.locked + แจ้งเตือนในระบบไปยังผู้ดูแลระบบ (ปลดล็อกได้ที่หน้าแก้ไขผู้ใช้)
 * - บังคับเปลี่ยนรหัสผ่านทุก expiry_days วัน (0 = ไม่บังคับ): นับจาก users.password_changed_at
 *   (ยังไม่เคยเปลี่ยนตั้งแต่มีคอลัมน์ = นับจากวันที่เปิดนโยบาย `since`) — หมดอายุแล้ว API ตอบ 403 password_expired
 *   ทุก endpoint ยกเว้น PASSWORD_EXPIRED_ALLOWED จนกว่าจะเปลี่ยนรหัสผ่าน; แจ้งล่วงหน้า expiry_warn_days วัน (แถบในหน้าเว็บ)
 */
export interface PasswordPolicy {
  lockout_attempts: number;
  lockout_minutes: number;
  expiry_days: number;
  expiry_warn_days: number;
  /** เปิดบังคับเปลี่ยนรหัสผ่านเมื่อไร (UTC "YYYY-MM-DD HH:mm:ss") — จุดเริ่มนับของผู้ที่ยังไม่มี password_changed_at */
  since: string | null;
  /** บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก / หลังผู้ดูแลรีเซ็ตรหัสผ่าน (users.must_change_password) */
  force_first_change: boolean;
}

export const PASSWORD_POLICY_DEFAULTS: PasswordPolicy = { lockout_attempts: 10, lockout_minutes: 15, expiry_days: 0, expiry_warn_days: 7, since: null, force_first_change: false };

/** endpoint ที่ใช้ได้ระหว่างรหัสผ่านหมดอายุ (path ใต้ /api/v1) */
export const PASSWORD_EXPIRED_ALLOWED: { method: string; path: string }[] = [
  { method: "GET", path: "/auth/me" },
  { method: "PUT", path: "/auth/password" },
  { method: "POST", path: "/auth/logout" },
];

const parseDb = (v: string) => new Date(`${String(v).replace(" ", "T")}Z`);
const num = (v: unknown, fallback: number) => (Number.isInteger(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);

export async function passwordPolicy(): Promise<PasswordPolicy> {
  const raw = ((await getSetting("password_policy")) ?? {}) as Partial<Record<keyof PasswordPolicy, unknown>>;
  const d = PASSWORD_POLICY_DEFAULTS;
  return {
    lockout_attempts: num(raw.lockout_attempts, d.lockout_attempts),
    lockout_minutes: num(raw.lockout_minutes, d.lockout_minutes),
    expiry_days: num(raw.expiry_days, d.expiry_days),
    expiry_warn_days: num(raw.expiry_warn_days, d.expiry_warn_days),
    since: typeof raw.since === "string" ? raw.since : null,
    force_first_change: raw.force_first_change === true,
  };
}

/* ---------------------------------------------------------------- ล็อกบัญชี */

/** นาทีที่ยังถูกล็อก (0 = ไม่ถูกล็อก) */
export function loginLockedMinutes(u: Pick<UserRow, "login_locked_until">): number {
  if (!u.login_locked_until) return 0;
  const left = parseDb(u.login_locked_until).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/** ถูกล็อกอยู่ → 422 ที่ช่อง field พร้อมเวลาที่เหลือ */
export function assertNotLocked(req: Request, u: UserRow, field = "email"): void {
  const minutes = loginLockedMinutes(u);
  if (minutes > 0) throw ValidationError.withMessages({ [field]: trans(req.locale, "eam.auth.locked", { minutes }) });
}

/**
 * นับการ login ผิดของผู้ใช้ LOCAL — ครบตามนโยบาย = ล็อก + audit + แจ้งผู้ดูแลระบบ
 * คืนนาทีที่ถูกล็อก (0 = ยังไม่ล็อก) เพื่อให้ผู้เรียกเลือกข้อความ
 */
export async function recordLoginFailure(req: Request, u: UserRow): Promise<number> {
  if (!isLocal(u)) return 0;
  const policy = await passwordPolicy();
  const failures = Number(u.login_failures ?? 0) + 1;
  if (policy.lockout_attempts <= 0 || failures < policy.lockout_attempts) {
    await update("users", { login_failures: failures }, "id = ?", [u.id]);
    return 0;
  }
  const until = toDbDateTime(new Date(Date.now() + policy.lockout_minutes * 60_000));
  await update("users", { login_failures: 0, login_locked_until: until }, "id = ?", [u.id]);
  await audit({ ip: req.ip }, { action: "auth.locked", subjectType: "user", subjectId: u.id, after: { attempts: failures, minutes: policy.lockout_minutes, until: iso(until) } });
  const ids = await adminRecipients(u.id);
  if (ids.length) {
    await notifyUsers(ids, "App\\Notifications\\AccountLocked", {
      kind: "account_locked", subject_id: u.id, subject: u.name, attempts: failures, minutes: policy.lockout_minutes, ip: req.ip ?? null,
    });
  }
  return policy.lockout_minutes;
}

/** login สำเร็จ (ได้ token) → ล้างตัวนับ */
export async function clearLoginFailures(u: UserRow): Promise<void> {
  if (Number(u.login_failures ?? 0) > 0 || u.login_locked_until) await update("users", { login_failures: 0, login_locked_until: null }, "id = ?", [u.id]);
}

/* ---------------------------------------------------------------- วันหมดอายุรหัสผ่าน */

/** วันเวลาที่รหัสผ่านหมดอายุ (null = ไม่บังคับ / ไม่ใช่ผู้ใช้ LOCAL) */
export function passwordExpiresAt(u: UserRow, policy: PasswordPolicy): Date | null {
  if (!isLocal(u) || policy.expiry_days <= 0) return null;
  const base = u.password_changed_at ?? policy.since;
  if (!base) return null;
  return new Date(parseDb(base).getTime() + policy.expiry_days * 86_400_000);
}

/** ต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน (ผู้ใช้ใหม่ / ผู้ดูแลรีเซ็ตรหัสผ่าน) — มีผลเฉพาะเมื่อเปิด force_first_change */
export const mustChangePassword = (u: UserRow, policy: PasswordPolicy) => isLocal(u) && policy.force_first_change && Boolean(u.must_change_password);

/**
 * password_warn = ใกล้หมดอายุ (ภายใน expiry_warn_days วัน) — หน้าเว็บแสดงแถบเตือนให้เปลี่ยนก่อน
 * password_change_required = ต้องตั้งรหัสผ่านใหม่ (ครั้งแรก) — นับเป็น password_expired ด้วย (middleware ตอบ 403 เหมือนรหัสผ่านหมดอายุ)
 */
export function passwordStatus(
  u: UserRow,
  policy: PasswordPolicy,
): { password_expires_at: string | null; password_expired: boolean; password_warn: boolean; password_change_required: boolean } {
  const at = passwordExpiresAt(u, policy);
  const left = at ? at.getTime() - Date.now() : null;
  const first = mustChangePassword(u, policy);
  return {
    password_change_required: first,
    password_expires_at: at ? iso(toDbDateTime(at)) : null,
    password_expired: first || (left !== null && left <= 0),
    password_warn: left !== null && left > 0 && left <= policy.expiry_warn_days * 86_400_000,
  };
}

/** ตั้งรหัสผ่านใหม่แล้ว — เริ่มนับวันหมดอายุใหม่ (ผู้ใช้เปลี่ยนเอง = ไม่ต้องเปลี่ยนครั้งแรกแล้ว) */
export const passwordChangedNow = () => ({ password_changed_at: nowDb(), must_change_password: false });

/** ผู้ดูแลตั้งรหัสผ่านให้ผู้อื่น (สร้างผู้ใช้ / รีเซ็ต) — เปิด force_first_change = ผู้ใช้ต้องเปลี่ยนเองตอนเข้าสู่ระบบ */
export async function passwordSetByAdmin(): Promise<{ password_changed_at: string; must_change_password: boolean }> {
  return { password_changed_at: nowDb(), must_change_password: (await passwordPolicy()).force_first_change };
}
