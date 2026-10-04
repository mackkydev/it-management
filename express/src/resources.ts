import { trans, type Locale } from "./lib/i18n.js";
import { dateOnly, iso } from "./lib/time.js";
import type { UserRow } from "./models/user.js";
import { fileJson, licenseJson, type AssetFileRow, type LicenseRow } from "./services/asset-licenses.js";

/** JSON ของแต่ละ model — รูปแบบเดียวกับ App\Http\Resources ของ Laravel */

const bool = (v: unknown) => Boolean(Number(v));
export const person = (id: number | null | undefined, name: string | null | undefined) =>
  id && name !== null && name !== undefined ? { id, name } : null;

/** URL ลายเซ็นของตัวเอง — ?v= เปลี่ยนเมื่ออัปโหลดใหม่ (ชื่อไฟล์สุ่ม) เพื่อไม่ให้ browser ใช้รูปเก่าจาก cache */
/** URL รูปลายเซ็นของตัวเอง (?v = id ของลายเซ็น — เปลี่ยนเมื่อเปลี่ยนลายเซ็น) */
export const ownSignatureUrl = (signatureId: number | null | undefined) => (signatureId ? `/auth/me/signature?v=${signatureId}` : null);

/**
 * UserResource — ใช้กับแถว users เต็ม (whenHas ของ Laravel = ทุกฟิลด์มีอยู่)
 * extra.branch/supervisor = relation ที่โหลด (undefined = ไม่ใส่ key), custodian_assets_count = เมื่อนับ
 * viewerId: signature_url แสดงเฉพาะเมื่อเป็นข้อมูลของผู้ที่เรียกเอง (คนอื่นได้ null)
 */
export function userResource(
  u: UserRow,
  extra: {
    branch?: { id: number; name: string } | null;
    supervisor?: { id: number; name: string } | null;
    custodian_assets_count?: number;
    /** id ลายเซ็นที่ใช้งานอยู่ (null = ไม่มี) */
    signature_id?: number | null;
  } = {},
  viewerId?: number,
) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username ?? null,
    role: u.role,
    /** LOCAL | API — API User ไม่มีรหัสผ่านในระบบเรา (frontend ซ่อนเมนูเปลี่ยนรหัสผ่าน) */
    type: u.type,
    is_active: bool(u.is_active),
    branch_id: u.branch_id,
    ...("branch" in extra ? { branch: extra.branch } : {}),
    department: u.department,
    division: u.division,
    supervisor_id: u.supervisor_id,
    ...("supervisor" in extra ? { supervisor: extra.supervisor } : {}),
    is_it_staff: bool(u.is_it_staff),
    is_it_head: bool(u.is_it_head),
    approval_route_id: u.approval_route_id,
    ...(extra.custodian_assets_count !== undefined ? { custodian_assets_count: extra.custodian_assets_count } : {}),
    signature_url: viewerId === u.id ? ownSignatureUrl(extra.signature_id) : null,
    ...(extra.signature_id !== undefined ? { has_signature: extra.signature_id !== null } : {}),
    created_at: iso(u.created_at),
  };
}

export interface LocationRow {
  id: number;
  code: string;
  name: string;
  type: string;
  parent_id: number | null;
  address?: string | null;
  is_active?: number;
  assets_count?: number;
  children_count?: number;
}

/** LocationResource (address / is_active / counts ใส่เมื่อมีในแถว) */
export function locationResource(l: LocationRow) {
  return {
    id: l.id,
    code: l.code,
    name: l.name,
    type: l.type,
    parent_id: l.parent_id,
    ...("address" in l ? { address: l.address } : {}),
    ...("is_active" in l ? { is_active: bool(l.is_active) } : {}),
    ...("assets_count" in l ? { assets_count: Number(l.assets_count) } : {}),
    ...("children_count" in l ? { children_count: Number(l.children_count) } : {}),
  };
}

export interface AssetRow {
  id: number;
  uuid: string;
  asset_tag: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: string;
  location_id: number | null;
  custodian_id: number | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  warranty_expires_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** AssetResource — id ภายนอก = uuid (ไม่เปิดเผย primary key) */
export function assetResource(
  a: AssetRow,
  locale: Locale,
  rel: {
    location?: LocationRow | null;
    custodian?: { id: number; name: string } | null;
    license?: LicenseRow | null;
    files?: AssetFileRow[];
  } = {},
) {
  return {
    id: a.uuid,
    asset_tag: a.asset_tag,
    name: a.name,
    category: a.category,
    brand: a.brand,
    model: a.model,
    serial_number: a.serial_number,
    status: a.status,
    status_label: trans(locale, `eam.status.${a.status}`),
    ...("location" in rel ? { location: rel.location ? locationResource(rel.location) : null } : {}),
    ...("custodian" in rel ? { custodian: rel.custodian } : {}),
    purchase_date: dateOnly(a.purchase_date),
    purchase_cost: a.purchase_cost,
    warranty_expires_at: dateOnly(a.warranty_expires_at),
    notes: a.notes,
    ...("license" in rel ? { license: rel.license ? licenseJson(rel.license) : null } : {}),
    ...("files" in rel ? { files: (rel.files ?? []).map((f) => fileJson(a.uuid, f)) } : {}),
    created_at: iso(a.created_at),
    updated_at: iso(a.updated_at),
  };
}

/** แถวของ asset_movements ที่ join ชื่อสถานที่/ผู้ใช้มาแล้ว (ดู MOVEMENT_SELECT) */
export interface MovementJoinedRow {
  id: number;
  type: string;
  moved_at: string;
  reason: string | null;
  created_at: string | null;
  fl_id: number | null; fl_code: string | null; fl_name: string | null;
  tl_id: number | null; tl_code: string | null; tl_name: string | null;
  fc_id: number | null; fc_name: string | null;
  tc_id: number | null; tc_name: string | null;
  pb_id: number | null; pb_name: string | null;
  a_uuid?: string | null; a_tag?: string | null; a_name?: string | null;
}

/** relation belongsTo ของ Laravel ไม่รวมสถานที่ที่ถูก soft delete จึง join เฉพาะ deleted_at IS NULL */
export const MOVEMENT_SELECT = `
  m.id, m.type, m.moved_at, m.reason, m.created_at,
  fl.id AS fl_id, fl.code AS fl_code, fl.name AS fl_name,
  tl.id AS tl_id, tl.code AS tl_code, tl.name AS tl_name,
  fc.id AS fc_id, fc.name AS fc_name,
  tc.id AS tc_id, tc.name AS tc_name,
  pb.id AS pb_id, pb.name AS pb_name`;

export const MOVEMENT_JOINS = `
  LEFT JOIN locations fl ON fl.id = m.from_location_id AND fl.deleted_at IS NULL
  LEFT JOIN locations tl ON tl.id = m.to_location_id AND tl.deleted_at IS NULL
  LEFT JOIN users fc ON fc.id = m.from_custodian_id
  LEFT JOIN users tc ON tc.id = m.to_custodian_id
  LEFT JOIN users pb ON pb.id = m.performed_by`;

export function movementResource(m: MovementJoinedRow, locale: Locale, withAsset = false) {
  const loc = (id: number | null, code: string | null, name: string | null) => (id ? { id, code, name } : null);
  return {
    id: m.id,
    ...(withAsset ? { asset: m.a_uuid ? { id: m.a_uuid, asset_tag: m.a_tag, name: m.a_name } : null } : {}),
    type: m.type,
    type_label: trans(locale, `eam.movement_type.${m.type}`),
    from_location: loc(m.fl_id, m.fl_code, m.fl_name),
    to_location: loc(m.tl_id, m.tl_code, m.tl_name),
    from_custodian: person(m.fc_id, m.fc_name),
    to_custodian: person(m.tc_id, m.tc_name),
    moved_at: iso(m.moved_at),
    reason: m.reason,
    performed_by: person(m.pb_id, m.pb_name),
    created_at: iso(m.created_at),
  };
}
