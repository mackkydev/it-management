"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { MeetingRoomIcon, UsersIcon } from "@/components/icons";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { BookingDialog } from "../../booking-dialog";
import { fromMin, imageUrl, primaryImage, timelineHours, toMin, toneOf } from "../../meeting-utils";

const noopSubscribe = () => () => {};
const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * ไทม์ไลน์การจองของวัน — แถวละ 1 ห้อง, แถบยาวตามช่วงเวลา (ค่าตั้งต้น 08:00–18:00 ขยายตามการจอง)
 * คลิกช่องว่างในแถว = จองห้องนั้นที่เวลานั้น (ปัดลงทีละ 30 นาที), คลิกแถบ = รายละเอียด
 */
export function DayTimeline({ date, rooms, bookings, bookable = true }: { date: string; rooms: MeetingRoom[]; bookings: MeetingBooking[]; bookable?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<MeetingBooking | null>(null);
  const [hover, setHover] = useState<{ room: number; min: number } | null>(null);
  const [from, to] = timelineHours(bookings);
  const span = (to - from) * 60;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const pct = (min: number) => ((min - from * 60) / span) * 100;
  const today = localToday();
  // วันที่ผ่านไปแล้ว / ซ่อนปุ่มจองไว้ (หน้าสิทธิ์การใช้งาน) = คลิกช่องว่างจองไม่ได้
  const past = date < today || !bookable;
  // เวลาปัจจุบัน (นาที) อ่านฝั่ง client เท่านั้น — server = -1 (ไม่แสดงเส้นเวลา) กัน hydration ไม่ตรงกัน
  const nowMin = useSyncExternalStore(noopSubscribe, minutesNow, () => -1);
  const showNow = date === today && nowMin >= from * 60 && nowMin <= to * 60;

  /** ตำแหน่งเมาส์ในแถว → เวลา (ปัดลง 30 นาที) */
  const slotAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const min = from * 60 + ((e.clientX - r.left) / r.width) * span;
    return Math.min(to * 60 - 30, Math.max(from * 60, Math.floor(min / 30) * 30));
  };
  const busy = (roomId: number, min: number) => bookings.some((b) => b.room.id === roomId && toMin(b.start_time) < min + 30 && toMin(b.end_time) > min);
  const canBook = (min: number) => !past && !(date === today && min + 30 <= nowMin);
  const book = (roomId: number, min: number) =>
    router.push(`/meeting-rooms/book?${new URLSearchParams({ date, room: String(roomId), start: fromMin(min), end: fromMin(Math.min(min + 60, to * 60)) })}`);

  const roomHead = (r: MeetingRoom) => {
    const img = primaryImage(r);
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
          <img src={imageUrl(r.id, img.id)} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover ring-1 ring-line" />
        ) : (
          <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-subtle text-faint ring-1 ring-line">
            <MeetingRoomIcon width={18} height={18} />
          </span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className={`h-2 w-2 shrink-0 rounded-full ${toneOf(rooms, r.id).dot}`} aria-hidden="true" />
            <span className="truncate">{r.name}</span>
          </p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <UsersIcon width={12} height={12} />
            {t("meeting.seats", { n: r.capacity })}
            {r.room_no && ` · ${r.room_no}`}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* จอใหญ่: ไทม์ไลน์ */}
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="grid grid-cols-[14rem_1fr] border-b border-line bg-subtle text-xs text-muted">
          <div className="px-3 py-2 font-medium">{t("meeting.roomsTotal", { n: rooms.length })}</div>
          <div className="relative h-8">
            {hours.map((h) => (
              <span key={h} className="absolute top-2 -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${pct(h * 60)}%` }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        {rooms.map((r) => {
          const list = bookings.filter((b) => b.room.id === r.id);
          return (
            <div key={r.id} className="grid grid-cols-[14rem_1fr] border-b border-line last:border-b-0">
              <div className="border-r border-line px-3 py-2.5">{roomHead(r)}</div>
              <div
                className={`relative h-16 ${past ? "bg-subtle/40" : "cursor-pointer"}`}
                onMouseMove={(e) => setHover({ room: r.id, min: slotAt(e) })}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  const min = slotAt(e);
                  if (canBook(min) && !busy(r.id, min)) book(r.id, min);
                }}
              >
                {/* เส้นชั่วโมง */}
                {hours.slice(1, -1).map((h) => (
                  <span key={h} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${pct(h * 60)}%` }} aria-hidden="true" />
                ))}
                {/* ช่องว่างที่เมาส์ชี้ = จองได้ */}
                {hover?.room === r.id && canBook(hover.min) && !busy(r.id, hover.min) && (
                  <span
                    className="pointer-events-none absolute inset-y-2 flex items-center justify-center rounded-md border border-dashed border-accent-300 bg-accent-50 text-[11px] font-medium text-accent-700 dark:border-accent-400/50 dark:bg-accent-400/10 dark:text-accent-200"
                    style={{ left: `${pct(hover.min)}%`, width: `${(30 / span) * 100}%` }}
                  >
                    +
                  </span>
                )}
                {list.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={(e) => (e.stopPropagation(), setSelected(b))}
                      onMouseMove={(e) => e.stopPropagation()}
                      className={`absolute inset-y-2 z-10 cursor-pointer overflow-hidden rounded-md px-2 text-left ring-1 ring-inset ${toneOf(rooms, r.id).bar}`}
                      style={{ left: `${pct(toMin(b.start_time))}%`, width: `${((toMin(b.end_time) - toMin(b.start_time)) / span) * 100}%` }}
                    >
                      <span className="block truncate text-xs font-semibold leading-5">{b.title}</span>
                      <span className="block truncate text-[11px] leading-4 opacity-80">
                        {b.start_time}–{b.end_time} · {b.user.name}
                      </span>
                    </button>
                ))}
                {showNow && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-danger-400" style={{ left: `${pct(nowMin)}%` }} aria-hidden="true" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* จอเล็ก: การ์ดต่อห้อง */}
      <div className="space-y-3 md:hidden">
        {rooms.map((r) => {
          const list = bookings.filter((b) => b.room.id === r.id);
          return (
            <div key={r.id} className={`space-y-2 p-3 ${card}`}>
              {roomHead(r)}
              {list.length === 0 ? (
                <p className="text-xs text-muted">{t("meeting.free")}</p>
              ) : (
                list.map((b) => (
                  <button key={b.id} type="button" onClick={() => setSelected(b)} className={`block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left ring-1 ring-inset ${toneOf(rooms, r.id).bar}`}>
                    <span className="block text-xs font-semibold">{b.start_time}–{b.end_time} · {b.title}</span>
                    <span className="block text-[11px] opacity-80">{b.user.name}</span>
                  </button>
                ))
              )}
              {!past && (
                <Link href={`/meeting-rooms/book?${new URLSearchParams({ date, room: String(r.id) })}`} className="inline-flex cursor-pointer text-xs font-medium text-accent-600 dark:text-accent-300">
                  + {t("meeting.book")}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {selected && <BookingDialog booking={selected} tone={toneOf(rooms, selected.room.id)} onClose={() => setSelected(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
