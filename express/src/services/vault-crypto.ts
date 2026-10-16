import { config } from "../config.js";
import { decryptString, encryptString } from "../lib/laravel-crypt.js";

/**
 * เข้ารหัสคลังบัญชี (credentials.password / secret_notes) ด้วยกุญแจคลัง VAULT_KEY แยกจาก APP_KEY
 * — คนที่ได้ไฟล์ .env ของระบบ / ไฟล์สำรอง ไปพร้อมฐานข้อมูล ยังอ่านรหัสผ่านในคลังไม่ได้ ถ้ากุญแจคลังเก็บแยก
 * รูปแบบ payload เดียวกับ APP_KEY (AES-256-CBC + HMAC-SHA256) — อ่านด้วยกุญแจคลังก่อน ถ้า MAC ไม่ตรงจึงลอง APP_KEY (ข้อมูลเดิม)
 * ย้ายข้อมูลเดิมไปกุญแจคลัง: npm run vault:rekey (cli/vault-key.ts) — ยังไม่ตั้ง VAULT_KEY = ใช้ APP_KEY เหมือนเดิม
 */
let vaultKey: Buffer | null = config.vaultKey;

/** เทสต์เท่านั้น: เปลี่ยนกุญแจคลังชั่วคราว (null = ใช้ APP_KEY) */
export function useVaultKeyForTests(key: Buffer | null): void {
  vaultKey = key;
}

/** กุญแจที่ใช้เข้ารหัสข้อมูลใหม่ */
const currentKey = () => vaultKey ?? config.appKey;
export const vaultKeyMode = (): "vault_key" | "app_key" => (vaultKey ? "vault_key" : "app_key");

export const encryptVault = (plain: string) => encryptString(plain, currentKey());
export const encryptVaultNullable = (v: string | null | undefined) => (v === null || v === undefined ? v : encryptVault(v));

/** ถอดรหัส — คืนกุญแจที่ใช้ได้ด้วย (ใช้ตรวจว่ายังเหลือข้อมูลที่เข้ารหัสด้วย APP_KEY) */
export function decryptVaultWithKey(payload: string): { plain: string; key: "vault_key" | "app_key" } {
  if (vaultKey) {
    try {
      return { plain: decryptString(payload, vaultKey), key: "vault_key" };
    } catch {
      // ข้อมูลเดิมก่อนแยกกุญแจ → ลอง APP_KEY ด้านล่าง
    }
  }
  return { plain: decryptString(payload, config.appKey), key: "app_key" };
}

export const decryptVault = (payload: string) => decryptVaultWithKey(payload).plain;
export const decryptVaultNullable = (v: string | null) => (v === null ? null : decryptVault(v));
