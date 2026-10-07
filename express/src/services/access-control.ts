import type { Request } from "express";
import { select } from "../db.js";
import { trans, type Locale } from "../lib/i18n.js";
import { me } from "../http.js";
import { LOCKED_KEYS, PERMISSIONS } from "../models/permission.js";
import { can, isSuperAdmin, otherLocalSuperAdmins, type UserRow } from "../models/user.js";
import { notifyUsers } from "./notifications.js";
import { adminRecipients, SUPER_ADMIN_GROUP } from "./permissions.js";

/**
 * กติกาการมอบสิทธิ์ (กันการยกระดับสิทธิ์ตัวเอง)
 * - super_admin: มอบ/ถอดได้ทุกอย่าง รวมตั้ง super_admin (ผู้ใช้ LOCAL และ API)
 * - ผู้มีสิทธิ์ access.assign (เช่น ผู้ดูแลระบบ (admin)): มอบ/ถอดได้เฉพาะสิทธิ์ที่ตัวเองมี และไม่ใช่สิทธิ์ที่สงวนไว้ (locked)
 *   แก้ของตัวเองไม่ได้ · แตะบัญชี super_admin ไม่ได้ · ตั้ง super_admin ไม่ได้
 * - ต้องมี super_admin บัญชี LOCAL ที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ (ทางสำรองเมื่อระบบต้นทางล่ม)
 */

const nameOf = (key: string, locale: Locale) => {
  const p = PERMISSIONS.find((x) => x.key === key);
  return p ? (locale === "th" ? p.name_th : p.name_en) : key;
};

/** สิทธิ์ของกลุ่ม (super_admin = ทุกสิทธิ์) */
export async function groupKeys(group: string): Promise<string[]> {
  if (group === SUPER_ADMIN_GROUP) return PERMISSIONS.map((p) => p.key);
  const rows = await select<{ key: string }>("SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = ?", [group]);
  return rows.map((r) => r.key);
}

/** มอบ/ถอดสิทธิ์ชุดนี้ได้ไหม — คืนข้อความผิดพลาด (null = ได้) */
export function grantError(actor: UserRow, keys: Iterable<string>, locale: Locale): string | null {
  if (isSuperAdmin(actor)) return null;
  const list = [...new Set(keys)];
  const locked = list.filter((k) => LOCKED_KEYS.has(k));
  if (locked.length) return trans(locale, "eam.access.locked", { items: locked.map((k) => nameOf(k, locale)).join(", ") });
  const missing = list.filter((k) => !can(actor, k));
  if (missing.length) return trans(locale, "eam.access.not_held", { items: missing.map((k) => nameOf(k, locale)).join(", ") });
  return null;
}

/** ผู้ทำแก้ผู้ใช้นี้ได้ไหม (ตำแหน่ง/กลุ่ม/สิทธิ์) — คืนข้อความผิดพลาด (null = ได้) */
export function targetError(actor: UserRow, target: Pick<UserRow, "id" | "role">, locale: Locale): string | null {
  if (actor.id === target.id) return trans(locale, "eam.access.self_change");
  if (target.role === SUPER_ADMIN_GROUP && !isSuperAdmin(actor)) return trans(locale, "eam.access.target_super_admin");
  return null;
}

/**
 * เปลี่ยนตำแหน่ง (users.role) ได้ไหม — target null = ผู้ใช้ใหม่
 * ต้องมีสิทธิ์ access.assign (ผู้ใช้ใหม่ตำแหน่งพนักงานไม่ต้อง) และมอบ/ถอดได้ทั้งสิทธิ์ของตำแหน่งใหม่และตำแหน่งเดิม
 */
export async function roleChangeError(
  actor: UserRow,
  target: Pick<UserRow, "id" | "role" | "type" | "password" | "is_active"> | null,
  role: string,
  locale: Locale,
): Promise<string | null> {
  if (target && target.role === role) return null;
  if (!target && role === "viewer") return null;
  if (!can(actor, "access.assign")) return trans(locale, "eam.access.role_needs_assign");
  if (target) {
    const t = targetError(actor, target, locale);
    if (t) return t;
  }
  if (role === SUPER_ADMIN_GROUP && !isSuperAdmin(actor)) return trans(locale, "eam.access.super_admin_only");
  // ลดตำแหน่ง super_admin บัญชี LOCAL คนสุดท้ายไม่ได้
  if (target && (await lastLocalSuperAdmin(target))) return trans(locale, "eam.access.last_super_admin");
  return grantError(actor, [...(await groupKeys(role)), ...(target ? await groupKeys(target.role) : [])], locale);
}

/** ผู้ใช้นี้เป็น super_admin บัญชี LOCAL ที่ใช้งานอยู่คนสุดท้ายหรือไม่ */
export async function lastLocalSuperAdmin(u: Pick<UserRow, "id" | "role" | "type" | "password" | "is_active">): Promise<boolean> {
  if (u.role !== SUPER_ADMIN_GROUP || u.type !== "LOCAL" || u.password === null || !u.is_active) return false;
  return (await otherLocalSuperAdmins(u.id)) === 0;
}

export type AccessChange = "user" | "group_permissions" | "group_created" | "group_updated" | "group_deleted" | "pin" | "expiry";

/** แจ้งเตือนผู้ดูแลระบบสูงสุด + ผู้ดูแลระบบทุกคน (ยกเว้นผู้ทำ) เมื่อมีการเปลี่ยนสิทธิ์ / PIN กลาง */
export async function notifyAccessChange(req: Request, change: AccessChange, subject: { id: string | number | null; name: string }, detail: Record<string, unknown> = {}): Promise<void> {
  const u = me(req);
  const ids = await adminRecipients(u.id);
  if (!ids.length) return;
  await notifyUsers(ids, "App\\Notifications\\AccessChanged", { kind: "access_changed", change, subject_id: subject.id, subject: subject.name, actor: u.name, ...detail });
}
