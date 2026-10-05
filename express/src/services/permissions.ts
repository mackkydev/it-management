import { exec, insert, select } from "../db.js";
import { nowDb } from "../lib/time.js";
import { AUDIENCES, PERMISSION_KEYS, PERMISSIONS, type Audience } from "../models/permission.js";
import { isLocalAdmin, type UserRow } from "../models/user.js";

/**
 * สร้าง key สิทธิ์ที่ยังไม่มีในตาราง + กำหนดสิทธิ์ตั้งต้นให้กลุ่มตาม defaults (เฉพาะ key ที่เพิ่งสร้าง)
 * key ที่มีอยู่แล้ว: ไม่แตะชื่อ/ลำดับ/การกำหนดสิทธิ์ที่ admin ปรับไว้ — รันซ้ำได้ทุกครั้งที่ start
 */
export async function ensurePermissions(): Promise<void> {
  const now = nowDb();
  const existing = new Set((await select<{ key: string }>('SELECT "key" FROM permissions')).map((r) => r.key));
  for (const [i, p] of PERMISSIONS.entries()) {
    if (existing.has(p.key)) continue;
    const created = await insert("permissions", { key: p.key, group: p.group, name_th: p.name_th, name_en: p.name_en, sort_order: i, created_at: now, updated_at: now });
    for (const audience of p.defaults) {
      await exec("INSERT IGNORE INTO role_permissions (role, permission_id, created_at) VALUES (?, ?, ?)", [audience, created, now]);
    }
  }
}

/** กลุ่มของผู้ใช้: role + it_staff / it_head */
export function audiencesOf(u: Pick<UserRow, "role" | "is_it_staff" | "is_it_head">): Audience[] {
  const list: Audience[] = [u.role];
  if (u.is_it_staff) list.push("it_staff");
  if (u.is_it_head) list.push("it_head");
  return list;
}

/** สิทธิ์จริง = สิทธิ์ของกลุ่ม + allow รายคน − deny รายคน (Local Admin = ทุกสิทธิ์) */
export async function permissionsOf(u: UserRow): Promise<Set<string>> {
  if (isLocalAdmin(u)) return new Set(PERMISSION_KEYS);
  const rows = await select<{ key: string }>(
    `SELECT p.key FROM permissions p
     WHERE (EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id AND rp.role IN (?))
            OR EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = ? AND up.effect = 'allow'))
       AND NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = ? AND up.effect = 'deny')`,
    [audiencesOf(u), u.id, u.id],
  );
  return new Set(rows.map((r) => r.key));
}

/** สิทธิ์ของแต่ละกลุ่ม (ใช้แสดงผล/จำลองในหน้าตั้งค่า) */
export async function audiencePermissions(): Promise<Record<Audience, string[]>> {
  const rows = await select<{ role: string; key: string }>(
    "SELECT rp.role, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id ORDER BY p.sort_order, p.key",
  );
  const out = Object.fromEntries(AUDIENCES.map((a) => [a, [] as string[]])) as Record<Audience, string[]>;
  for (const r of rows) if ((AUDIENCES as readonly string[]).includes(r.role)) out[r.role as Audience].push(r.key);
  return out;
}
