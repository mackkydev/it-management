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
  /** ตำแหน่ง: super_admin (ผู้ดูแลระบบสูงสุด) | admin (ผู้ดูแลระบบ) | division_manager (ผู้จัดการฝ่าย) | manager (ผู้จัดการ) | viewer (พนักงาน) */
  role: Role;
  /** LOCAL = ผู้ใช้ของระบบเรา (ผู้ใช้เดิมทั้งหมด) / API = ผู้ใช้จาก REST API ต้นทาง */
  type: UserType;
  /** API User: การเชื่อมต่อต้นทาง + รหัสผู้ใช้ที่ต้นทาง */
  connection_id: number | null;
  external_id: string | null;
  external_synced_at: string | null;
  /** PIN กลาง: กรอกผิดติดกัน / ล็อกถึงเวลา (ตัวนับรายคน) */
  secret_pin_failures?: number;
  secret_pin_locked_until?: string | null;
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

export const ROLES = ["super_admin", "admin", "division_manager", "manager", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** ลำดับตำแหน่ง (มาก = สูงกว่า): ผู้ดูแลระบบสูงสุด > ผู้ดูแลระบบ > ผู้จัดการ > ผู้จัดการฝ่าย > พนักงาน — ใช้กรองผู้อนุมัติที่ผู้แจ้งเลือกได้ */
export const ROLE_RANK: Record<Role, number> = { super_admin: 5, admin: 4, manager: 3, division_manager: 2, viewer: 1 };
export const roleRank = (role: string): number => ROLE_RANK[role as Role] ?? 1;
/** บทบาทที่สูงกว่าบทบาทนี้ */
export const rolesAbove = (role: string): Role[] => ROLES.filter((r) => ROLE_RANK[r] > roleRank(role));

export const USER_TYPES = ["LOCAL", "API"] as const;
export type UserType = (typeof USER_TYPES)[number];

/** ผู้ใช้ของระบบเรา — login ด้วยอีเมล+รหัสผ่านใน DB เรา */
export const isLocal = (u: UserRow): u is UserRow & { email: string; password: string } => u.type === "LOCAL" && u.password !== null;

/** ผู้ดูแลระบบ (super_admin — ผู้ใช้ LOCAL หรือ API) = ผ่านทุกสิทธิ์ และเป็นผู้เดียวที่มอบ/ถอดสิทธิ์ที่สงวนไว้ (locked) และตั้ง super_admin ได้ */
export const isSuperAdmin = (u: Pick<UserRow, "role">) => u.role === "super_admin";
/**
 * ผู้ดูแลระบบที่เป็นบัญชี LOCAL — ทางสำรองเข้าระบบเมื่อระบบต้นทางล่ม (ต้องเหลืออย่างน้อย 1 คนที่ใช้งานอยู่เสมอ)
 * และเป็นผู้เดียวที่แก้การเชื่อมต่อ API ได้ (กันบัญชีต้นทางที่ถูกยึด เปลี่ยนหน้า login ไปดักรหัสผ่าน)
 */
export const isLocalSuperAdmin = (u: UserRow) => isSuperAdmin(u) && isLocal(u);

/** จำนวน super_admin บัญชี LOCAL ที่ใช้งานอยู่ (ยกเว้น id ที่ระบุ) — กันลด/ปิด/ลบคนสุดท้าย */
export async function otherLocalSuperAdmins(exceptId: number): Promise<number> {
  return Number(await scalar("SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND type = 'LOCAL' AND password IS NOT NULL AND is_active = true AND id <> ?", [exceptId]));
}

/**
 * ตรวจสิทธิ์ตาม permission key (ดู models/permission.ts)
 * สิทธิ์จริง = สิทธิ์ของทุกกลุ่ม (ตำแหน่ง + กลุ่มที่มอบเพิ่ม) + เพิ่มรายคน − ถอดรายคน — middleware auth คำนวณไว้ใน u.perms
 * ถ้ายังไม่ได้โหลด (เช่น CLI) ใช้สิทธิ์ตั้งต้นของกลุ่มตามตำแหน่งจาก catalog
 */
export function can(u: UserRow, key: string): boolean {
  if (isSuperAdmin(u)) return true;
  if (u.perms) return u.perms.has(key);
  return PERMISSIONS.some((p) => p.key === key && p.defaults.includes(u.role as never));
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
