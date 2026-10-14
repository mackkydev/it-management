import { fromMin, toMin } from "@/lib/booking";
import type { VehicleBooking } from "@/lib/types";

export { primaryImage, shiftDay, toMin, toneOf } from "@/lib/booking";

/** ตัวเลือกเวลา ทุก 30 นาที 00:00–23:30 + 23:59 (ใช้ทั้งวัน) */
export const TIME_OPTIONS: string[] = [...Array.from({ length: 48 }, (_, i) => fromMin(i * 30)), "23:59"];

export const imageUrl = (vehicleId: number, imageId: number) => `/files/vehicles/${vehicleId}/images/${imageId}`;

type Span = Pick<VehicleBooking, "start_on" | "start_time" | "end_on" | "end_time">;
export const startAt = (b: Span) => `${b.start_on} ${b.start_time}`;
export const endAt = (b: Span) => `${b.end_on} ${b.end_time}`;
/** ช่วงเวลาซ้อนกัน (ต่อกันพอดีขอบไม่นับ) */
export const overlaps = (a: Span, b: Span) => startAt(a) < endAt(b) && endAt(a) > startAt(b);

/** ส่วนของการจองที่อยู่ในวันนั้น (นาที 0–1440) — การจองหลายวันตัดเป็นช่วงของแต่ละวัน */
export function segmentOf(b: Span, date: string): [number, number] {
  const from = b.start_on < date ? 0 : toMin(b.start_time);
  const to = b.end_on > date ? 24 * 60 : b.end_time === "23:59" ? 24 * 60 : toMin(b.end_time);
  return [from, to];
}

/** ข้อความช่วงเวลา: วันเดียว = "dd/MM/yyyy 08:00–17:00", หลายวัน = "dd/MM/yyyy 08:00 – dd/MM/yyyy 17:00" */
export function periodText(b: Span, date: (d: string) => string): string {
  return b.start_on === b.end_on ? `${date(b.start_on)} ${b.start_time}–${b.end_time}` : `${date(b.start_on)} ${b.start_time} – ${date(b.end_on)} ${b.end_time}`;
}

/** วันในช่วงของการจอง ("YYYY-MM-DD" ทุกวัน) */
export function daysOf(b: Span): string[] {
  const out: string[] = [];
  for (let d = new Date(`${b.start_on}T00:00:00Z`); out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10);
    if (s > b.end_on) break;
    out.push(s);
  }
  return out;
}
