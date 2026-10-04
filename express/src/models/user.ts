import { first, scalar } from "../db.js";
import { PERMISSIONS } from "./permission.js";

/** แถวของตาราง users (คอลัมน์เดียวกับ Laravel) */
export interface UserRow {
  id: number;
  name: string;
  /** LOCAL มีเสมอ (CHECK users_local_credentials_check) — API User อาจว่างได้ */
  email: string | null;
  /** ชื่อผู้ใช้สำหรับ login (ไม่บังคับ, ไม่มี @) */
  username: string | null;
  /** admin | division_manager (ผู้จัดการฝ่าย) | manager (ผู้จัดการ) | it_staff (เจ้าหน้าที่ IT) | viewer (พนักงาน) */
  role: Role;
  /** LOCAL = ผู้ใช้ของระบบเรา (ผู้ใช้เดิมทั้งหมด) / API = ผู้ใช้จาก REST API ต้นทาง */
  type: UserType;
  /** API User: การเชื่อมต่อต้นทาง + รหัสผู้ใช้ที่ต้นทาง */
  connection_id: number | null;
  external_id: string | null;
  external_synced_at: string | null;
  /** สถานะจากการซิงค์รายชื่อกับต้นทาง: active | disabled | missing */
  external_status: "active" | "disabled" | "missing" | null;
  is_active: boolean;
  branch_id: number | null;
  department: string | null;
  division: string | null;
  supervisor_id: number | null;
  is_it_staff: boolean;
  is_it_head: boolean;
  /** hash รหัสผ่าน — เฉพาะ LOCAL; API User = null เสมอ (ระบบต้นทางเป็นเจ้าของ credential) */
  password: string | null;
  /** ไฟล์ลายเซ็นที่อัปโหลด (relative ใน FILES_ROOT) */
  signature_path: string | null;
  /** สายอนุมัติที่กำหนดรายบุคคล (null = จับคู่อัตโนมัติตามสาขา+แผนก) */
  approval_route_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  /** สิทธิ์จริงของผู้ใช้ (middleware auth โหลดให้ทุก request — ไม่ใช่คอลัมน์ในตาราง) */
  perms?: ReadonlySet<string>;
}

export const ROLES = ["admin", "division_manager", "manager", "it_staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const USER_TYPES = ["LOCAL", "API"] as const;
export type UserType = (typeof USER_TYPES)[number];

/** ผู้ใช้ของระบบเรา — login ด้วยอีเมล+รหัสผ่านใน DB เรา */
export const isLocal = (u: UserRow): u is UserRow & { email: string; password: string } => u.type === "LOCAL" && u.password !== null;

/** role = admin (ใช้กับกติกาข้อมูล เช่น กันแก้ role ของตัวเอง — การตรวจสิทธิ์ใช้ can()) */
export const isAdmin = (u: UserRow) => u.role === "admin";
/** Local Admin = ผ่านทุกสิทธิ์ และเป็นผู้เดียวที่จัดการการเชื่อมต่อ API / สิทธิ์ของผู้ใช้ได้ */
export const isLocalAdmin = (u: UserRow) => u.role === "admin" && isLocal(u);

/**
 * ตรวจสิทธิ์ตาม permission key (ดู models/permission.ts)
 * สิทธิ์จริง = สิทธิ์ของกลุ่ม (role + it_staff/it_head) + เพิ่มรายคน − ถอดรายคน — middleware auth คำนวณไว้ใน u.perms
 * ถ้ายังไม่ได้โหลด (เช่น CLI) ใช้สิทธิ์ตั้งต้นของกลุ่มจาก catalog
 */
export function can(u: UserRow, key: string): boolean {
  if (isLocalAdmin(u)) return true;
  if (u.perms) return u.perms.has(key);
  const groups: string[] = [u.role, ...(u.is_it_staff ? ["it_staff"] : []), ...(u.is_it_head ? ["it_head"] : [])];
  return PERMISSIONS.some((p) => p.key === key && p.defaults.some((d) => groups.includes(d)));
}

export async function findUser(id: number): Promise<UserRow | null> {
  return first<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

/** มีประวัติในระบบหรือไม่ — ถ้ามี ห้ามลบ (ให้ปิดใช้งานแทน) */
export async function hasHistory(id: number): Promise<boolean> {
  const found = await scalar<number>(
    `SELECT EXISTS(SELECT 1 FROM assets WHERE custodian_id = ? OR created_by = ?)
         OR EXISTS(SELECT 1 FROM asset_movements WHERE performed_by = ? OR from_custodian_id = ? OR to_custodian_id = ?)
         OR EXISTS(SELECT 1 FROM it_tickets WHERE requester_id = ? OR assignee_id = ? OR approver_id = ? OR it_head_id = ?)
         OR EXISTS(SELECT 1 FROM kpi_entries WHERE user_id = ?) AS found`,
    [id, id, id, id, id, id, id, id, id, id],
  );
  return Boolean(Number(found));
}
