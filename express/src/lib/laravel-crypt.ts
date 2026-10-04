import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * เข้ากันได้กับ Illuminate\Encryption\Encrypter (AES-256-CBC) — ใช้กับคอลัมน์ encrypted cast ของ Laravel
 * payload = base64(json{ iv: b64, value: b64(ciphertext), mac: hex(hmac_sha256(iv_b64 + value_b64, key)), tag: "" })
 * encryptString/decryptString (ไม่ serialize) ตรงกับ cast "encrypted"
 */
const CIPHER = "aes-256-cbc";

export function encryptString(plain: string, key: Buffer = config.appKey): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(CIPHER, key, iv);
  const value = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
  const ivB64 = iv.toString("base64");
  const mac = createHmac("sha256", key).update(ivB64 + value).digest("hex");
  // json_encode ของ PHP ใช้ \/ แทน / — Laravel ถอดได้ทั้งสองแบบ แต่ทำให้เหมือนกันไว้
  const json = JSON.stringify({ iv: ivB64, value, mac, tag: "" }).replaceAll("/", "\\/");
  return Buffer.from(json, "utf8").toString("base64");
}

export function decryptString(payload: string, key: Buffer = config.appKey): string {
  let data: { iv?: string; value?: string; mac?: string };
  try {
    data = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    throw new Error("The payload is invalid.");
  }
  if (!data.iv || !data.value || !data.mac) throw new Error("The payload is invalid.");

  const expected = createHmac("sha256", key).update(data.iv + data.value).digest();
  const given = Buffer.from(data.mac, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("The MAC is invalid.");

  const decipher = createDecipheriv(CIPHER, key, Buffer.from(data.iv, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data.value, "base64")), decipher.final()]).toString("utf8");
}

/** ค่า null คงเป็น null (เหมือน cast) */
export const encryptNullable = (v: string | null | undefined) => (v === null || v === undefined ? v : encryptString(v));
export const decryptNullable = (v: string | null) => (v === null ? null : decryptString(v));
