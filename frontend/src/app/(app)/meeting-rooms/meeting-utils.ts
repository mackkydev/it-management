import { fromMin, toMin } from "@/lib/booking";

export { fromMin, primaryImage, shiftDay, toMin, toneOf, type Tone as RoomTone } from "@/lib/booking";

/** ตัวเลือกเวลา ทุก 30 นาที 06:00–22:00 */
export const TIME_OPTIONS: string[] = Array.from({ length: (22 - 6) * 2 + 1 }, (_, i) => fromMin(6 * 60 + i * 30));

/** ช่วงชั่วโมงของไทม์ไลน์: 08:00–18:00 ขยายให้ครอบการจองที่อยู่นอกช่วง */
export function timelineHours(times: { start_time: string; end_time: string }[]): [number, number] {
  let from = 8;
  let to = 18;
  for (const b of times) {
    from = Math.min(from, Math.floor(toMin(b.start_time) / 60));
    to = Math.max(to, Math.ceil(toMin(b.end_time) / 60));
  }
  return [from, to];
}

/** เวลาเปิด-ปิดที่ใช้แสดงวันกลาง/ต้นวัน/สิ้นวันของการจองต่อเนื่องหลายวัน */
export const DAY_OPEN = "08:00";
export const DAY_CLOSE = "22:00";

type Span = { date: string; end_date?: string | null; start_time: string; end_time: string };

/**
 * ช่วงเวลาของการจองในวันนั้น — จองต่อเนื่องหลายวัน: วันแรกตั้งแต่เวลาเริ่มถึงสิ้นวัน, วันกลางทั้งวัน, วันสุดท้ายตั้งแต่ต้นวันถึงเวลาสิ้นสุด
 * (ต้นวัน/สิ้นวันแสดงที่ DAY_OPEN / DAY_CLOSE — ถ้าเวลาของการจองอยู่นอกช่วงนี้จะขยายตามเวลานั้น)
 */
export function slotOn(b: Span, day: string): { start_time: string; end_time: string } {
  const last = b.end_date || b.date;
  const first = day <= b.date;
  const final = day >= last;
  let start = first ? b.start_time : DAY_OPEN;
  let end = final ? b.end_time : DAY_CLOSE;
  if (!first && final && end <= start) start = "00:00";
  if (first && !final && start >= end) end = "24:00";
  return { start_time: start, end_time: end };
}

/** วันเวลาเริ่ม / สิ้นสุดแบบต่อเนื่อง ("YYYY-MM-DD HH:MM") ใช้เทียบการชน */
export const startAt = (b: Span) => `${b.date} ${b.start_time}`;
export const endAt = (b: Span) => `${b.end_date || b.date} ${b.end_time}`;
export const overlaps = (a: Span, b: Span) => startAt(a) < endAt(b) && endAt(a) > startAt(b);

export const imageUrl = (roomId: number, imageId: number) => `/files/meeting-rooms/${roomId}/images/${imageId}`;
