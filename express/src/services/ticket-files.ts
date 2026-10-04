import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { notFound, ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import type { UploadedFile } from "../lib/uploaded-file.js";
import { mimeFromPath } from "../lib/uploaded-file.js";

/**
 * ไฟล์ของใบแจ้งงานใน private disk ชุดเดียวกับ Laravel (storage/app/private) — path ใน DB เป็น relative
 * ไม่เข้าถึงผ่าน URL ตรง ต้องผ่าน API ที่ตรวจสิทธิ์
 */
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Str::random(n) */
export function randomString(n: number): string {
  let out = "";
  while (out.length < n) {
    for (const b of randomBytes(n * 2)) {
      if (b < 248 && out.length < n) out += ALNUM[b % 62];
    }
  }
  return out;
}

/** แปลง path ใน DB เป็น path จริง — กัน path traversal ออกนอกโฟลเดอร์ */
function absolute(relative: string): string {
  const full = path.resolve(config.filesRoot, relative);
  if (full !== config.filesRoot && !full.startsWith(config.filesRoot + path.sep)) throw notFound();
  return full;
}

async function put(relative: string, data: Buffer): Promise<void> {
  const full = absolute(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

/** เขียน / อ่านไฟล์ใน private storage (path relative — กัน traversal) */
export const writeStored = put;
export async function readStoredBuffer(relative: string): Promise<Buffer | null> {
  const full = absolute(relative);
  return (await stat(full).catch(() => null))?.isFile() ? readFile(full) : null;
}

/** รูป/เอกสาร: ตั้งชื่อสุ่ม ไม่ใช้ชื่อไฟล์จากผู้ใช้เป็น path */
export async function storeUpload(ticketUuid: string, file: UploadedFile, folder: string) {
  return storeUploadIn(`tickets/${ticketUuid}/${folder}`, file);
}

/** เก็บไฟล์อัปโหลดในโฟลเดอร์ (relative) ด้วยชื่อสุ่ม + นามสกุลจากเนื้อไฟล์ */
export async function storeUploadIn(dir: string, file: UploadedFile) {
  const ext = (file.guessExtension() ?? "jpg").toLowerCase();
  const relative = `${dir}/${randomString(32)}.${ext}`;
  await put(relative, file.buffer);
  return {
    path: relative,
    original_name: [...file.originalName].slice(0, 200).join(""),
    mime: file.mime,
    size: file.size,
  };
}

/** ลายเซ็นจาก canvas (data URL PNG) → ไฟล์ PNG — ตรวจรูปแบบ, ขนาด ≤ 300KB และ header PNG จริง */
export async function storeSignature(ticketUuid: string, dataUrl: string, who: string, locale: Locale, field = "signature"): Promise<string> {
  const invalid = () => ValidationError.withMessages({ [field]: trans(locale, "eam.ticket.signature_invalid") });
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m || !isStrictBase64(m[1])) throw invalid();
  const binary = Buffer.from(m[1], "base64");
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (binary.length > 300 * 1024 || !binary.subarray(0, 8).equals(PNG)) throw invalid();

  const relative = `tickets/${ticketUuid}/signatures/${who}-${randomString(16)}.png`;
  await put(relative, binary);
  return relative;
}

/**
 * เหมือน base64_decode($s, true) ของ PHP: "=" อยู่ท้ายเท่านั้น (≤ 2 ตัว), มี padding แล้วความยาวรวมต้องหาร 4 ลงตัว,
 * ไม่มี padding ได้ถ้าความยาวไม่เหลือเศษ 1 — Buffer.from() ของ Node ยอมรับค่าที่ผิดรูปแบบ จึงต้องตรวจเอง
 */
export function isStrictBase64(s: string): boolean {
  const m = /^([A-Za-z0-9+/]*)(={0,2})$/.exec(s);
  if (!m) return false;
  const [, body, pad] = m;
  if (body.length % 4 === 1) return false;
  return pad.length === 0 || (body.length + pad.length) % 4 === 0;
}



/** ลบไฟล์ทั้งหมดของใบงาน (ตอนลบใบงาน) */
export async function deleteTicketFiles(ticketUuid: string): Promise<void> {
  await rm(absolute(`tickets/${ticketUuid}`), { recursive: true, force: true });
}

export async function deleteStored(relative: string | null): Promise<void> {
  if (relative) await rm(absolute(relative), { force: true });
}

/** อ่านไฟล์เพื่อส่งกลับ (404 ถ้าไม่มี) */
export async function readStored(relative: string): Promise<{ data: Buffer; mime: string; name: string }> {
  const full = absolute(relative);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw notFound();
  return { data: await readFile(full), mime: mimeFromPath(full), name: path.basename(full) };
}
