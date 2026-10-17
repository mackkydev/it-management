"use client";

import { useEffect, useMemo, useState, useTransition, type MouseEvent } from "react";
import { loadLoans } from "@/app/actions/loans";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan, LoanDevice } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { LoanDialog } from "./loan-dialog";
import { daysOf, periodText, STATE_TONE, stateOf, type LoanState } from "./loan-utils";

const MAX_CHIPS = 3;
const LEGEND: LoanState[] = ["reserved", "on_loan", "overdue", "returned"];

/**
 * ปฏิทินเดือนของการยืมโน้ตบุ๊ก (คอลัมน์ขวาของหน้า ยืมโน้ตบุ๊ก) — การยืมหลายวันขึ้นทุกวันในช่วง,
 * พื้นแถบ = สีประจำเครื่อง (ตรงกับรายการทางซ้าย) + จุดสีสถานะ (จอง / ยืมอยู่ / เกินกำหนด / คืนแล้ว),
 * คลิกรายการ = รายละเอียด (ส่งมอบ / รับคืน / ยกเลิก ตามสิทธิ์), ดับเบิลคลิก / คลิกขวาที่วัน = เลือกโน้ตบุ๊กที่ว่างวันนั้น → onPick
 */
export function LoanCalendar({
  month: initialMonth,
  initialLoans,
  devices,
  colorOf,
  canBook = true,
  refreshKey = 0,
  onPick,
}: {
  month: string;
  initialLoans: Loan[];
  devices: LoanDevice[];
  colorOf: (id: number) => string;
  canBook?: boolean;
  /** เปลี่ยนค่า = โหลดเดือนนี้ใหม่ (หลังจองจากรายการทางซ้าย) */
  refreshKey?: number;
  onPick: (date: string, deviceId: number) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const [month, setMonth] = useState(initialMonth);
  const [loans, setLoans] = useState(initialLoans);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [pickDay, setPickDay] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, Loan[]>();
    for (const l of loans) for (const d of daysOf(l)) map.set(d, [...(map.get(d) ?? []), l]);
    return map;
  }, [loans]);
  const intl = locale === "th" ? "th-TH" : "en-GB";
  const monthTitle = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });

  const reload = (m = month) =>
    startLoad(async () => {
      const g = monthGrid(m);
      setLoans(await loadLoans(g.from, g.to));
    });
  const goMonth = (m: string) => {
    setMonth(m);
    reload(m);
    window.history.replaceState(null, "", `/loans/book?month=${m}`);
  };
  // จองจากรายการทางซ้ายแล้ว → โหลดเดือนนี้ใหม่
  useEffect(() => {
    if (refreshKey) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- โหลดใหม่ตาม refreshKey เท่านั้น
  }, [refreshKey]);

  /** โน้ตบุ๊กที่ไม่ติดยืม (จอง / ยืมอยู่) วันนั้น */
  const freeOn = (d: string) => {
    const taken = new Set((byDay.get(d) ?? []).filter((l) => l.status === "reserved" || l.status === "on_loan").map((l) => l.asset.id));
    for (const dev of devices) for (const b of dev.busy ?? []) if (b.start_on <= d && b.end_on >= d) taken.add(dev.id);
    return devices.filter((dev) => !taken.has(dev.id));
  };
  const openPicker = (d: string, e?: MouseEvent) => {
    e?.preventDefault();
    if (canBook && d >= today) setPickDay(d);
  };
  const line = (l: Loan) => `${periodText(l, fmt.date)} · ${l.asset.asset_tag} ${l.asset.name} · ${l.user.name}`;
  // พื้น = สีประจำเครื่อง, จุด = สถานะ (คืนแล้ว = จางลง)
  const chip = (l: Loan, small = false) => (
    <button
      key={l.id}
      type="button"
      onClick={(e) => (e.stopPropagation(), setSelected(l))}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex w-full cursor-pointer items-center gap-1 truncate rounded-md px-1.5 text-left font-medium ring-1 ring-inset ${small ? "py-0.5 text-[11px]" : "py-1 text-xs"} ${colorOf(l.asset.id)} ${l.status === "returned" ? "opacity-60" : ""}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_TONE[stateOf(l)].dot}`} aria-hidden="true" />
      <span className="truncate">{small ? `${l.asset.asset_tag} · ${l.user.name}` : line(l)}</span>
    </button>
  );

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
          {LEGEND.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATE_TONE[s].dot}`} aria-hidden="true" />
              {t(`loan.states.${s}`)}
            </span>
          ))}
        </div>
        {canBook && (
          <span className="hidden w-full items-center gap-1.5 text-xs text-muted md:flex">
            <PlusIcon width={12} height={12} />
            {t("loan.board.calendarHint")}
          </span>
        )}
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
            const bookable = canBook && d >= today;
            return (
              <div
                key={d}
                role={bookable ? "button" : undefined}
                tabIndex={bookable ? 0 : undefined}
                onDoubleClick={(e) => openPicker(d, e)}
                onContextMenu={(e) => bookable && openPicker(d, e)}
                onKeyDown={(e) => bookable && e.key === "Enter" && openPicker(d)}
                className={`group flex min-h-28 select-none flex-col gap-1 border-b border-r border-line p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 ${bookable ? "cursor-pointer hover:bg-accent-50/60 dark:hover:bg-accent-400/5" : ""} ${outside ? "bg-subtle/40 text-faint" : ""}`}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-accent-500 text-white" : ""}`}>{Number(d.slice(8))}</span>
                  {bookable && (
                    <span className="rounded-md p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
                      <PlusIcon width={14} height={14} />
                    </span>
                  )}
                </span>
                {list.slice(0, MAX_CHIPS).map((l) => chip(l, true))}
                {list.length > MAX_CHIPS && (
                  <Tooltip
                    side="bottom"
                    label={
                      <span className="block space-y-0.5 text-left">
                        {list.slice(MAX_CHIPS).map((l) => (
                          <span key={l.id} className="block">
                            {line(l)}
                          </span>
                        ))}
                      </span>
                    }
                  >
                    <span className="px-1 text-[11px] font-medium text-muted">{t("loan.more", { n: list.length - MAX_CHIPS })}</span>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* จอเล็ก: รายการตามวัน */}
      <ul className="space-y-2 md:hidden">
        {grid.days.filter((d) => d.slice(0, 7) === month && byDay.has(d)).length === 0 && <li className={`p-6 text-center text-muted ${card}`}>{t("loan.free")}</li>}
        {grid.days
          .filter((d) => d.slice(0, 7) === month && byDay.has(d))
          .map((d) => (
            <li key={d} className={`space-y-1.5 p-3 ${card}`}>
              <p className="text-sm font-semibold">{fmt.date(d)}</p>
              {byDay.get(d)!.map((l) => chip(l))}
            </li>
          ))}
      </ul>

      {selected && <LoanDialog loan={selected} onClose={() => setSelected(null)} onChanged={() => reload()} />}

      {/* ดับเบิลคลิก / คลิกขวาที่วัน: เลือกโน้ตบุ๊กที่ว่างวันนั้น → เปิดฟอร์มยืม-จองในรายการทางซ้าย */}
      {pickDay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" onClick={() => setPickDay(null)}>
          <div role="dialog" aria-modal="true" className={`max-h-[80vh] w-full max-w-sm space-y-3 overflow-y-auto p-4 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t("loan.board.pickTitle", { date: fmt.date(pickDay) })}</h3>
                <p className="text-xs text-muted">{t("loan.board.pickHint")}</p>
              </div>
              <button type="button" onClick={() => setPickDay(null)} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} shrink-0 px-2`}>
                <XIcon width={14} height={14} />
              </button>
            </div>
            {freeOn(pickDay).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">{t("loan.board.noneFree")}</p>
            ) : (
              <ul className="space-y-1.5">
                {freeOn(pickDay).map((dev) => (
                  <li key={dev.id}>
                    <button
                      type="button"
                      onClick={() => (onPick(pickDay, dev.id), setPickDay(null))}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2.5 text-left ring-1 ring-line transition-colors hover:bg-subtle"
                    >
                      <span className={`h-4 w-4 shrink-0 rounded ring-1 ring-inset ${colorOf(dev.id)}`} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{dev.name}</span>
                        <span className="block truncate text-xs text-muted">{dev.asset_tag}</span>
                      </span>
                      <PlusIcon width={14} height={14} className="ml-auto shrink-0 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
