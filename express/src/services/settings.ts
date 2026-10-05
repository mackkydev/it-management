import { config } from "../config.js";
import { exec, select } from "../db.js";
import { nowDb } from "../lib/time.js";

/**
 * ตั้งค่าระบบ key-value (ตาราง app_settings, value เป็น JSONB) — เหมือน App\Models\AppSetting
 * ไม่ cache ใน Express (อ่านตรงจาก DB) และล้าง cache ของ Laravel เมื่อแก้ไข เพื่อให้สลับ backend ได้ทันที
 */
export const DEFAULTS = {
  contract_notify_days: 30,
  credential_notify_days: 14,
  license_notify_days: 30,
  notify_emails: [] as string[],
  ticket_other_types: ["งานออกแบบ"],
  // หน้า "สิทธิ์การใช้งาน": key เมนู/ปุ่ม → กลุ่มที่ซ่อน, และลำดับเมนู ([] = ยังไม่ตั้งค่า — ตรงกับ PHP array ว่าง)
  ui_permissions: [] as unknown,
  menu_order: [] as unknown,
  // โลโก้ระบบ (routes/branding.ts) — null = ใช้ icon เดิม
  logo_path: null as string | null,
  logo_version: null as string | null,
};

export type Settings = typeof DEFAULTS & Record<string, unknown>;

export async function allSettings(): Promise<Settings> {
  // mysql2 แปลง JSON เป็น object ให้แล้ว
  const rows = await select<{ key: string; value: unknown }>('SELECT "key", "value" FROM app_settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function getSetting<K extends keyof typeof DEFAULTS>(key: K): Promise<(typeof DEFAULTS)[K]> {
  return ((await allSettings())[key] ?? DEFAULTS[key]) as (typeof DEFAULTS)[K];
}

export async function putSetting(key: string, value: unknown, userId: number | null): Promise<void> {
  const now = nowDb();
  await exec(
    'INSERT INTO app_settings ("key", "value", updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?) AS new ' +
      'ON DUPLICATE KEY UPDATE "value" = new."value", updated_by = new.updated_by, updated_at = new.updated_at',
    [key, JSON.stringify(value), userId, now, now],
  );
  await forgetLaravelCache("app_settings:all");
}

/** ลบ cache ที่ Laravel เก็บในตาราง cache (CACHE_STORE=database) — ไม่มีตาราง/คีย์ก็ไม่เป็นไร */
export async function forgetLaravelCache(key: string): Promise<void> {
  await exec('DELETE FROM cache WHERE "key" = ?', [`${config.laravelCachePrefix}${key}`]).catch(() => undefined);
}
