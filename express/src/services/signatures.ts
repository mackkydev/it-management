import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { exec, first, insert, transaction } from "../db.js";
import { decryptBuffer, encryptBuffer } from "../lib/file-crypt.js";
import { nowDb } from "../lib/time.js";
import { audit, type AuditActor } from "./audit.js";
import { randomString, readStoredBuffer, writeStored } from "./ticket-files.js";

/**
 * ลายเซ็นของผู้ใช้ (ตาราง user_signatures) — อยู่ในระบบเราเท่านั้น ไม่เรียก/แก้อะไรที่ระบบต้นทาง
 * - รับ 2 ทาง (อัปโหลด PNG/JPG หรือวาดบน canvas เป็น PNG) แล้วประมวลผลเหมือนกัน:
 *   ตรวจชนิดจากเนื้อไฟล์ → decode → crop ขอบว่าง → ย่อกว้าง ≤ 600px → re-encode PNG ใหม่ (ล้าง metadata) → ชื่อไฟล์ UUID
 * - เก็บเข้ารหัสขณะพัก (lib/file-crypt) ใน storage/private/signatures/{user}/ — ไม่มี URL สาธารณะ
 * - ลายเซ็นใหม่ทำให้อันเดิม is_active = false (ไม่ลบแถว/ไฟล์ = เก็บประวัติ)
 * - ทุกการอัปโหลด / เปลี่ยน / ลบ / นำไปใช้ บันทึก audit_logs (ไม่มีเนื้อไฟล์)
 */

export const MAX_BYTES = 1024 * 1024;
export const MAX_WIDTH = 600;
export type SignatureSource = "UPLOAD" | "DRAW";

export interface SignatureRow {
  id: number;
  user_id: number;
  file_ref: string;
  mime_type: string;
  size: number;
  source: SignatureSource;
  is_active: boolean;
  is_encrypted: boolean;
  created_at: string;
  created_by: number | null;
}

/** เหตุที่รับไฟล์ไม่ได้ (ข้อความแปลอยู่ที่ route) */
export class SignatureError extends Error {
  constructor(public readonly reason: "type" | "size" | "empty" | "decode") {
    super(`signature ${reason}`);
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff]);

/** ตรวจชนิดจากเนื้อไฟล์ (ไม่เชื่อชื่อไฟล์ / MIME ที่ client ส่งมา) */
export function sniff(buf: Buffer): "png" | "jpg" | null {
  if (buf.subarray(0, 8).equals(PNG)) return "png";
  if (buf.subarray(0, 3).equals(JPG)) return "jpg";
  return null;
}

/** decode → crop ขอบว่าง → ย่อ → PNG ใหม่ (sharp ไม่คัดลอก metadata ถ้าไม่สั่ง withMetadata) */
export async function processSignature(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_BYTES) throw new SignatureError("size");
  if (!sniff(input)) throw new SignatureError("type");
  let trimmed: Buffer;
  try {
    // ภาพสีเดียวทั้งภาพ (เช่น canvas ว่าง / กระดาษเปล่า) = ไม่มีลายเส้น
    const stats = await sharp(input, { limitInputPixels: 24_000_000 }).ensureAlpha().stats();
    const transparent = stats.channels[3]?.max === 0;
    if (transparent || stats.channels.every((c) => c.min === c.max)) throw new SignatureError("empty");
    // limitInputPixels กันไฟล์ระเบิด (decompression bomb)
    trimmed = await sharp(input, { limitInputPixels: 24_000_000 }).rotate().ensureAlpha().trim({ threshold: 10 }).png().toBuffer();
  } catch (e) {
    if (e instanceof SignatureError) throw e;
    // trim ทั้งภาพเป็นสีเดียว (ไม่มีลายเส้น)
    if (String((e as Error).message).toLowerCase().includes("bad extract area")) throw new SignatureError("empty");
    throw new SignatureError("decode");
  }
  const meta = await sharp(trimmed).metadata();
  if (!meta.width || !meta.height || meta.width < 2 || meta.height < 2) throw new SignatureError("empty");
  return sharp(trimmed).resize({ width: MAX_WIDTH, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

export const activeSignature = (userId: number) =>
  first<SignatureRow>("SELECT * FROM user_signatures WHERE user_id = ? AND is_active = true ORDER BY id DESC LIMIT 1", [userId]);

/** อ่านไฟล์ลายเซ็น (ถอดรหัสให้) — ไม่พบไฟล์ = null */
export async function readSignature(row: SignatureRow): Promise<Buffer | null> {
  const raw = await readStoredBuffer(row.file_ref);
  if (!raw) return null;
  return row.is_encrypted ? decryptBuffer(raw) : raw;
}

/** บันทึกลายเซ็นใหม่ของผู้ใช้ (แทนอันเดิม) */
export async function saveSignature(userId: number, input: Buffer, source: SignatureSource, actor: AuditActor): Promise<SignatureRow> {
  const png = await processSignature(input);
  const fileRef = `signatures/${userId}/${randomUUID()}.png.enc`;
  await writeStored(fileRef, encryptBuffer(png));

  const previous = await activeSignature(userId);
  const id = await transaction(async () => {
    await exec("UPDATE user_signatures SET is_active = false WHERE user_id = ? AND is_active = true", [userId]);
    return insert("user_signatures", {
      user_id: userId,
      file_ref: fileRef,
      mime_type: "image/png",
      size: png.length,
      source,
      is_active: true,
      is_encrypted: true,
      created_at: nowDb(),
      created_by: actor.user?.id ?? null,
    });
  });
  await audit(actor, {
    action: previous ? "signature.changed" : "signature.uploaded",
    subjectType: "user",
    subjectId: userId,
    before: previous ? { signature_id: previous.id } : undefined,
    after: { signature_id: id, source, size: png.length },
  });
  return (await first<SignatureRow>("SELECT * FROM user_signatures WHERE id = ?", [id]))!;
}

/** ลบ (ปิดใช้งาน) ลายเซ็นปัจจุบัน — แถวและไฟล์ยังอยู่เป็นประวัติ; byAdmin = Local Admin ลบให้ผู้ใช้ */
export async function deactivateSignature(userId: number, actor: AuditActor, byAdmin = false): Promise<boolean> {
  const current = await activeSignature(userId);
  if (!current) return false;
  await exec("UPDATE user_signatures SET is_active = false WHERE id = ?", [current.id]);
  await audit(actor, { action: byAdmin ? "signature.deleted_by_admin" : "signature.deleted", subjectType: "user", subjectId: userId, before: { signature_id: current.id } });
  return true;
}

/**
 * นำลายเซ็นไปใช้ในเอกสาร (backend ฝังให้): คัดลอกเป็นสำเนาของใบงาน — ไฟล์ต้นฉบับไม่ออกจาก backend
 * คืน path ของสำเนา (relative) หรือ null ถ้าผู้ใช้ไม่มีลายเซ็น
 */
export async function copySignatureTo(userId: number, folder: string, who: string, actor: AuditActor, context: Record<string, unknown>): Promise<string | null> {
  const row = await activeSignature(userId);
  const data = row ? await readSignature(row) : null;
  if (!row || !data) return null;
  const ext = row.mime_type === "image/jpeg" ? "jpg" : row.mime_type === "image/webp" ? "webp" : "png";
  const relative = `${folder}/${who}-${randomString(16)}.${ext}`;
  await writeStored(relative, data);
  await audit(actor, { action: "signature.used", subjectType: "user", subjectId: userId, after: { signature_id: row.id, ...context } });
  return relative;
}

export const mimeOf = (row: SignatureRow) => row.mime_type || "image/png";
