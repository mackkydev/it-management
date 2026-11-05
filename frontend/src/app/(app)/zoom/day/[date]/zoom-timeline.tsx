"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { segmentOf, zoomBarOf } from "../../zoom-utils";
import { ZoomStatusBadge } from "../../zoom-ui";

const noopSubscribe = () => () => {};
const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const SPAN = 24 * 60;
const HOURS = Array.from({ length: 13 }, (_, i) => i * 2); // ป้ายทุก 2 ชม. 00–24
const pct = (min: number) => (min / SPAN) * 100;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** ความสูงต่อช่อง / ขอบบน-ล่าง (px) */
const LANE = 48;
const LANE_PAD = 8;

/** แบ่งการจองที่ช่วงเวลาซ้อนกันเป็นช่องแนวตั้ง (เรียงตามเวลาเริ่ม — ใส่ช่องแรกที่ว่าง) */
function lanesOf(list: ZoomBooking[], date: string): { lane: Map<string, number>; count: number } {
  const ends: number[] = [];
  const lane = new Map<string, number>();
  const sorted = [...list].map((b) => ({ b, seg: segmentOf(b, date) })).sort((x, y) => x.seg[0] - y.seg[0]);
  for (const { b, seg } of sorted) {
    let i = ends.findIndex((end) => end <= seg[0]);
    if (i < 0) i = ends.push(0) - 1;
    ends[i] = seg[1];
    lane.set(b.id, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

/**
 * ไทม์ไลน์การใช้ ZOOM ของวัน (00:00–24:00) — การจองที่เวลาซ้อนกันแยกช่องแนวตั้ง, คลิกแถบ = รายละเอียด,
 * คลิกช่องว่าง = จองตั้งแต่เวลานั้น (ปัดลงชั่วโมง)
 */
export function ZoomTimeline({ date, bookings, accounts = [], bookable = true }: { date: string; bookings: ZoomBooking[]; accounts?: string[]; bookable?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const today = localToday();
  const past = date < today || !bookable;
  const nowMin = useSyncExternalStore(noopSubscribe, minutesNow, () => -1);
  const { lane, count } = lanesOf(bookings, date);

  const slotAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(23 * 60, Math.max(0, Math.floor((((e.clientX - r.left) / r.width) * SPAN) / 60) * 60));
  };
  const canBook = (min: number) => !past && !(date === today && min + 60 <= nowMin);
  const book = (min: number) => router.push(`/zoom/book?${new URLSearchParams({ date, start: hm(min), end: hm(Math.min(min + 60, 23 * 60 + 30)) })}`);
  const timeText = (b: ZoomBooking) => `${b.start_on === date ? b.start_time : "…"}–${b.end_on === date ? b.end_time : "…"}`;

  return (
    <>
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="border-b border-line bg-subtle text-xs text-muted">
          <div className="relative mx-3 h-8">
            {HOURS.map((h) => (
              <span key={h} className="absolute top-2 -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${pct(h * 60)}%` }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        <div
          className={`relative mx-3 ${past ? "" : "cursor-pointer"}`}
          style={{ height: Math.max(96, count * LANE + 2 * LANE_PAD) }}
          onMouseMove={(e) => setHover(slotAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const min = slotAt(e);
            if (canBook(min)) book(min);
          }}
        >
          {HOURS.slice(1, -1).map((h) => (
            <span key={h} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${pct(h * 60)}%` }} aria-hidden="true" />
          ))}
          {hover !== null && canBook(hover) && (
            <span
              className="pointer-events-none absolute inset-y-2 flex items-center justify-center rounded-md border border-dashed border-accent-300 bg-accent-50 text-2xs font-medium text-accent-700 dark:border-accent-400/50 dark:bg-accent-400/10 dark:text-accent-200"
              style={{ left: `${pct(hover)}%`, width: `${pct(60)}%` }}
            >
              +
            </span>
          )}
          {bookings.map((b) => {
            const [s, e] = segmentOf(b, date);
            const box = count === 1 ? { top: LANE_PAD, bottom: LANE_PAD } : { top: LANE_PAD + lane.get(b.id)! * LANE, height: LANE - 4 };
            return (
              <Link
                key={b.id}
                href={`/zoom/bookings/${b.id}`}
                onClick={(ev) => ev.stopPropagation()}
                onMouseMove={(ev) => ev.stopPropagation()}
                className={`absolute z-10 cursor-pointer overflow-hidden rounded-md px-2 text-left ring-1 ring-inset ${zoomBarOf(b, accounts)}`}
                style={{ left: `${pct(s)}%`, width: `${pct(e - s)}%`, ...box }}
              >
                <span className="block truncate text-xs font-semibold leading-5">{b.title}</span>
                <span className="block truncate text-2xs leading-4 opacity-80">
                  {timeText(b)} · {b.user.name}
                  {b.zoom_account ? ` · ${b.zoom_account}` : ""}
                </span>
              </Link>
            );
          })}
          {date === today && nowMin >= 0 && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-danger-400" style={{ left: `${pct(nowMin)}%` }} aria-hidden="true" />}
        </div>
      </div>

      {/* จอเล็ก: รายการของวัน */}
      <div className={`space-y-2 p-3 md:hidden ${card}`}>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted">{t("zoom.free")}</p>
        ) : (
          bookings.map((b) => (
            <Link key={b.id} href={`/zoom/bookings/${b.id}`} className={`block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left ring-1 ring-inset ${zoomBarOf(b, accounts)}`}>
              <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                <span className="truncate">
                  {timeText(b)} · {b.title}
                </span>
                <ZoomStatusBadge booking={b} />
              </span>
              <span className="block text-2xs opacity-80">{b.user.name}</span>
            </Link>
          ))
        )}
        {!past && (
          <Link href={`/zoom/book?date=${date}`} className="inline-flex cursor-pointer text-xs font-medium text-accent-600 dark:text-accent-300">
            + {t("zoom.book")}
          </Link>
        )}
      </div>
    </>
  );
}
