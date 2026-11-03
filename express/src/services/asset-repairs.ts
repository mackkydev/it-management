import { scalar, select } from "../db.js";
import { iso } from "../lib/time.js";

/**
 * ประวัติการซ่อม = ใบแจ้งงานประเภท repair (ไม่รวมใบที่ยกเลิก/ไม่อนุมัติ)
 * ผูกสินทรัพย์ด้วย asset_id หรือเลขที่พิมพ์ในใบ (ใบที่แจ้งก่อนลงทะเบียนสินทรัพย์ asset_id ว่าง) — ตรงรหัสสินทรัพย์ / เลขที่ทรัพย์สิน / เลขที่ทรัพย์สิน (เดิม)
 * ใช้ทั้งหน้ารายละเอียดสินทรัพย์ (/assets/{uuid}/repairs) และหน้ารวม (/repairs)
 * ส่งเฉพาะข้อมูลการซ่อม (ไม่มีไฟล์แนบ/ลายเซ็น) — รายละเอียดเต็มเปิดที่หน้าใบงานซึ่งตรวจสิทธิ์เอง
 */
/**
 * สินทรัพย์ 1 รายการที่ตรงเลขที่ผู้แจ้งพิมพ์ (expr = นิพจน์ SQL ของเลขนั้น) — ลำดับ: รหัสสินทรัพย์ → เลขที่ทรัพย์สิน (cpu_tag) → เลขที่ทรัพย์สิน (เดิม) (monitor_tag)
 * เลือกรายการเดียวเสมอ (กันแถวซ้ำเมื่อเลขเดียวกันไปตรงหลายเครื่อง)
 */
export const assetByNumberSql = (expr: string) =>
  `(SELECT x.id FROM assets x WHERE x.deleted_at IS NULL AND (x.asset_tag = ${expr} OR x.cpu_tag = ${expr} OR x.monitor_tag = ${expr})
     ORDER BY x.asset_tag = ${expr} DESC, x.cpu_tag = ${expr} DESC, x.id LIMIT 1)`;

/** id สินทรัพย์ที่ตรงเลขที่พิมพ์ในใบแจ้งงาน (ไม่พบ = null) — ใช้ตอนแจ้ง/แก้ใบงาน */
export async function assetIdByNumber(no: unknown): Promise<number | null> {
  const tag = typeof no === "string" ? no.trim() : "";
  if (!tag) return null;
  const id = await scalar<number>(
    `SELECT x.id FROM assets x WHERE x.deleted_at IS NULL AND (x.asset_tag = ? OR x.cpu_tag = ? OR x.monitor_tag = ?)
      ORDER BY x.asset_tag = ? DESC, x.cpu_tag = ? DESC, x.id LIMIT 1`,
    [tag, tag, tag, tag, tag],
  );
  return id === null || id === undefined ? null : Number(id);
}

export const REPAIR_FROM = `it_tickets t
  LEFT JOIN assets a ON a.deleted_at IS NULL AND a.id = COALESCE(t.asset_id, ${assetByNumberSql("t.asset_tag")})
  LEFT JOIN users r ON r.id = t.requester_id
  LEFT JOIN users s ON s.id = t.assignee_id
  LEFT JOIN branches b ON b.id = COALESCE(t.branch_id, a.branch_id)
  LEFT JOIN branches ab ON ab.id = a.branch_id`;
export const REPAIR_BASE_WHERE = "t.type = 'repair' AND t.status NOT IN ('cancelled', 'rejected')";

type RepairRow = {
  id: number; uuid: string; ticket_no: string; status: string; requested_at: string; symptom: string | null; details: string;
  device_name: string | null; asset_tag: string | null; result: string | null; completed_on: string | null; cannot_reason: string | null;
  repair_method: string | null; external_vendor: string | null; warranty: string | null; repair_details: string | null;
  requester_name: string | null; assignee_name: string | null;
  a_uuid: string | null; a_tag: string | null; a_name: string | null; a_category: string | null; b_name: string | null; ab_name: string | null;
};

/** ดึงรายการตามเงื่อนไข (where/params ต่อท้าย REPAIR_BASE_WHERE) ล่าสุดก่อน + อะไหล่ของแต่ละใบ */
export async function repairList(where: string, params: unknown[], limit: number, offset = 0) {
  const rows = await select<RepairRow>(
    `SELECT t.id, t.uuid, t.ticket_no, t.status, t.requested_at, t.symptom, t.details, t.device_name, t.asset_tag, t.result, t.completed_on,
            t.cannot_reason, t.repair_method, t.external_vendor, t.warranty, t.repair_details, r.name AS requester_name, s.name AS assignee_name,
            a.uuid AS a_uuid, a.asset_tag AS a_tag, a.name AS a_name, a.category AS a_category, b.name AS b_name, ab.name AS ab_name
       FROM ${REPAIR_FROM}
      WHERE ${REPAIR_BASE_WHERE} AND ${where}
      ORDER BY t.requested_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const parts = rows.length
    ? await select<{ it_ticket_id: number; name: string; quantity: number }>("SELECT it_ticket_id, name, quantity FROM it_ticket_parts WHERE it_ticket_id IN (?) ORDER BY id", [rows.map((r) => r.id)])
    : [];
  return rows.map((r) => ({
    id: r.uuid,
    ticket_no: r.ticket_no,
    status: r.status,
    requested_at: iso(r.requested_at),
    symptom: r.symptom ?? r.details,
    device_name: r.device_name,
    asset_tag: r.asset_tag,
    asset: r.a_uuid ? { id: r.a_uuid, asset_tag: r.a_tag, name: r.a_name, category: r.a_category } : null,
    // สาขาตอนแจ้ง (ใบงาน) — ใบที่ไม่ได้ระบุ = สาขาปัจจุบันของเครื่อง; asset_branch = สาขาปัจจุบันของเครื่อง (เครื่องย้ายสาขาแล้วใบเดิมยังอยู่สาขาเดิม)
    branch: r.b_name,
    asset_branch: r.ab_name,
    result: r.result,
    completed_on: r.completed_on ? String(r.completed_on).slice(0, 10) : null,
    cannot_reason: r.cannot_reason,
    repair_method: r.repair_method,
    external_vendor: r.external_vendor,
    warranty: r.warranty,
    repair_details: r.repair_details,
    requester: r.requester_name,
    assignee: r.assignee_name,
    parts: parts.filter((p) => p.it_ticket_id === r.id).map((p) => ({ name: p.name, quantity: p.quantity })),
  }));
}
