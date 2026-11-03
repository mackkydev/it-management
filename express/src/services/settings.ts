import { config } from "../config.js";
import { exec, select } from "../db.js";
import { cached, forgetCached } from "../lib/request-cache.js";
import { nowDb } from "../lib/time.js";

/**
 * ตั้งค่าระบบ key-value (ตาราง app_settings, value เป็น JSONB) — เหมือน App\Models\AppSetting
 * อ่านจาก DB ครั้งเดียวต่อ request (lib/request-cache.ts — ไม่มีค่าค้างข้าม request) และล้าง cache ของ Laravel เมื่อแก้ไข
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
  // ชื่อเมนูที่แก้เอง { "<group id | /href>": { th, en } } — ไม่มี = ใช้ชื่อตั้งต้นจากไฟล์แปลของหน้าเว็บ
  menu_labels: [] as unknown,
  /** เมนูเฉพาะสาขา { "/href": [branchId, ...] } — ไม่มี key = ทุกสาขา */
  menu_branches: [] as unknown,
  // โลโก้ระบบ (routes/branding.ts) — null = ใช้ icon เดิม
  logo_path: null as string | null,
  logo_version: null as string | null,
  // การป้องกันตอนเปิดดูรหัสผ่าน / License key (services/secret-guard.ts) — null = ค่าเริ่มต้น
  secret_guard: null as unknown,
  // ค่าเดิมก่อนมีรายกลุ่ม (true = super_admin + admin) — อ่านอย่างเดียวเมื่อยังไม่ตั้ง two_factor_groups
  two_factor_required: false as unknown,
  // กลุ่มที่บังคับใช้ 2FA (key กลุ่มสิทธิ์) — services/two-factor.ts
  two_factor_groups: null as unknown,
  // PIN กลางสำหรับเปิดดูข้อมูลลับ { hash, set_at, set_by } — ห้ามส่ง hash ออกนอก API (routes/it-data.ts ตัดออก)
  secret_pin: null as unknown,
  // นโยบายรหัสผ่าน: ล็อกบัญชีเมื่อ login ผิด + บังคับเปลี่ยนรหัสผ่านทุก N วัน (services/password-policy.ts) — null = ค่าเริ่มต้น
  password_policy: null as unknown,
  // ปฏิทิน: ขอบเขตการมองเห็นต่อกลุ่ม { group_key: "all" | "branch" | "department" } และตั้งค่าการลา (services/calendar.ts)
  calendar_scope: null as unknown,
  // ขอบเขตการมองเห็นวันลาของคนอื่นต่อกลุ่ม (ตั้งแยกจากปฏิทิน) { group_key: "self" | "department" | "branch" | "all" }
  leave_scope: null as unknown,
  leave_settings: null as unknown,
  // ห้องประชุม/รถตามสาขา ต่อกลุ่ม { meeting: { group_key: "branch" | "all" }, vehicle: { … } } (services/booking-scope.ts)
  booking_scope: null as unknown,
  // ขอบเขตการจัดการตามสาขา ต่อกลุ่ม { group_key: "all" | "branch" } (services/manage-scope.ts) — ไม่ตั้ง = ทุกสาขา
  manage_scope: null as unknown,
  // บังคับให้มีลายเซ็นในโปรไฟล์ก่อนบันทึก/อนุมัติเอกสาร (ใบแจ้งงาน / ใบลา) — services/signatures.ts requireSignature
  require_signature: false as unknown,
  // นโยบายของระบบที่ผู้ใช้ต้องยอมรับก่อนใช้งาน { enabled, version, sections: [{ title, body }], updated_at } (services/system-policy.ts)
  system_policy: null as unknown,
  // ใบแจ้งงาน: ผู้แจ้งไม่กดรับงาน (รอผู้แจ้งรับงาน) เกินกี่วัน ระบบปิดงานให้อัตโนมัติ — 0 = ปิดความสามารถนี้ (routes/tickets.ts autoCloseTickets)
  ticket_auto_close_days: 7 as unknown,
  // ขั้นตอนใบแจ้งงาน: approval_first = หัวหน้าอนุมัติก่อนถึงฝ่าย IT (แบบเดิม) / it_first = ส่งถึงฝ่าย IT ทันที แล้ว IT ขอให้หัวหน้าอนุมัติเมื่อจำเป็น
  ticket_flow: "approval_first" as unknown,
};

export type Settings = typeof DEFAULTS & Record<string, unknown>;

export async function allSettings(): Promise<Settings> {
  return cached("settings:all", async () => {
    // mysql2 แปลง JSON เป็น object ให้แล้ว
    const rows = await select<{ key: string; value: unknown }>('SELECT "key", "value" FROM app_settings');
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULTS, ...stored } as Settings;
  });
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
  forgetCached("settings:");
  await forgetLaravelCache("app_settings:all");
}

/** ลบ cache ที่ Laravel เก็บในตาราง cache (CACHE_STORE=database) — ไม่มีตาราง/คีย์ก็ไม่เป็นไร */
export async function forgetLaravelCache(key: string): Promise<void> {
  await exec('DELETE FROM cache WHERE "key" = ?', [`${config.laravelCachePrefix}${key}`]).catch(() => undefined);
}
