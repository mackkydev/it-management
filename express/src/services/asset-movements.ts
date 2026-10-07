import { insert } from "../db.js";
import { nowDb, toDbDateTime } from "../lib/time.js";

/**
 * จุดเดียวที่สร้างประวัติการโอนย้าย (เหมือน AssetMovementService) — เรียกภายใน transaction เดียวกับการบันทึก asset
 */
export async function recordRegistration(assetId: number, locationId: number | null, custodianId: number | null, by: number): Promise<number | null> {
  if (locationId === null && custodianId === null) return null;
  const now = nowDb();
  return insert("asset_movements", {
    asset_id: assetId,
    type: "registered",
    to_location_id: locationId,
    to_custodian_id: custodianId,
    moved_at: now,
    performed_by: by,
    created_at: now,
  });
}

/** บันทึกเมื่อสถานที่หรือผู้ถือครองเปลี่ยน — คืน null ถ้าไม่เปลี่ยน */
export async function recordIfMoved(
  assetId: number,
  from: { location: number | null; custodian: number | null },
  to: { location: number | null; custodian: number | null },
  by: number,
  reason: string | null = null,
  movedAt: Date | null = null,
): Promise<number | null> {
  if (from.location === to.location && from.custodian === to.custodian) return null;
  const now = nowDb();
  return insert("asset_movements", {
    asset_id: assetId,
    type: "transfer",
    from_location_id: from.location,
    to_location_id: to.location,
    from_custodian_id: from.custodian,
    to_custodian_id: to.custodian,
    moved_at: movedAt ? toDbDateTime(movedAt) : now,
    reason,
    performed_by: by,
    created_at: now,
  });
}

/* ---------------------------------------------------------------- ประวัติผู้ใช้งาน (ทะเบียนคอมพิวเตอร์) */

export type UserInfo = { user_name: string | null; department: string | null };
export type UserLogSource = "create" | "edit" | "import";

const norm = (v: string | null | undefined) => (v ?? "").trim() || null;

/**
 * บันทึกเมื่อ "ชื่อ-สกุลผู้ใช้งาน" หรือ Department เปลี่ยน (ไม่สนช่องว่างหัวท้าย) — คืน null ถ้าไม่เปลี่ยน
 * สร้างใหม่ (from = null ทั้งคู่) บันทึกเมื่อมีค่าอย่างน้อยหนึ่งช่อง — เรียกภายใน transaction เดียวกับการบันทึก asset
 */
export async function recordUserChange(assetId: number, from: UserInfo, to: UserInfo, by: number, source: UserLogSource): Promise<number | null> {
  const f = { user_name: norm(from.user_name), department: norm(from.department) };
  const t = { user_name: norm(to.user_name), department: norm(to.department) };
  if (f.user_name === t.user_name && f.department === t.department) return null;
  const now = nowDb();
  return insert("asset_user_logs", {
    asset_id: assetId,
    from_user_name: f.user_name,
    to_user_name: t.user_name,
    from_department: f.department,
    to_department: t.department,
    source,
    changed_at: now,
    performed_by: by,
    created_at: now,
  });
}
