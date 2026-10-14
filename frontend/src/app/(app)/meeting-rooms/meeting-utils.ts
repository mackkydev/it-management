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

export const imageUrl = (roomId: number, imageId: number) => `/files/meeting-rooms/${roomId}/images/${imageId}`;
