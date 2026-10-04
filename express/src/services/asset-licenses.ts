import { exec, first, insert, scalar, select, update } from "../db.js";
import { decryptNullable, encryptString } from "../lib/laravel-crypt.js";
import { bool, int } from "../lib/validator.js";
import { dateOnly, diffInDays, fromDbDate, localToday, nowDb } from "../lib/time.js";

/**
 * Software license ของสินทรัพย์ (หมวด SOFTWARE) + ไฟล์แนบ — เหมือน App\Services\AssetLicenses ของ Laravel
 * license key เข้ารหัสด้วย APP_KEY และไม่ส่งออกใน resource (ดูได้ผ่าน POST /assets/{uuid}/license-key เท่านั้น)
 */
export const LICENSE_CATEGORY = "SOFTWARE";
export const BILLINGS = ["yearly", "custom", "perpetual"] as const;

export interface LicenseRow {
  id: number;
  asset_id: number;
  billing: string;
  start_date: string;
  expires_at: string | null;
  seats: number | null;
  vendor: string | null;
  license_key: string | null;
  notify_days_before: number | null;
  notified_for_expires_at: string | null;
}

export interface AssetFileRow {
  id: number;
  asset_id: number;
  kind: string;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

export const loadLicense = (assetId: number) => first<LicenseRow>("SELECT * FROM asset_licenses WHERE asset_id = ?", [assetId]);

export const loadFiles = (assetId: number) =>
  select<AssetFileRow>("SELECT * FROM asset_files WHERE asset_id = ? ORDER BY id", [assetId]);

/** จำนวนวันจากวันนี้ (ตามเวลาผู้ใช้) ถึงวันหมดอายุ — ติดลบ = หมดอายุแล้ว, null = ถาวร */
export function daysLeft(expiresAt: string | null): number | null {
  return expiresAt ? diffInDays(fromDbDate(localToday()), fromDbDate(expiresAt)) : null;
}

export function licenseJson(l: LicenseRow) {
  const expires = dateOnly(l.expires_at);
  return {
    billing: l.billing,
    start_date: dateOnly(l.start_date),
    expires_at: expires,
    days_left: daysLeft(expires),
    seats: l.seats,
    vendor: l.vendor,
    notify_days_before: l.notify_days_before,
    has_key: l.license_key !== null,
  };
}

export function fileJson(assetUuid: string, f: AssetFileRow) {
  return { id: f.id, kind: f.kind, name: f.original_name, mime: f.mime, size: Number(f.size), url: `/assets/${assetUuid}/files/${f.id}` };
}

/**
 * บันทึก license (เรียกภายใน transaction) — input ผ่าน validator แล้ว
 * license_key ว่าง = คงค่าเดิม, clear_license_key = ล้าง, perpetual = ไม่มีวันหมดอายุ
 */
export async function saveLicense(assetId: number, input: Record<string, unknown>): Promise<void> {
  const existing = await loadLicense(assetId);
  const billing = String(input.billing ?? existing?.billing);
  const key = typeof input.license_key === "string" && input.license_key.trim() !== "" ? input.license_key.trim() : null;
  const has = (k: string) => k in input;
  const values: Record<string, unknown> = {
    billing,
    start_date: has("start_date") ? String(input.start_date).slice(0, 10) : existing?.start_date,
    expires_at: billing === "perpetual" ? null : has("expires_at") ? (input.expires_at ? String(input.expires_at).slice(0, 10) : null) : existing?.expires_at,
    seats: has("seats") ? int(input.seats) : (existing?.seats ?? null),
    vendor: has("vendor") ? (typeof input.vendor === "string" && input.vendor.trim() !== "" ? input.vendor.trim() : null) : (existing?.vendor ?? null),
    notify_days_before: has("notify_days_before") ? int(input.notify_days_before) : (existing?.notify_days_before ?? null),
    license_key: key ? encryptString(key) : bool(input.clear_license_key) ? null : (existing?.license_key ?? null),
    updated_at: nowDb(),
  };
  if (existing) await update("asset_licenses", values, "id = ?", [existing.id]);
  else await insert("asset_licenses", { asset_id: assetId, ...values, created_at: nowDb() });
}

/** จำนวน seat ที่ใช้อยู่ของ license (การติดตั้งที่ยังไม่ถอน) */
export const activeCount = async (licenseAssetId: number) =>
  Number(await scalar("SELECT COUNT(*) FROM license_installations WHERE license_asset_id = ? AND uninstalled_at IS NULL", [licenseAssetId]));

export const deleteLicense = (assetId: number) => exec("DELETE FROM asset_licenses WHERE asset_id = ?", [assetId]);

export async function revealKey(assetId: number): Promise<string | null> {
  const l = await loadLicense(assetId);
  return l ? decryptNullable(l.license_key) : null;
}
