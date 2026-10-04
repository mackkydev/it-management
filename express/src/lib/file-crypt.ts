import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * เข้ารหัสไฟล์ขณะพัก (AES-256-GCM) — ใช้กับไฟล์ลายเซ็น
 * รูปแบบ: "EAMF1" + iv (12) + tag (16) + ciphertext — กุญแจ = sha256("file-v1:" + APP_KEY) (ไม่ใช้ APP_KEY ตรงๆ)
 * ห้ามเปลี่ยน APP_KEY หลังมีไฟล์แล้ว (ถอดรหัสไม่ได้)
 */
const MAGIC = Buffer.from("EAMF1");
const fileKey = () => createHash("sha256").update(Buffer.concat([Buffer.from("file-v1:"), config.appKey])).digest();

export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileKey(), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not an encrypted file");
  const iv = payload.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payload.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", fileKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(MAGIC.length + 28)), decipher.final()]);
}
