"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { loadVehicleBookings } from "@/app/actions/vehicles";
import { CarIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { MonthBarGrid } from "@/components/month-bars";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { IDLE_TONE } from "@/lib/booking";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { VehicleDialog } from "./vehicle-dialog";
import { daysOf, periodText, toneOf } from "./vehicle-utils";

/**
 * ปฏิทินเดือนของการจองรถ — การจองเป็นแถบ (สีตามรถ, ยังไม่ระบุรถ = สีเทา, จองหลายวัน = แถบลากยาว),
 * ชี้แถบ = รายละเอียด, คลิกวัน = ไทม์ไลน์รายคัน, + / คลิกขวา = จองวันนั้น
 */
export function VehicleCalendar({ month: initialMonth, initialBookings, vehicles, canDispatch, canBook = true }: { month: string; initialBookings: VehicleBooking[]; vehicles: Vehicle[]; canDispatch: boolean; canBook?: boolean }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [bookings, setBookings] = useState(initialBookings);
  const [selected, setSelected] = useState<VehicleBooking | null>(null);
  const [loading, startLoad] = useTransition();
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, VehicleBooking[]>();
    for (const b of bookings) for (const d of daysOf(b)) map.set(d, [...(map.get(d) ?? []), b]);
    return map;
  }, [bookings]);
  const intl = locale === "th" ? "th-TH" : "en-GB";
  const monthTitle = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });

  const reload = (m = month) =>
    startLoad(async () => {
      const g = monthGrid(m);
      setBookings(await loadVehicleBookings(g.from, g.to));
    });
  const goMonth = (m: string) => {
    setMonth(m);
    reload(m);
    window.history.replaceState(null, "", `/vehicles?month=${m}`);
  };
  const book = (d: string) => router.push(`/vehicles/book?date=${d}`);
  const vehicleName = (b: VehicleBooking) => b.vehicle?.name ?? t("vehicle.unassigned");
  const tone = (b: VehicleBooking) => (b.vehicle ? toneOf(vehicles, b.vehicle.id) : IDLE_TONE);
  const line = (b: VehicleBooking) => `${periodText(b, fmt.date)} · ${vehicleName(b)} · ${b.details} (${b.user.name})`;

  return (
    <div className="space-y-4">
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
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {vehicles.map((v) => (
            <span key={v.id} className="flex items-center gap-1.5">
              <CarIcon width={14} height={14} className={`shrink-0 ${toneOf(vehicles, v.id).icon}`} aria-hidden="true" />
              {v.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <CarIcon width={14} height={14} className={`shrink-0 ${IDLE_TONE.icon}`} aria-hidden="true" />
            {t("vehicle.unassigned")}
          </span>
        </div>
        <span className={`hidden w-full items-center gap-1.5 text-xs text-muted ${canBook ? "md:flex" : ""}`}>
          <PlusIcon width={12} height={12} />
          {t("vehicle.bookHint")}
        </span>
      </div>

      {/* จอใหญ่: ตารางเดือนแบบแถบ — จองหลายวัน = แถบลากยาว (สีตามรถ, รออนุมัติ = จาง เส้นประ), ชี้ = รายละเอียด, คลิกแถบ = กล่องรายละเอียด, คลิกวัน = ไทม์ไลน์รายคัน */}
      <MonthBarGrid
        month={month}
        days={grid.days}
        today={today}
        weekdayLabel={(d) => weekday.format(new Date(`${d}T00:00:00Z`))}
        onDayClick={(d) => router.push(`/vehicles/day/${d}`)}
        onBook={canBook ? book : undefined}
        bookLabel={t("vehicle.book")}
        moreLabel={(n) => t("meeting.more", { n })}
        bars={bookings.map((b) => ({
          id: b.id,
          start: b.start_on,
          end: b.end_on,
          label: `${b.start_time} ${vehicleName(b)} · ${b.details}`,
          tone: tone(b).bar,
          dashed: b.status === "pending",
          onClick: () => setSelected(b),
          detail: (
            <span className="block space-y-0.5 text-left">
              <span className="block font-semibold">{b.details}</span>
              <span className="block">{periodText(b, fmt.date)}</span>
              <span className="block">{[vehicleName(b), b.vehicle?.plate_no].filter(Boolean).join(" · ")}</span>
              <span className="block opacity-80">{[b.user.name, b.department].filter(Boolean).join(" · ")}</span>
              {b.status === "pending" && <span className="block opacity-80">{t("vehicle.booking.statuses.pending")}</span>}
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
              <Link href={`/vehicles/day/${d}`} className="mb-2 flex cursor-pointer items-center justify-between text-sm font-semibold">
                {fmt.date(d)}
                <ChevronRightIcon width={14} height={14} className="text-muted" />
              </Link>
              <div className="space-y-1.5">
                {byDay.get(d)!.map((b) => (
                  <button key={b.id} type="button" onClick={() => setSelected(b)} className={`block w-full cursor-pointer truncate rounded-lg px-2 py-1 text-left text-xs font-medium ring-1 ring-inset ${tone(b).bar} ${b.status === "pending" ? "opacity-60 outline-1 outline-dashed outline-current" : ""}`}>
                    {line(b)}
                  </button>
                ))}
              </div>
            </li>
          ))}
      </ul>

      {selected && <VehicleDialog booking={selected} tone={tone(selected)} vehicles={canDispatch ? vehicles : []} onClose={() => setSelected(null)} onChanged={() => reload()} />}
    </div>
  );
}
