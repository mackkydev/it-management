import type { Request } from "express";
import { select } from "../db.js";
import { trans, type Locale } from "../lib/i18n.js";
import { me } from "../http.js";
import { LOCKED_KEYS, PERMISSIONS, SELF_SCOPED_KEYS } from "../models/permission.js";
import { can, isSuperAdmin, otherLocalSuperAdmins, ROLES, roleRank, type UserRow } from "../models/user.js";
import { audit } from "./audit.js";
import { notifyUsers } from "./notifications.js";
import { adminRecipients, groupsOf, listGroups, SUPER_ADMIN_GROUP } from "./permissions.js";

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

/**
 * แก้กลุ่มนี้ได้ไหม (ตารางสิทธิ์ / ชื่อ / ลบ) — คืนข้อความผิดพลาด (null = ได้)
 * access.manage (super_admin) = ทุกกลุ่ม · access.groups (admin) = กลุ่มตามตำแหน่งที่ต่ำกว่าตำแหน่งตัวเอง + กลุ่มที่สร้างเอง
 * กลุ่มที่ตัวเองอยู่ (ตำแหน่ง / มอบเพิ่ม) แก้ไม่ได้ — สิทธิ์ที่เปลี่ยนยังต้องผ่าน grantError (เฉพาะที่ตัวเองมี ไม่ใช่สิทธิ์ที่สงวนไว้)
 */
export async function groupEditError(actor: UserRow, group: { key: string; is_system: boolean }, locale: Locale): Promise<string | null> {
  if (can(actor, "access.manage")) return null;
  if (!can(actor, "access.groups")) return trans(locale, "eam.access.group_forbidden");
  const isRole = (ROLES as readonly string[]).includes(group.key);
  if (group.is_system && (!isRole || roleRank(group.key) >= roleRank(actor.role))) return trans(locale, "eam.access.group_higher");
  if ((await groupsOf(actor)).includes(group.key)) return trans(locale, "eam.access.group_own");
  return null;
}

/**
 * กลุ่มที่ผู้ทำตั้งค่ารายกลุ่มได้ (ตารางสิทธิ์ / การซ่อนเมนู-ปุ่ม / ขอบเขตปฏิทิน-การลา-การจอง) — null = ทุกกลุ่ม (access.manage)
 * ไม่มีทั้ง access.manage / access.groups = ชุดว่าง
 */
export async function editableGroupKeys(actor: UserRow, locale: Locale): Promise<Set<string> | null> {
  if (can(actor, "access.manage")) return null;
  const out = new Set<string>();
  for (const g of await listGroups()) if (g.key !== SUPER_ADMIN_GROUP && (await groupEditError(actor, g, locale)) === null) out.add(g.key);
  return out;
}

/** ค่าตั้งค่ารายกลุ่มที่ส่งมา { group: value } — กลุ่มที่แก้ไม่ได้คงค่าเดิม (ไม่สนค่าที่ส่งมา) */
export function keepLockedGroups<T>(editable: Set<string> | null, before: Record<string, T>, next: Record<string, T>): Record<string, T> {
  if (!editable) return next;
  const out: Record<string, T> = Object.fromEntries(Object.entries(next).filter(([k]) => editable.has(k)));
  for (const [k, v] of Object.entries(before)) if (!editable.has(k)) out[k] = v;
  return out;
}

/** การซ่อนเมนู/ปุ่ม { "<key>": [กลุ่มที่ซ่อน] } — กลุ่มที่แก้ไม่ได้คงตามเดิม */
export function keepLockedHidden(editable: Set<string> | null, before: Record<string, string[]>, next: Record<string, string[]>): Record<string, string[]> {
  if (!editable) return next;
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    const hidden = [...(next[key] ?? []).filter((g) => editable.has(g)), ...(before[key] ?? []).filter((g) => !editable.has(g))];
    if (hidden.length) out[key] = [...new Set(hidden)];
  }
  return out;
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
  // สิทธิ์ที่มีผลกับงานของผู้ได้รับเองเท่านั้น (SELF_SCOPED_KEYS เช่น อนุมัติใบของตัวเอง) ไม่ต้องถือไว้เองตอนตั้งตำแหน่ง
  // สิทธิ์ที่สงวนไว้ซึ่งผู้ทำถืออยู่ (เช่น access.groups ของกลุ่ม admin) ส่งต่อไปกับตำแหน่งได้ — ชุดสิทธิ์ของตำแหน่ง super_admin เป็นผู้กำหนด (มอบรายข้อยังต้องเป็น super_admin)
  const keys = [...(await groupKeys(role)), ...(target ? await groupKeys(target.role) : [])].filter(
    (k) => !SELF_SCOPED_KEYS.has(k) && !(LOCKED_KEYS.has(k) && can(actor, k)),
  );
  return grantError(actor, keys, locale);
}

/** ผู้ใช้นี้เป็น super_admin บัญชี LOCAL ที่ใช้งานอยู่คนสุดท้ายหรือไม่ */
export async function lastLocalSuperAdmin(u: Pick<UserRow, "id" | "role" | "type" | "password" | "is_active">): Promise<boolean> {
  if (u.role !== SUPER_ADMIN_GROUP || u.type !== "LOCAL" || u.password === null || !u.is_active) return false;
  return (await otherLocalSuperAdmins(u.id)) === 0;
}

export type LoginMethod = "password" | "two_factor" | "recovery_code" | "api";

/**
 * super_admin เข้าสู่ระบบ (ได้ token แล้ว) → audit auth.super_admin_login + แจ้งเตือนในระบบถึง super_admin คนอื่นทุกคนที่ใช้งานอยู่
 * — บัญชีสูงสุดถูกใช้โดยไม่รู้ตัว / ใช้ recovery code จะเห็นได้ทันที (ไม่มี super_admin คนอื่น = บันทึก audit อย่างเดียว)
 */
export async function notifySuperAdminLogin(req: Request, user: UserRow, method: LoginMethod): Promise<void> {
  if (user.role !== SUPER_ADMIN_GROUP) return;
  const ip = req.ip ?? null;
  await audit({ user, ip: req.ip }, { action: "auth.super_admin_login", subjectType: "user", subjectId: user.id, after: { method, ip } });
  const ids = (await select<{ id: number }>("SELECT id FROM users WHERE role = ? AND is_active = true AND id <> ?", [SUPER_ADMIN_GROUP, user.id])).map((r) => Number(r.id));
  if (ids.length) await notifyUsers(ids, "App\\Notifications\\SuperAdminLogin", { kind: "super_admin_login", subject_id: user.id, subject: user.name, method, ip });
}

export type AccessChange = "user" | "group_permissions" | "group_created" | "group_updated" | "group_deleted" | "pin" | "expiry";

/** แจ้งเตือนผู้ดูแลระบบสูงสุด + ผู้ดูแลระบบทุกคน (ยกเว้นผู้ทำ) เมื่อมีการเปลี่ยนสิทธิ์ / PIN กลาง */
export async function notifyAccessChange(req: Request, change: AccessChange, subject: { id: string | number | null; name: string }, detail: Record<string, unknown> = {}): Promise<void> {
  const u = me(req);
  const ids = await adminRecipients(u.id);
  if (!ids.length) return;
  await notifyUsers(ids, "App\\Notifications\\AccessChanged", { kind: "access_changed", change, subject_id: subject.id, subject: subject.name, actor: u.name, ...detail });
}
