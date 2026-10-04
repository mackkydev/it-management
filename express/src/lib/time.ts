/**
 * เวลาในฐานข้อมูลเก็บเป็น UTC แบบไม่มี timezone (เหมือน Laravel ที่ตั้ง app.timezone = UTC)
 * API ส่งออกเป็น ISO-8601 รูปแบบเดียวกับ Carbon::toIso8601String() เช่น 2026-10-03T13:05:14+00:00
 */

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Date → "YYYY-MM-DD HH:mm:ss" (UTC) สำหรับเขียนลง DB */
export function toDbDateTime(d: Date = new Date()): string {
  return `${toDbDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Date → "YYYY-MM-DD" (UTC) */
export function toDbDate(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const nowDb = () => toDbDateTime(new Date());
export const todayDb = () => toDbDate(new Date());

/** ค่าจาก DB ("YYYY-MM-DD HH:mm:ss" UTC) → ISO-8601 +00:00 */
export function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const [date, time = "00:00:00"] = value.split(" ");
  return `${date}T${time.slice(0, 8)}+00:00`;
}

/** ค่าจาก DB (date หรือ datetime) → "YYYY-MM-DD" */
export function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** parse วันที่/เวลาจาก input (รูปแบบที่ strtotime ของ PHP รับ — ครอบคลุมที่ระบบใช้) */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const v = value.trim();
  if (v === "today") return startOfUtcDay(new Date());
  if (v === "now") return new Date();
  if (v === "tomorrow") return addDays(startOfUtcDay(new Date()), 1);
  if (v === "yesterday") return addDays(startOfUtcDay(new Date()), -1);
  // YYYY-MM-DD หรือ YYYY-MM-DD HH:mm[:ss] (ไม่มี timezone = UTC ตาม app timezone)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(v);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    // ปฏิเสธวันที่ไม่มีจริง เช่น 2026-02-30
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
    return date;
  }
  // ISO ที่มี timezone เช่น 2026-10-03T10:00:00+07:00 / ...Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/** จำนวนวันจาก a ถึง b (นับตามวันที่ UTC, ติดลบได้) — เหมือน diffInDays(..., false) ของ Carbon ที่ startOfDay ทั้งคู่ */
export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / 86_400_000);
}

/** "YYYY-MM-DD" → Date (UTC เที่ยงคืน) */
export function fromDbDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
