import { first, scalar } from "../db.js";

/** แถวของตาราง users (คอลัมน์เดียวกับ Laravel) */
export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: "admin" | "manager" | "viewer";
  is_active: boolean;
  branch_id: number | null;
  department: string | null;
  division: string | null;
  supervisor_id: number | null;
  is_it_staff: boolean;
  is_it_head: boolean;
  password: string;
  /** ไฟล์ลายเซ็นที่อัปโหลด (relative ใน FILES_ROOT) */
  signature_path: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const ROLES = ["admin", "manager", "viewer"] as const;

export const isAdmin = (u: UserRow) => u.role === "admin";
/** เพิ่ม/แก้ไขสินทรัพย์และสถานที่ได้ (UserRole::canManageAssets) */
export const canManageAssets = (u: UserRow) => u.role === "admin" || u.role === "manager";
/** เจ้าหน้าที่ฝ่าย IT (รวมหัวหน้า IT) */
export const isIt = (u: UserRow) => Boolean(u.is_it_staff || u.is_it_head);
/** Gate "it-data": คลังรหัสผ่าน / สัญญา / งาน IT ทั้งหมด */
export const canAccessItData = (u: UserRow) => isAdmin(u) || isIt(u);

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
