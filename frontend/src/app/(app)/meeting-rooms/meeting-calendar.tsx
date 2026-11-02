"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { loadBookings } from "@/app/actions/meeting";
import { ChevronLeftIcon, ChevronRightIcon, MeetingRoomIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { MonthBarGrid } from "@/components/month-bars";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { BookingDialog } from "./booking-dialog";
import { toneOf } from "./meeting-utils";

/**
 * ปฏิทินเดือนของห้องประชุม — การจองเป็นแถบ (สีตามห้อง, จองหลายวัน = แถบลากยาว), ชี้แถบ = รายละเอียด,
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

  // ช่วงเวลาของการจอง: หลายวัน = วันเวลาเริ่ม – วันเวลาสิ้นสุด, วันเดียว = วันที่ + เวลา
  const period = (b: MeetingBooking) =>
    b.end_date > b.date ? `${fmt.date(b.date)} ${b.start_time} – ${fmt.date(b.end_date)} ${b.end_time}` : `${fmt.date(b.date)} ${t("meeting.timeRange", { start: b.start_time, end: b.end_time })}`;
  const line = (b: MeetingBooking) => `${period(b)} · ${b.room.name} · ${b.title} (${b.user.name})`;

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
              <MeetingRoomIcon width={14} height={14} className={`shrink-0 ${toneOf(rooms, r.id).icon}`} aria-hidden="true" />
              {r.name}
            </span>
          ))}
        </div>
        <span className={`hidden w-full items-center gap-1.5 text-xs text-muted ${canBook ? "md:flex" : ""}`}>
          <PlusIcon width={12} height={12} />
          {t("meeting.bookHint")}
        </span>
      </div>

      {/* จอใหญ่: ตารางเดือนแบบแถบ — จองหลายวัน = แถบลากยาว, ชี้ = รายละเอียด, คลิกแถบ = กล่องรายละเอียด, คลิกวัน = ไทม์ไลน์รายห้อง */}
      <MonthBarGrid
        month={month}
        days={grid.days}
        today={today}
        weekdayLabel={(d) => weekday.format(new Date(`${d}T00:00:00Z`))}
        onDayClick={(d) => router.push(`/meeting-rooms/day/${d}`)}
        onBook={canBook ? book : undefined}
        bookLabel={t("meeting.book")}
        moreLabel={(n) => t("meeting.more", { n })}
        bars={bookings.map((b) => ({
          id: b.id,
          start: b.date,
          end: b.end_date || b.date,
          label: `${b.start_time} ${b.room.name} · ${b.title}`,
          tone: toneOf(rooms, b.room.id).bar,
          onClick: () => setSelected(b),
          detail: (
            <span className="block space-y-0.5 text-left">
              <span className="block font-semibold">{b.title}</span>
              <span className="block">{period(b)}</span>
              <span className="block">{b.room.name}</span>
              <span className="block opacity-80">{[b.user.name, b.department].filter(Boolean).join(" · ")}</span>
            </span>
          ),
        }))}
      />

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
