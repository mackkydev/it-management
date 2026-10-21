import { select } from "../db.js";
import { can, isSuperAdmin, type UserRow } from "../models/user.js";
import { activeClause, groupsOf } from "./permissions.js";
import { getSetting } from "./settings.js";

/**
 * ขอบเขตการจัดการตามสาขา ต่อกลุ่ม (app_settings.manage_scope = { group_key: "all" | "branch" }, ไม่ตั้ง = ทุกสาขา)
 * ใช้กับสิทธิ์จัดการที่กระทบคนอื่นเท่านั้น (MANAGE_SCOPED_KEYS) เช่น HR สาขา: อนุมัติลาแทน / ดูใบลา / วันหยุด / จัดการผู้ใช้ เฉพาะสาขาตัวเอง
 *
 * ขอบเขตของสิทธิ์ 1 ข้อ = กว้างสุดของกลุ่มที่ "ให้สิทธิ์ข้อนั้นจริง" (ไม่ใช่ทุกกลุ่มของผู้ใช้ — ผู้จัดการที่อยู่กลุ่ม "HR สาขา" ด้วย
 * ได้ขอบเขตจากกลุ่ม HR สาขา) · อนุญาตรายคน = ขอบเขตของกลุ่มตามตำแหน่ง · super_admin = ทุกสาขา
 * branch = ผู้ใช้เป้าหมายอยู่สาขาเดียวกับผู้ทำ (users.branch_id) — ผู้ทำที่ไม่มีสาขาจัดการใครไม่ได้
 */
export const MANAGE_SCOPES = ["all", "branch"] as const;
export type ManageScope = (typeof MANAGE_SCOPES)[number];

export const MANAGE_SCOPED_KEYS = ["users.create", "users.update", "users.delete", "leave.view_all", "leave.approve_any", "holidays.manage"] as const;

export async function manageScopeSettings(): Promise<Record<string, ManageScope>> {
  const raw = await getSetting("manage_scope");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => (MANAGE_SCOPES as readonly unknown[]).includes(v))) as Record<string, ManageScope>;
}

/** ขอบเขตของสิทธิ์ key ของผู้ใช้ — null = ไม่มีสิทธิ์ข้อนี้ */
export async function scopeOf(u: UserRow, key: string): Promise<ManageScope | null> {
  if (!can(u, key)) return null;
  if (isSuperAdmin(u)) return "all";
  const map = await manageScopeSettings();
  const groups = await groupsOf(u);
  const granting = (
    await select<{ role: string }>(
      'SELECT rp.role FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p."key" = ? AND rp.role IN (?)',
      [key, groups],
    )
  ).map((r) => r.role);
  const active = await activeClause("up");
  const allowed = await select<{ x: number }>(
    `SELECT 1 AS x FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ? AND p."key" = ? AND up.effect = 'allow' AND ${active.sql}`,
    [u.id, key, ...active.params],
  );
  const sources = [...granting, ...(allowed.length ? [u.role] : [])];
  if (!sources.length) return "all";
  return sources.some((g) => (map[g] ?? "all") === "all") ? "all" : "branch";
}

/** ผู้ทำใช้สิทธิ์ key กับคน/ข้อมูลของสาขานี้ได้ไหม (targetBranch = users.branch_id ของผู้ใช้เป้าหมาย) */
export async function canFor(u: UserRow, key: string, targetBranch: number | null | undefined): Promise<boolean> {
  const scope = await scopeOf(u, key);
  if (scope === null) return false;
  return scope === "all" || sameBranch(u, targetBranch);
}

export const sameBranch = (u: UserRow, targetBranch: number | null | undefined) =>
  u.branch_id !== null && u.branch_id !== undefined && targetBranch !== null && targetBranch !== undefined && Number(targetBranch) === Number(u.branch_id);

/**
 * เงื่อนไข SQL จำกัดตามขอบเขตของสิทธิ์ key — column = คอลัมน์ branch_id ของผู้ใช้เป้าหมาย (เช่น "o.branch_id")
 * ทุกสาขา = "1 = 1", สาขาตัวเอง = column = สาขาของผู้ทำ (ไม่มีสาขา = "1 = 0")
 */
export async function scopeWhere(u: UserRow, key: string, column: string): Promise<{ sql: string; params: unknown[] }> {
  const scope = await scopeOf(u, key);
  if (scope === null) return { sql: "1 = 0", params: [] };
  if (scope === "all") return { sql: "1 = 1", params: [] };
  return u.branch_id ? { sql: `${column} = ?`, params: [u.branch_id] } : { sql: "1 = 0", params: [] };
}
