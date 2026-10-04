import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { exec, first, insert } from "../db.js";
import { nowDb, toDbDateTime } from "./time.js";

/**
 * Personal access token แบบเดียวกับ Laravel Sanctum (ตาราง personal_access_tokens)
 * plain text = "{id}|{random 40 ตัว}{crc32b 8 ตัว}", เก็บใน DB เป็น sha256 ของส่วนหลัง "|"
 * → token ที่ออกโดย Laravel ใช้กับ Express ได้ และกลับกัน
 */
const USER_TYPE = "App\\Models\\User";
const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface AccessToken {
  id: number;
  userId: number;
  /** ใช้งานล่าสุดก่อน request นี้ (null = ยังไม่เคยใช้) — ใช้ตรวจ idle timeout ของ API User */
  lastUsedAt: string | null;
}

function randomString(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    // ตัด byte ที่ทำให้กระจายไม่สม่ำเสมอ (rejection sampling)
    if (bytes[i] < 248) out += ALPHANUM[bytes[i] % 62];
  }
  return out.length === length ? out : randomString(length);
}

function crc32b(s: string): string {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(s, "utf8")) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createToken(userId: number, name: string, expiresAt: Date | null): Promise<{ plainText: string; id: number }> {
  const entropy = randomString(40);
  const plain = `${entropy}${crc32b(entropy)}`;
  const now = nowDb();
  const id = await insert("personal_access_tokens", {
    tokenable_type: USER_TYPE,
    tokenable_id: userId,
    name,
    token: sha256(plain),
    abilities: JSON.stringify(["*"]),
    expires_at: expiresAt ? toDbDateTime(expiresAt) : null,
    created_at: now,
    updated_at: now,
  });
  return { plainText: `${id}|${plain}`, id };
}

/** ตรวจ Bearer token เหมือน PersonalAccessToken::findToken + Guard ของ Sanctum (หมดอายุ / ผู้ใช้) */
export async function findToken(bearer: string): Promise<AccessToken | null> {
  let row: { id: number; tokenable_id: number; token: string; expires_at: string | null; tokenable_type: string; last_used_at: string | null } | null;
  let hash: string;

  if (bearer.includes("|")) {
    const [id, plain] = bearer.split("|", 2);
    if (!/^\d+$/.test(id) || !plain) return null;
    row = await first("SELECT id, tokenable_id, tokenable_type, token, expires_at, last_used_at FROM personal_access_tokens WHERE id = ?", [Number(id)]);
    hash = sha256(plain);
    if (!row || !timingSafeEqual(Buffer.from(row.token), Buffer.from(hash))) return null;
  } else {
    hash = sha256(bearer);
    row = await first("SELECT id, tokenable_id, tokenable_type, token, expires_at, last_used_at FROM personal_access_tokens WHERE token = ?", [hash]);
    if (!row) return null;
  }

  if (row.tokenable_type !== USER_TYPE) return null;
  if (row.expires_at && new Date(`${row.expires_at.replace(" ", "T")}Z`).getTime() <= Date.now()) return null;

  await exec("UPDATE personal_access_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?", [nowDb(), nowDb(), row.id]);
  return { id: row.id, userId: row.tokenable_id, lastUsedAt: row.last_used_at };
}

export async function deleteToken(id: number): Promise<void> {
  await exec("DELETE FROM personal_access_tokens WHERE id = ?", [id]);
}

export async function deleteUserTokens(userId: number, exceptId?: number): Promise<void> {
  await exec(
    `DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?${exceptId ? " AND id <> ?" : ""}`,
    exceptId ? [USER_TYPE, userId, exceptId] : [USER_TYPE, userId],
  );
}
