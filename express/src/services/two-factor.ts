import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { config } from "../config.js";
import { exec, update } from "../db.js";
import { decryptString, encryptString } from "../lib/laravel-crypt.js";
import { nowDb } from "../lib/time.js";
import type { UserRow } from "../models/user.js";
import { getSetting } from "./settings.js";

/**
 * ยืนยันตัวตน 2 ขั้น (2FA) แบบ TOTP (RFC 6238: HMAC-SHA1, 30 วินาที, 6 หลัก) — ใช้กับแอป Google / Microsoft Authenticator ฯลฯ
 * - เฉพาะผู้ใช้ LOCAL (API User ยืนยันตัวตนที่ระบบต้นทาง)
 * - secret เก็บเข้ารหัสด้วย APP_KEY (users.two_factor_secret) — ยืนยันรหัสแรกแล้วจึงมีผล (two_factor_confirmed_at)
 * - รับรหัสช่วงเวลาก่อน/หลัง 1 ช่วง (นาฬิกาคลาดเคลื่อน) และห้ามใช้รหัสช่วงเดิมซ้ำ (two_factor_last_step)
 * - recovery codes 8 ชุด (ใช้ได้ครั้งเดียว) เก็บเป็น SHA-256 — แสดงให้ผู้ใช้ครั้งเดียวตอนสร้าง
 * - บังคับใช้กับผู้ดูแลระบบ (super_admin / admin บัญชี LOCAL) เมื่อเปิด app_settings.two_factor_required
 */

const PERIOD = 30;
const DIGITS = 6;
const ISSUER = "IT-SYSTEM";
const RECOVERY_COUNT = 8;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** รหัส 6 หลักของช่วงเวลา step (HOTP ตาม RFC 4226) */
export function totpAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD);

/** ตรวจรหัส (ช่วงปัจจุบัน ±1) — คืนช่วงเวลาที่ตรง หรือ null; รหัสช่วงที่ ≤ lastStep ใช้ซ้ำไม่ได้ */
export function matchTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretB32);
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(clean))) return s;
  }
  return null;
}

export const newSecret = () => base32Encode(randomBytes(20));
export const otpauthUri = (account: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(`${ISSUER}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
export const qrSvg = (uri: string) => QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

/* ---------------------------------------------------------------- recovery codes */

const hashCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

/** สร้าง recovery codes ใหม่ (แทนชุดเดิม) — คืนรหัสจริงให้แสดงครั้งเดียว */
export async function issueRecoveryCodes(userId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await update("users", { two_factor_recovery_codes: JSON.stringify(codes.map(hashCode)), updated_at: nowDb() }, "id = ?", [userId]);
  return codes;
}

export function recoveryCodesLeft(u: UserRow): number {
  try {
    const list = JSON.parse(u.two_factor_recovery_codes ?? "[]") as unknown;
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

/** ใช้ recovery code (ตรงแล้วลบออกจากรายการ) */
export async function consumeRecoveryCode(u: UserRow, code: string): Promise<boolean> {
  let list: string[] = [];
  try {
    list = JSON.parse(u.two_factor_recovery_codes ?? "[]") as string[];
  } catch {
    return false;
  }
  const h = hashCode(code);
  if (!list.includes(h)) return false;
  await update("users", { two_factor_recovery_codes: JSON.stringify(list.filter((x) => x !== h)), updated_at: nowDb() }, "id = ?", [u.id]);
  return true;
}

/* ---------------------------------------------------------------- สถานะของผู้ใช้ */

export const twoFactorEnabled = (u: UserRow) => Boolean(u.two_factor_confirmed_at);
export const decryptSecret = (u: UserRow) => (u.two_factor_secret ? decryptString(u.two_factor_secret) : null);

/** ตรวจรหัสจากแอปของผู้ใช้ (secret ที่บันทึกไว้) แล้วจำช่วงเวลาที่ใช้ — ผ่าน = true */
export async function verifyUserTotp(u: UserRow, code: string): Promise<boolean> {
  const secret = decryptSecret(u);
  if (!secret) return false;
  const step = matchTotp(secret, code, u.two_factor_last_step === null || u.two_factor_last_step === undefined ? null : Number(u.two_factor_last_step));
  if (step === null) return false;
  await exec("UPDATE users SET two_factor_last_step = ? WHERE id = ?", [step, u.id]);
  return true;
}

/** เริ่มตั้ง 2FA: secret ใหม่ (ยังไม่มีผลจนยืนยันรหัสแรก) — คืน secret + QR */
export async function startSetup(u: UserRow) {
  const secret = newSecret();
  await update("users", { two_factor_secret: encryptString(secret), two_factor_confirmed_at: null, two_factor_last_step: null, updated_at: nowDb() }, "id = ?", [u.id]);
  const uri = otpauthUri(u.email ?? u.username ?? `user-${u.id}`, secret);
  return { secret, otpauth_uri: uri, qr_svg: await qrSvg(uri) };
}

/** ยืนยันรหัสแรก → เปิดใช้ 2FA + recovery codes ชุดใหม่ */
export async function confirmSetup(u: UserRow, code: string): Promise<string[] | null> {
  if (!(await verifyUserTotp(u, code))) return null;
  await update("users", { two_factor_confirmed_at: nowDb(), updated_at: nowDb() }, "id = ?", [u.id]);
  return issueRecoveryCodes(u.id);
}

export async function disableTwoFactor(userId: number): Promise<void> {
  await update(
    "users",
    { two_factor_secret: null, two_factor_confirmed_at: null, two_factor_recovery_codes: null, two_factor_last_step: null, updated_at: nowDb() },
    "id = ?",
    [userId],
  );
}

/** บังคับ 2FA กับผู้ใช้นี้ไหม (สวิตช์ two_factor_required + ผู้ดูแลระบบบัญชี LOCAL) */
export async function twoFactorRequiredFor(u: UserRow): Promise<boolean> {
  if (u.type !== "LOCAL" || !["super_admin", "admin"].includes(u.role)) return false;
  return (await getSetting("two_factor_required")) === true;
}

/* ---------------------------------------------------------------- challenge ระหว่าง login 2 ขั้น */

export type ChallengePurpose = "verify" | "setup";
const CHALLENGE_MINUTES = 5;

/** ใบผ่านชั่วคราว (5 นาที) หลังรหัสผ่านถูก — ลงลายมือด้วย APP_KEY ผูกกับรหัสผ่านปัจจุบัน (เปลี่ยนรหัส = ใช้ไม่ได้) */
export function signChallenge(u: UserRow, purpose: ChallengePurpose, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: u.id, p: purpose, e: now + CHALLENGE_MINUTES * 60_000 })).toString("base64url");
  return `${payload}.${challengeSig(payload, u)}`;
}

const challengeSig = (payload: string, u: UserRow) =>
  createHmac("sha256", config.appKey).update(`2fa|${payload}|${(u.password ?? "").slice(-16)}`).digest("base64url");

export function readChallenge(token: string): { userId: number; purpose: ChallengePurpose; expires: number } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: number; p: ChallengePurpose; e: number };
    if (!Number.isInteger(data.u) || !["verify", "setup"].includes(data.p) || !(data.e > Date.now())) return null;
    return { userId: data.u, purpose: data.p, expires: data.e };
  } catch {
    return null;
  }
}

/** ลายมือถูกต้องกับผู้ใช้คนนั้น (เรียกหลังโหลดผู้ใช้จาก readChallenge) */
export function challengeValid(token: string, u: UserRow): boolean {
  const [payload, sig] = token.split(".");
  const expected = challengeSig(payload, u);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
