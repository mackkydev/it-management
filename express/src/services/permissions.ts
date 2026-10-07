import { exec, first, insert, scalar, select } from "../db.js";
import { localToday, nowDb } from "../lib/time.js";
import { PERMISSION_KEYS, PERMISSIONS } from "../models/permission.js";
import { isSuperAdmin, ROLES, type UserRow } from "../models/user.js";
import { getSetting, putSetting } from "./settings.js";

/**
 * กลุ่มสิทธิ์ + สิทธิ์จริงของผู้ใช้
 * - กลุ่มตามตำแหน่ง (system, ลบไม่ได้) = ค่าเดียวกับ users.role; กลุ่มที่สร้างเอง (เช่น กลุ่มฝ่าย IT เดิม) มอบเพิ่มรายคนได้หลายกลุ่ม (user_groups)
 * - สิทธิ์จริง = สิทธิ์ของทุกกลุ่ม + allow รายคน − deny รายคน (รายการที่เลยวันหมดอายุไม่มีผล เมื่อเปิด permission_expiry)
 * - super_admin ผ่านทุกสิทธิ์ (ไม่ใช้ตาราง role_permissions)
 */

export const SUPER_ADMIN_GROUP = "super_admin";

/** กลุ่มตามตำแหน่ง — สร้างให้เสมอถ้ายังไม่มี (ชื่อแก้ได้ ลบไม่ได้) */
const SYSTEM_GROUPS: { key: string; name_th: string; name_en: string }[] = [
  { key: "super_admin", name_th: "ผู้ดูแลระบบ", name_en: "Super admin" },
  { key: "admin", name_th: "ผู้ดูแลระบบรอง", name_en: "Admin" },
  { key: "division_manager", name_th: "ผู้จัดการฝ่าย", name_en: "Division manager" },
  { key: "manager", name_th: "ผู้จัดการ", name_en: "Manager" },
  { key: "viewer", name_th: "พนักงาน", name_en: "Staff" },
];
/** กลุ่มฝ่าย IT เดิม — สร้างครั้งเดียวตอนฐานยังไม่มีกลุ่มใดเลย (ติดตั้งใหม่ / เทสต์) เหมือน migration 20261012090000 — ลบแล้วไม่สร้างคืน */
const LEGACY_GROUPS: { key: string; name_th: string; name_en: string }[] = [
  { key: "it_staff", name_th: "เจ้าหน้าที่ IT (เดิม)", name_en: "IT staff (legacy)" },
  { key: "it_head", name_th: "หัวหน้า IT (เดิม)", name_en: "IT head (legacy)" },
];

async function ensureGroups(): Promise<void> {
  const now = nowDb();
  const empty = Number(await scalar("SELECT COUNT(*) FROM permission_groups")) === 0;
  for (const [i, g] of SYSTEM_GROUPS.entries()) {
    await exec("INSERT IGNORE INTO permission_groups (\"key\", name_th, name_en, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, true, ?, ?, ?)", [g.key, g.name_th, g.name_en, i, now, now]);
  }
  if (!empty) return;
  for (const [i, g] of LEGACY_GROUPS.entries()) {
    await exec("INSERT IGNORE INTO permission_groups (\"key\", name_th, name_en, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, false, ?, ?, ?)", [g.key, g.name_th, g.name_en, 10 + i, now, now]);
  }
}

/**
 * สร้างกลุ่มตามตำแหน่ง + key สิทธิ์ที่ยังไม่มีในตาราง แล้วกำหนดสิทธิ์ตั้งต้น (เฉพาะ key ที่เพิ่งสร้าง)
 * - key ที่แยกจาก key เดิม (from) = คัดลอกการกำหนดสิทธิ์ของ key เดิมทั้งกลุ่มและรายคน — ไม่มีใครเสียสิทธิ์
 * - key ที่มีอยู่แล้ว: ไม่แตะชื่อ/ลำดับ/การกำหนดสิทธิ์ที่ปรับไว้ — รันซ้ำได้ทุกครั้งที่ start
 */
export async function ensurePermissions(): Promise<void> {
  await ensureGroups();
  const now = nowDb();
  const existing = new Map((await select<{ id: number; key: string }>('SELECT id, "key" FROM permissions')).map((r) => [r.key, Number(r.id)]));
  const groups = new Set((await select<{ key: string }>('SELECT "key" FROM permission_groups')).map((r) => r.key));
  for (const [i, p] of PERMISSIONS.entries()) {
    if (existing.has(p.key)) continue;
    const created = await insert("permissions", { key: p.key, group: p.group, name_th: p.name_th, name_en: p.name_en, sort_order: i, created_at: now, updated_at: now });
    existing.set(p.key, created);
    const source = p.from ? existing.get(p.from) : undefined;
    if (source !== undefined) {
      await exec("INSERT IGNORE INTO role_permissions (role, permission_id, created_at) SELECT role, ?, ? FROM role_permissions WHERE permission_id = ?", [created, now, source]);
      await exec(
        `INSERT IGNORE INTO user_permissions (user_id, permission_id, effect, created_by, created_at, expires_on)
         SELECT user_id, ?, effect, created_by, created_at, expires_on FROM user_permissions WHERE permission_id = ?`,
        [created, source],
      );
      continue;
    }
    for (const group of p.defaults) {
      if (groups.has(group)) await exec("INSERT IGNORE INTO role_permissions (role, permission_id, created_at) VALUES (?, ?, ?)", [group, created, now]);
    }
  }
  await migrateUiAudiences();
}

/**
 * การซ่อนเมนู/ปุ่มเดิม (app_settings.ui_permissions) ที่ซ่อนจาก "admin" — ผู้ดูแลระบบเดิมตอนนี้เป็น super_admin จึงซ่อนจาก super_admin ด้วย
 * ทำครั้งเดียว (จำไว้ที่ app_settings.ui_permissions_v2)
 */
async function migrateUiAudiences(): Promise<void> {
  if (await first("SELECT 1 FROM app_settings WHERE \"key\" = 'ui_permissions_v2'")) return;
  const ui = await getSetting("ui_permissions");
  if (ui && typeof ui === "object" && !Array.isArray(ui)) {
    const next = Object.fromEntries(
      Object.entries(ui as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) && v.includes("admin") && !v.includes(SUPER_ADMIN_GROUP) ? [...v, SUPER_ADMIN_GROUP] : v]),
    );
    await putSetting("ui_permissions", next, null);
  }
  await putSetting("ui_permissions_v2", true, null);
}

/* ---------------------------------------------------------------- วันหมดอายุของสิทธิ์ */

/** สวิตช์วันหมดอายุของสิทธิ์ (app_settings.permission_expiry) — ปิด = ไม่สนใจวันหมดอายุทั้งหมด */
export async function expiryEnabled(): Promise<boolean> {
  const v = (await first<{ value: unknown }>("SELECT \"value\" FROM app_settings WHERE \"key\" = 'permission_expiry'"))?.value;
  return Boolean(v && typeof v === "object" && (v as { enabled?: unknown }).enabled === true);
}

/** เงื่อนไข SQL "ยังไม่หมดอายุ" ของคอลัมน์ expires_on (alias.expires_on) */
async function activeClause(alias: string): Promise<{ sql: string; params: unknown[] }> {
  if (!(await expiryEnabled())) return { sql: "1 = 1", params: [] };
  return { sql: `(${alias}.expires_on IS NULL OR ${alias}.expires_on >= ?)`, params: [localToday()] };
}

/* ---------------------------------------------------------------- กลุ่มของผู้ใช้ / สิทธิ์จริง */

/** กลุ่มของผู้ใช้: กลุ่มตามตำแหน่ง + กลุ่มที่มอบเพิ่ม (ที่ยังไม่หมดอายุ) */
export async function groupsOf(u: Pick<UserRow, "id" | "role">): Promise<string[]> {
  const active = await activeClause("ug");
  const extra = await select<{ group_key: string }>(`SELECT ug.group_key FROM user_groups ug WHERE ug.user_id = ? AND ${active.sql}`, [u.id, ...active.params]);
  return [...new Set([u.role, ...extra.map((r) => r.group_key)])];
}

/** สิทธิ์จริง = สิทธิ์ของทุกกลุ่ม + allow รายคน − deny รายคน (super_admin = ทุกสิทธิ์) */
export async function permissionsOf(u: UserRow): Promise<Set<string>> {
  if (isSuperAdmin(u)) return new Set(PERMISSION_KEYS);
  const groups = await groupsOf(u);
  const active = await activeClause("up");
  const rows = await select<{ key: string }>(
    `SELECT p.key FROM permissions p
     WHERE (EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id AND rp.role IN (?))
            OR EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = ? AND up.effect = 'allow' AND ${active.sql}))
       AND NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = ? AND up.effect = 'deny' AND ${active.sql})`,
    [groups, u.id, ...active.params, u.id, ...active.params],
  );
  return new Set(rows.map((r) => r.key).filter((k) => PERMISSION_KEYS.includes(k)));
}

export interface GroupRow {
  key: string;
  name_th: string;
  name_en: string;
  is_system: boolean;
  sort_order: number;
}

/** กลุ่มทั้งหมด เรียงตามลำดับ (กลุ่มตามตำแหน่งตามลำดับตำแหน่ง แล้วกลุ่มที่สร้างเอง) */
export async function listGroups(): Promise<(GroupRow & { members: number })[]> {
  const rows = await select<GroupRow & { members: number }>(
    `SELECT g."key", g.name_th, g.name_en, g.is_system, g.sort_order,
            (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_key = g."key") + (SELECT COUNT(*) FROM users u WHERE u.role = g."key") AS members
       FROM permission_groups g ORDER BY g.is_system DESC, g.sort_order, g.name_th`,
  );
  const rank = (k: string) => {
    const i = (ROLES as readonly string[]).indexOf(k);
    return i < 0 ? 99 : i;
  };
  return rows
    .map((r) => ({ ...r, is_system: Boolean(r.is_system), members: Number(r.members) }))
    .sort((a, b) => (a.is_system && b.is_system ? rank(a.key) - rank(b.key) : 0));
}

/** สิทธิ์ของแต่ละกลุ่ม (ใช้แสดงผล/จำลองในหน้าตั้งค่า) — super_admin = ทุกสิทธิ์ */
export async function audiencePermissions(): Promise<Record<string, string[]>> {
  const groups = await select<{ key: string }>('SELECT "key" FROM permission_groups');
  const out: Record<string, string[]> = Object.fromEntries(groups.map((g) => [g.key, [] as string[]]));
  const rows = await select<{ role: string; key: string }>(
    "SELECT rp.role, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id ORDER BY p.sort_order, p.key",
  );
  for (const r of rows) if (r.role in out && PERMISSION_KEYS.includes(r.key)) out[r.role].push(r.key);
  if (SUPER_ADMIN_GROUP in out) out[SUPER_ADMIN_GROUP] = [...PERMISSION_KEYS];
  return out;
}

/** ผู้รับแจ้งเตือนการเปลี่ยนสิทธิ์: ผู้ดูแลระบบ + ผู้ดูแลระบบรอง ทุกคนที่ใช้งานอยู่ */
export async function adminRecipients(exceptId?: number): Promise<number[]> {
  const rows = await select<{ id: number }>("SELECT id FROM users WHERE is_active = true AND role IN ('super_admin', 'admin') AND id <> ?", [exceptId ?? 0]);
  return rows.map((r) => Number(r.id));
}
