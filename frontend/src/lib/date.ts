import type { Locale } from "@/lib/prefs";

/**
 * วันที่ในระบบแสดง/กรอกเป็น dd/MM/yyyy — ภาษาไทยใช้ปี พ.ศ., อังกฤษใช้ ค.ศ.
 * API/ฐานข้อมูลรับส่ง "YYYY-MM-DD" (วันที่) และ ISO-8601 (วันเวลา) เหมือนเดิม
 */

const pad = (n: number) => String(n).padStart(2, "0");
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ปีที่แสดงต่างจาก ค.ศ. เท่าไร (th = พ.ศ.) */
export const yearOffset = (locale: Locale) => (locale === "th" ? 543 : 0);

/**
 * "YYYY-MM-DD" ของวันนี้ตามเวลาเครื่องผู้ใช้ — ห้ามใช้ toISOString().slice(0, 10) ซึ่งเป็นวันที่ UTC
 * (ผู้ใช้ในไทยช่วง 00:00–07:00 จะได้วันของเมื่อวาน)
 */
export function localToday(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * dd/MM/yyyy — "YYYY-MM-DD" แปลงตรงๆ (ไม่ผ่าน timezone จึงไม่เลื่อนวัน),
 * วันเวลา ISO ใช้วันที่ตามเวลาท้องถิ่นของเครื่องที่แสดงผล
 */
export function formatDate(value: string, locale: Locale): string {
  const m = DATE_ONLY.exec(value);
  if (m) return `${m[3]}/${m[2]}/${Number(m[1]) + yearOffset(locale)}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + yearOffset(locale)}`;
}

/** dd/MM/yyyy HH:mm (24 ชม.) */
export function formatDateTime(value: string, locale: Locale): string {
  const d = new Date(value);
  if (DATE_ONLY.test(value) || Number.isNaN(d.getTime())) return formatDate(value, locale);
  return `${formatDate(value, locale)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "dd/MM/yyyy" (ปีตามภาษา) → "YYYY-MM-DD" หรือ null ถ้าไม่ครบ/ไม่มีวันนั้นจริง */
export function parseDisplayDate(text: string, locale: Locale): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]) - yearOffset(locale);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "YYYY-MM-DD" + n วัน/ปี (สำหรับคำนวณวันหมดอายุ) */
export function addToIsoDate(iso: string, { years = 0, days = 0 }: { years?: number; days?: number }): string {
  const m = DATE_ONLY.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]) + years, Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
