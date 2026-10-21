"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { loadBookings } from "@/app/actions/meeting";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { BookingDialog } from "./booking-dialog";
import { toneOf } from "./meeting-utils";

/**
 * ปฏิทินเดือนของห้องประชุม — ช่องวันแสดงการจอง (สีตามห้อง), ชี้ = รายการจองของวันนั้น,
 * คลิกวัน = ไทม์ไลน์รายห้องของวันนั้น, + / คลิกขวาที่วัน = จองวันนั้น (วันที่ผ่านไปแล้วจองไม่ได้)
 */
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

export function MeetingCalendar({ month: initialMonth, initialBookings, rooms, canBook = true }: { month: string; initialBookings: MeetingBooking[]; rooms: MeetingRoom[]; canBook?: boolean }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [bookings, setBookings] = useState(initialBookings);
  const [selected, setSelected] = useState<MeetingBooking | null>(null);
  const [loading, startLoad] = useTransition();
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingBooking[]>();
    // จองหลายวัน = แสดงทุกวันในช่วง
    for (const b of bookings) {
      for (let d = b.date; d <= (b.end_date || b.date); d = nextDay(d)) map.set(d, [...(map.get(d) ?? []), b]);
    }
    return map;
  }, [bookings]);
  const intl = locale === "th" ? "th-TH" : "en-GB";
  const monthTitle = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });

  const reload = (m = month) =>
    startLoad(async () => {
      const g = monthGrid(m);
      setBookings(await loadBookings(g.from, g.to));
    });
  const goMonth = (m: string) => {
    setMonth(m);
    reload(m);
    // จำเดือนใน URL — กลับจากหน้าวัน/ฟอร์มแล้วอยู่เดือนเดิม
    window.history.replaceState(null, "", `/meeting-rooms?month=${m}`);
  };
  const book = (d: string) => router.push(`/meeting-rooms/book?date=${d}`);

  // ห้องที่ถูกจองในวันนั้น (ไม่ซ้ำ เรียงตามลำดับห้อง)
  const roomDots = (list: MeetingBooking[]) =>
    [...new Set(list.map((b) => b.room.id))]
      .sort((a, b) => rooms.findIndex((r) => r.id === a) - rooms.findIndex((r) => r.id === b))
      .map((id) => ({ key: id, dot: toneOf(rooms, id).dot }));
  const line = (b: MeetingBooking) => `${t("meeting.timeRange", { start: b.start_time, end: b.end_time })} · ${b.room.name} · ${b.title} (${b.user.name})`;

  return (
    <div className="space-y-4">
      {/* แถบเครื่องมือ */}
      <div className={`flex flex-wrap items-center gap-3 p-3 ${card}`}>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} aria-label={t("meeting.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <button type="button" onClick={() => goMonth(today.slice(0, 7))} className={`${btn.secondary} ${btn.sm}`}>
            {t("meeting.today")}
          </button>
          <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} aria-label={t("meeting.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {monthTitle}
          {loading && <SpinnerIcon width={16} height={16} className="text-accent-400" />}
        </h2>
        {/* สีประจำห้อง */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {rooms.map((r) => (
            <span key={r.id} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${toneOf(rooms, r.id).dot}`} aria-hidden="true" />
              {r.name}
            </span>
          ))}
        </div>
        <span className={`hidden w-full items-center gap-1.5 text-xs text-muted ${canBook ? "md:flex" : ""}`}>
          <PlusIcon width={12} height={12} />
          {t("meeting.bookHint")}
        </span>
      </div>

      {/* จอใหญ่: ตารางเดือน */}
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="grid grid-cols-7 border-b border-line bg-subtle text-center text-xs font-medium text-muted">
          {grid.days.slice(0, 7).map((d) => (
            <div key={d} className="py-2">
              {weekday.format(new Date(`${d}T00:00:00Z`))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.days.map((d) => {
            const list = byDay.get(d) ?? [];
            const outside = d.slice(0, 7) !== month;
            const past = d < today;
            return (
              <div
                key={d}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/meeting-rooms/day/${d}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/meeting-rooms/day/${d}`)}
                // คลิกขวา = จองวันนั้น (แทนเมนูของเบราว์เซอร์)
                onContextMenu={(e) => {
                  if (past || !canBook) return;
                  e.preventDefault();
                  book(d);
                }}
                className={`group flex min-h-24 cursor-pointer flex-col border-b border-r border-line p-1.5 transition-colors hover:bg-accent-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-300 dark:hover:bg-accent-400/5 [&:nth-child(7n)]:border-r-0 ${outside ? "bg-subtle/40 text-faint" : ""}`}
              >
                <Tooltip
                  side="bottom"
                  className="min-w-0 flex-1"
                  label={
                    <span className="block space-y-0.5 text-left">
                      <span className="block font-semibold">{fmt.date(d)}</span>
                      {list.length === 0 ? <span className="block opacity-80">{t("meeting.free")}</span> : list.map((b) => <span key={b.id} className="block">{line(b)}</span>)}
                    </span>
                  }
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-accent-500 text-white" : ""}`}>
                        {Number(d.slice(8))}
                      </span>
                      {list.length > 0 && <span className="truncate whitespace-nowrap text-[10px] font-medium text-muted">{t("meeting.bookingsCount", { n: list.length })}</span>}
                      {!past && canBook && (
                        <button
                          type="button"
                          onClick={(e) => (e.stopPropagation(), book(d))}
                          aria-label={t("meeting.book")}
                          className="cursor-pointer rounded-md p-0.5 text-muted opacity-0 transition-opacity hover:bg-accent-100 hover:text-accent-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-accent-400/20 dark:hover:text-accent-200"
                        >
                          <PlusIcon width={14} height={14} />
                        </button>
                      )}
                    </span>
                    {/* จุดสี 1 จุดต่อห้องที่ถูกจองในวันนั้น (สีเดียวกับคำอธิบายด้านบน) — รายละเอียดดูจากทูลทิป / คลิกเข้าไทม์ไลน์ */}
                    {list.length > 0 && (
                      <span className="flex flex-wrap gap-1 px-1 pt-0.5" aria-hidden="true">
                        {roomDots(list).map((x) => (
                          <span key={x.key} className={`h-2.5 w-2.5 rounded-full ${x.dot}`} />
                        ))}
                      </span>
                    )}
                  </span>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>

      {/* จอเล็ก: รายการตามวัน */}
      <ul className="space-y-2 md:hidden">
        {grid.days.filter((d) => d.slice(0, 7) === month && byDay.has(d)).length === 0 && <li className={`p-6 text-center text-muted ${card}`}>{t("meeting.free")}</li>}
        {grid.days
          .filter((d) => d.slice(0, 7) === month && byDay.has(d))
          .map((d) => (
            <li key={d} className={`p-3 ${card}`}>
              <Link href={`/meeting-rooms/day/${d}`} className="mb-2 flex cursor-pointer items-center justify-between text-sm font-semibold">
                {fmt.date(d)}
                <ChevronRightIcon width={14} height={14} className="text-muted" />
              </Link>
              <div className="space-y-1.5">
                {byDay.get(d)!.map((b) => (
                  <button key={b.id} type="button" onClick={() => setSelected(b)} className={`block w-full cursor-pointer truncate rounded-lg px-2 py-1 text-left text-xs font-medium ring-1 ring-inset ${toneOf(rooms, b.room.id).bar}`}>
                    {line(b)}
                  </button>
                ))}
              </div>
            </li>
          ))}
      </ul>

      {selected && <BookingDialog booking={selected} tone={toneOf(rooms, selected.room.id)} onClose={() => setSelected(null)} onChanged={() => reload()} />}
    </div>
  );
}
