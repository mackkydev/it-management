/** ส่วนกลางของระบบจอง (ห้องประชุม / รถ): สีประจำทรัพยากร, เวลา "HH:MM", รูปหลัก, เลื่อนวัน */

/** สีประจำห้อง/รถ (ตามลำดับ) — token สถานะ/ธีม เปลี่ยนตามธีมและโหมดมืดอัตโนมัติ */
const TONES = [
  { bar: "bg-info-100 text-info-800 ring-info-300 dark:bg-info-400/20 dark:text-info-200 dark:ring-info-400/40", dot: "bg-info-400" },
  { bar: "bg-success-100 text-success-800 ring-success-300 dark:bg-success-400/20 dark:text-success-200 dark:ring-success-400/40", dot: "bg-success-400" },
  { bar: "bg-warning-100 text-warning-800 ring-warning-300 dark:bg-warning-400/20 dark:text-warning-200 dark:ring-warning-400/40", dot: "bg-warning-400" },
  { bar: "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/20 dark:text-accent-200 dark:ring-accent-400/40", dot: "bg-accent-400" },
  { bar: "bg-danger-100 text-danger-800 ring-danger-300 dark:bg-danger-400/20 dark:text-danger-200 dark:ring-danger-400/40", dot: "bg-danger-400" },
  { bar: "bg-idle-100 text-idle-700 ring-idle-300 dark:bg-idle-400/20 dark:text-idle-200 dark:ring-idle-400/40", dot: "bg-idle-400" },
] as const;
export type Tone = (typeof TONES)[number];
/** สีของรายการที่ไม่อยู่ในลิสต์ (เช่น ปิดใช้งานแล้ว / ยังไม่ระบุรถ) */
export const IDLE_TONE: Tone = TONES[5];

export function toneOf(list: { id: number }[], id: number | null | undefined): Tone {
  const i = id == null ? -1 : list.findIndex((r) => r.id === id);
  return i < 0 ? IDLE_TONE : TONES[i % TONES.length];
}

/** "HH:MM" ↔ นาทีตั้งแต่เที่ยงคืน */
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const primaryImage = (item: { images: { id: number; is_primary: boolean }[] }) => item.images.find((i) => i.is_primary) ?? item.images[0] ?? null;

/** วันก่อน / ถัดไป ("YYYY-MM-DD") */
export function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
