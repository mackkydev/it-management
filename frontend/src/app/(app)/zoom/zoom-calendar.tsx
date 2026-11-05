"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { loadZoomBookings } from "@/app/actions/zoom";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { accountTone, daysOf, periodText, ZOOM_DOT, zoomBarOf } from "./zoom-utils";

/** แถบสูงสุดต่อช่องวัน — เกินแสดง "+n รายการ" */
const MAX_BARS = 3;

/**
 * ปฏิทินเดือนของการใช้ ZOOM — ช่องวันแสดงเป็นแถบ (เวลาเริ่ม + หัวข้อ) สีตามบัญชี ZOOM (ยังไม่เลือกบัญชี = สีตามสถานะ), การจองหลายวันขึ้นทุกวันในช่วง
 * ผู้ใช้ทั่วไปเห็นเฉพาะที่ส่งลิงก์แล้ว (API กรองให้) — คำอธิบายสี: บัญชี ZOOM ทุกคน + สถานะก่อนส่งลิงก์เฉพาะฝ่าย IT (showStatuses)
 * คลิกวัน = ไทม์ไลน์ของวัน (แถบคลิกแยกไม่ได้ — ชี้ที่วัน = ทูลทิปรายการหลายบรรทัด), + / คลิกขวา = จองวันนั้น
 */
export function ZoomCalendar({ month: initialMonth, initialBookings, accounts = [], canBook = true, showStatuses = false }: { month: string; initialBookings: ZoomBooking[]; accounts?: string[]; canBook?: boolean; showStatuses?: boolean }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [bookings, setBookings] = useState(initialBookings);
  const [loading, startLoad] = useTransition();
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, ZoomBooking[]>();
    for (const b of bookings) for (const d of daysOf(b)) map.set(d, [...(map.get(d) ?? []), b]);
    return map;
  }, [bookings]);
  const intl = locale === "th" ? "th-TH" : "en-GB";
  const monthTitle = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });

  const goMonth = (m: string) => {
    setMonth(m);
    startLoad(async () => {
      const g = monthGrid(m);
      setBookings(await loadZoomBookings(g.from, g.to));
    });
    window.history.replaceState(null, "", `/zoom?month=${m}`);
  };
  const book = (d: string) => router.push(`/zoom/book?date=${d}`);
  /** เวลาของแถบในวันนั้น: วันต่อเนื่อง = "…" */
  const timeOn = (b: ZoomBooking, d: string) => (b.start_on === d ? b.start_time : "…");
  // ผู้ใช้ทั่วไปเห็นเฉพาะที่ส่งลิงก์แล้ว = ไม่ต้องบอกสถานะ
  const line = (b: ZoomBooking) => `${periodText(b, fmt.date)} · ${b.title} (${b.user.name})${b.zoom_account ? ` · ${b.zoom_account}` : ""}${showStatuses ? ` — ${t(`zoom.statuses.${b.status}`)}` : ""}`;

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
        {(accounts.length > 0 || showStatuses) && (
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {accounts.map((a) => (
              <span key={a} className="flex items-center gap-1.5">
                <span className={`h-2 w-4 rounded-sm ${accountTone(accounts, a).dot}`} aria-hidden="true" />
                {a}
              </span>
            ))}
            {showStatuses &&
              (["pending", "accepted"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`h-2 w-4 rounded-sm ${ZOOM_DOT[s]}`} aria-hidden="true" />
                  {t(`zoom.statuses.${s}`)}
                </span>
              ))}
          </div>
        )}
        {canBook && (
          <span className="hidden w-full items-center gap-1.5 text-xs text-muted md:flex">
            <PlusIcon width={12} height={12} />
            {t("zoom.bookHint")}
          </span>
        )}
      </div>

      {/* จอใหญ่: ตารางเดือน — แถบต่อการจอง */}
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
                onClick={() => router.push(`/zoom/day/${d}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/zoom/day/${d}`)}
                onContextMenu={(e) => {
                  if (past || !canBook) return;
                  e.preventDefault();
                  book(d);
                }}
                className={`group flex min-h-28 cursor-pointer flex-col gap-1 border-b border-r border-line p-1.5 transition-colors hover:bg-accent-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-300 dark:hover:bg-accent-400/5 [&:nth-child(7n)]:border-r-0 ${outside ? "bg-subtle/40 text-faint" : ""}`}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-accent-500 text-white" : ""}`}>{Number(d.slice(8))}</span>
                  {!past && canBook && (
                    <button
                      type="button"
                      onClick={(e) => (e.stopPropagation(), book(d))}
                      aria-label={t("zoom.book")}
                      className="cursor-pointer rounded-md p-0.5 text-muted opacity-0 transition-opacity hover:bg-accent-100 hover:text-accent-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-accent-400/20 dark:hover:text-accent-200"
                    >
                      <PlusIcon width={14} height={14} />
                    </button>
                  )}
                </span>
                {/* แถบ 1 แถบต่อการจอง (เวลาเริ่ม + หัวข้อ) — คลิกได้ที่วันอย่างเดียว (เข้าไทม์ไลน์), ชี้ที่วัน = รายการทั้งหมดของวันนั้นทีละบรรทัด */}
                {list.length > 0 && (
                  <Tooltip
                    className="block min-w-0"
                    label={
                      <span className="block space-y-0.5 text-left">
                        <span className="block font-semibold">{fmt.date(d)}</span>
                        {list.map((b) => (
                          <span key={b.id} className="block">
                            {line(b)}
                          </span>
                        ))}
                      </span>
                    }
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      {list.slice(0, MAX_BARS).map((b) => (
                        <span key={b.id} className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium leading-4 ring-1 ring-inset ${zoomBarOf(b, accounts)}`}>
                          <span className="tabular-nums">{timeOn(b, d)}</span> {b.title}
                        </span>
                      ))}
                      {list.length > MAX_BARS && <span className="px-1 text-[10px] font-medium text-muted">{t("zoom.moreCount", { n: list.length - MAX_BARS })}</span>}
                    </span>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* จอเล็ก: รายการตามวัน */}
      <ul className="space-y-2 md:hidden">
        {grid.days.filter((d) => d.slice(0, 7) === month && byDay.has(d)).length === 0 && <li className={`p-6 text-center text-muted ${card}`}>{t("zoom.free")}</li>}
        {grid.days
          .filter((d) => d.slice(0, 7) === month && byDay.has(d))
          .map((d) => (
            <li key={d} className={`p-3 ${card}`}>
              <Link href={`/zoom/day/${d}`} className="mb-2 flex cursor-pointer items-center justify-between text-sm font-semibold">
                {fmt.date(d)}
                <ChevronRightIcon width={14} height={14} className="text-muted" />
              </Link>
              <div className="space-y-1.5">
                {byDay.get(d)!.map((b) => (
                  <Link key={b.id} href={`/zoom/day/${d}`} className={`block w-full cursor-pointer truncate rounded-lg px-2 py-1 text-left text-xs font-medium ring-1 ring-inset ${zoomBarOf(b, accounts)}`}>
                    {timeOn(b, d)} · {b.title} ({b.user.name})
                  </Link>
                ))}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}
