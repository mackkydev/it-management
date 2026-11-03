import { first, insert, scalar, select, update } from "../db.js";
import { decryptNullable, encryptString } from "../lib/laravel-crypt.js";
import { bool, int } from "../lib/validator.js";
import { dateOnly, diffInDays, fromDbDate, iso, localToday, nowDb } from "../lib/time.js";
import { can, type UserRow } from "../models/user.js";
import { getSetting } from "./settings.js";

/**
 * License ซอฟต์แวร์ — ตาราง licenses แยกจากสินทรัพย์ (license_files = ไฟล์แนบ + โลโก้)
 * license key เข้ารหัสด้วย APP_KEY และไม่ส่งออกใน resource (ดูได้ผ่าน POST /licenses/{uuid}/license-key เท่านั้น)
 */
export const BILLINGS = ["yearly", "custom", "perpetual"] as const;
export const LICENSE_STATUSES = ["active", "inactive", "lost", "disposed"] as const;
/** ประเภทของ License ซอฟต์แวร์ = ช่องในฟอร์มคอมพิวเตอร์ (os / office / antivirus) + อื่นๆ */
export const SOFTWARE_TYPES = ["office", "os", "antivirus", "other"] as const;
/** โลโก้เก็บใน license_files kind นี้ (1 ไฟล์ต่อ License — ไม่นับเป็นเอกสารแนบ) */
export const ICON_KIND = "icon";

export interface LicenseRow {
  id: number;
  uuid: string;
  license_no: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: string;
  location_id: number | null;
  branch_id: number | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  notes: string | null;
  software_type: string;
  billing: string;
  start_date: string;
  expires_at: string | null;
  seats: number | null;
  vendor: string | null;
  license_key: string | null;
  notify_days_before: number | null;
  notified_for_expires_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface LicenseFileRow {
  id: number;
  license_id: number;
  kind: string;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

/** ดูรายการ License (เมนู /licenses) — ผู้บันทึกการติดตั้ง หรือผู้ดูสินทรัพย์ทั้งหมด / เพิ่ม-แก้สินทรัพย์ */
export const viewsLicenses = (u: UserRow) => can(u, "licenses.install") || can(u, "assets.view_all") || can(u, "assets.create") || can(u, "assets.update");

/**
 * License "กำลังจะหมดอายุ" = ถึงช่วงแจ้งเตือนแล้ว (เหลือ ≤ notify_days_before หรือค่าตั้งต้น license_notify_days — รวมที่หมดอายุไปแล้ว)
 * และยังไม่ได้ "ต่อสัญญา" (วันหมดอายุใหม่พ้นช่วง) หรือ "ยกเลิกสัญญา" — ใช้กับแท็บ /licenses + ตัวเลขเมนู
 * คืน SQL (alias li = licenses) + params
 */
export async function expiringLicenseWhere(): Promise<{ sql: string; params: unknown[] }> {
  const days = Number(await getSetting("license_notify_days"));
  return {
    sql: `li.deleted_at IS NULL AND li.expires_at IS NOT NULL AND li.cancelled_at IS NULL
      AND li.expires_at <= DATE_ADD(CAST(? AS DATE), INTERVAL COALESCE(li.notify_days_before, ?) DAY)`,
    params: [localToday(), days],
  };
}

/** License นี้กำลังจะหมดอายุหรือไม่ (เงื่อนไขเดียวกับแท็บ/ตัวเลขเมนู) */
export async function isLicenseExpiring(id: number): Promise<boolean> {
  const w = await expiringLicenseWhere();
  return Boolean(await scalar(`SELECT 1 FROM licenses li WHERE li.id = ? AND ${w.sql}`, [id, ...w.params]));
}

/** จำนวน License ที่กำลังจะหมดอายุ (ตัวเลขเมนู /licenses + แท็บ — ผู้จัดการสัญญาได้ assets.update) */
export async function expiringLicenseCount(): Promise<number> {
  const w = await expiringLicenseWhere();
  return Number(await scalar(`SELECT COUNT(*) FROM licenses li WHERE ${w.sql}`, w.params));
}

export const loadFiles = (id: number) => select<LicenseFileRow>("SELECT * FROM license_files WHERE license_id = ? ORDER BY id", [id]);

/** จำนวนวันจากวันนี้ (ตามเวลาผู้ใช้) ถึงวันหมดอายุ — ติดลบ = หมดอายุแล้ว, null = ถาวร */
export function daysLeft(expiresAt: string | null): number | null {
  return expiresAt ? diffInDays(fromDbDate(localToday()), fromDbDate(expiresAt)) : null;
}

export function licenseTerms(l: LicenseRow, expiring: boolean) {
  const expires = dateOnly(l.expires_at);
  return {
    billing: l.billing,
    start_date: dateOnly(l.start_date),
    expires_at: expires,
    days_left: daysLeft(expires),
    seats: l.seats,
    vendor: l.vendor,
    notify_days_before: l.notify_days_before,
    software_type: l.software_type,
    cancelled_at: iso(l.cancelled_at),
    cancel_reason: l.cancel_reason,
    expiring,
    has_key: l.license_key !== null,
  };
}

export const fileJson = (uuid: string, f: LicenseFileRow) => ({
  id: f.id,
  kind: f.kind,
  name: f.original_name,
  mime: f.mime,
  size: Number(f.size),
  url: `/licenses/${uuid}/files/${f.id}`,
});

/**
 * ข้อมูลสัญญาจาก input.license → คอลัมน์ของ licenses (input ผ่าน validator แล้ว)
 * license_key ว่าง = คงค่าเดิม, clear_license_key = ล้าง, perpetual = ไม่มีวันหมดอายุ
 */
export function licenseTermValues(input: Record<string, unknown>, existing: LicenseRow | null): Record<string, unknown> {
  const billing = String(input.billing ?? existing?.billing);
  const key = typeof input.license_key === "string" && input.license_key.trim() !== "" ? input.license_key.trim() : null;
  const has = (k: string) => k in input;
  return {
    billing,
    start_date: has("start_date") ? String(input.start_date).slice(0, 10) : existing?.start_date,
    expires_at: billing === "perpetual" ? null : has("expires_at") ? (input.expires_at ? String(input.expires_at).slice(0, 10) : null) : existing?.expires_at,
    seats: has("seats") ? int(input.seats) : (existing?.seats ?? null),
    vendor: has("vendor") ? (typeof input.vendor === "string" && input.vendor.trim() !== "" ? input.vendor.trim() : null) : (existing?.vendor ?? null),
    notify_days_before: has("notify_days_before") ? int(input.notify_days_before) : (existing?.notify_days_before ?? null),
    software_type: has("software_type") && input.software_type ? String(input.software_type) : (existing?.software_type ?? "other"),
    license_key: key ? encryptString(key) : bool(input.clear_license_key) ? null : (existing?.license_key ?? null),
  };
}

/** จำนวน seat ที่ใช้อยู่ของ license (การติดตั้งที่ยังไม่ถอน) */
export const activeCount = async (licenseId: number) =>
  Number(await scalar("SELECT COUNT(*) FROM license_installations WHERE license_id = ? AND uninstalled_at IS NULL", [licenseId]));

export async function revealKey(id: number): Promise<string | null> {
  const l = await first<{ license_key: string | null }>("SELECT license_key FROM licenses WHERE id = ?", [id]);
  return l ? decryptNullable(l.license_key) : null;
}

export const touchLicense = (id: number, values: Record<string, unknown>) => update("licenses", { ...values, updated_at: nowDb() }, "id = ?", [id]);
export const addLicenseFile = (licenseId: number, file: Record<string, unknown>, userId: number) => {
  const now = nowDb();
  return insert("license_files", { license_id: licenseId, ...file, uploaded_by: userId, created_at: now, updated_at: now });
};
