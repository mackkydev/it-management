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
