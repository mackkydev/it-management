"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { loadLoans } from "@/app/actions/loans";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { LoanDialog } from "./loan-dialog";
import { daysOf, periodText, STATE_TONE, stateOf, type LoanState } from "./loan-utils";

const MAX_CHIPS = 3;
const LEGEND: LoanState[] = ["reserved", "on_loan", "overdue", "returned"];

/**
 * ปฏิทินเดือนของการยืมอุปกรณ์ IT — การยืมหลายวันขึ้นทุกวันในช่วง (สีตามสถานะ: จอง / ยืมอยู่ / เกินกำหนด / คืนแล้ว),
 * คลิกรายการ = รายละเอียด (ส่งมอบ / รับคืน / ยกเลิก ตามสิทธิ์), คลิกวัน / + = จองยืมวันนั้น
 */
export function LoanCalendar({ month: initialMonth, initialLoans, canBook = true }: { month: string; initialLoans: Loan[]; canBook?: boolean }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [loans, setLoans] = useState(initialLoans);
  const [selected, setSelected] = useState<Loan | null>(null);
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
    window.history.replaceState(null, "", `/loans?month=${m}`);
  };
  const book = (d: string) => router.push(`/loans/book?date=${d}`);
  const line = (l: Loan) => `${periodText(l, fmt.date)} · ${l.asset.asset_tag} ${l.asset.name} · ${l.user.name}`;
  const chip = (l: Loan, small = false) => (
    <button
      key={l.id}
      type="button"
      onClick={(e) => (e.stopPropagation(), setSelected(l))}
      className={`block w-full cursor-pointer truncate rounded-md px-1.5 text-left font-medium ring-1 ring-inset ${small ? "py-0.5 text-[11px]" : "py-1 text-xs"} ${STATE_TONE[stateOf(l)].bar}`}
    >
      {small ? `${l.asset.asset_tag} · ${l.user.name}` : line(l)}
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
            {t("loan.bookHint")}
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
                onClick={() => bookable && book(d)}
                onKeyDown={(e) => bookable && e.key === "Enter" && book(d)}
                className={`group flex min-h-28 flex-col gap-1 border-b border-r border-line p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 ${bookable ? "cursor-pointer hover:bg-accent-50/60 dark:hover:bg-accent-400/5" : ""} ${outside ? "bg-subtle/40 text-faint" : ""}`}
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
    </div>
  );
}
