"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { loadLoans } from "@/app/actions/loans";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { MonthBarGrid } from "@/components/month-bars";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan } from "@/lib/types";
import { monthGrid, shiftMonth } from "../calendar/calendar-grid";
import { LoanDialog } from "./loan-dialog";
import { daysOf, deviceLabel, OVERDUE_BAR, periodText, STATE_TONE, stateOf, type LoanState } from "./loan-utils";

const LEGEND: LoanState[] = ["reserved", "on_loan", "return_requested", "overdue", "returned"];

/**
 * ปฏิทินเดือนของการยืมโน้ตบุ๊ก (คอลัมน์ขวาของหน้า ยืมโน้ตบุ๊ก) — การยืมหลายวัน = แถบยาวต่อเนื่องแถบเดียว (MonthBarGrid),
 * พื้นแถบ = สีประจำเครื่อง (ตรงกับรายการทางซ้าย / ยังไม่เลือกเครื่อง = สีสถานะ), ชี้ = ข้อมูลการจองเบื้องต้น,
 * เกินกำหนดคืนและยังไม่คืน = แถบแดงขอบหนา "ชื่อผู้ยืม ยังไม่คืน" ลากถึงวันนี้ (กดคืนแล้วรอ IT ยืนยัน = ไม่นับเกินกำหนด),
 * คลิกแถบ = รายละเอียด, คลิกวัน / + / คลิกขวา = ยืม-จองวันนั้น (onBook)
 */
export function LoanCalendar({
  month: initialMonth,
  initialLoans,
  colorOf,
  canBook = true,
  refreshKey = 0,
  onBook,
}: {
  month: string;
  initialLoans: Loan[];
  colorOf: (id: number) => string;
  canBook?: boolean;
  /** เปลี่ยนค่า = โหลดเดือนนี้ใหม่ (หลังขอยืม) */
  refreshKey?: number;
  onBook: (date: string) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const [month, setMonth] = useState(initialMonth);
  const [loans, setLoans] = useState(initialLoans);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [loading, startLoad] = useTransition();
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
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
  // ขอยืมแล้ว → โหลดเดือนนี้ใหม่
  useEffect(() => {
    if (refreshKey) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- โหลดใหม่ตาม refreshKey เท่านั้น
  }, [refreshKey]);

  const device = (l: Loan) => deviceLabel(l.asset, t("loan.board.noDevice"));
  const tone = (l: Loan) => {
    if (l.is_overdue) return OVERDUE_BAR;
    if (!l.asset || l.status === "return_requested") return STATE_TONE[stateOf(l)].bar;
    return `${colorOf(l.asset.id)} ${l.status === "returned" ? "opacity-60" : ""}`;
  };
  const detail = (l: Loan) => (
    <span className="block space-y-0.5 text-left">
      <span className="block font-semibold">{l.user.name}{l.department ? ` · ${l.department}` : ""}</span>
      <span className="block">{t("loan.board.tipWhen")}: {periodText(l, fmt.date)}</span>
      <span className="block">{t("loan.board.tipDevice")}: {device(l)}</span>
      <span className="block">{t("loan.board.tipStatus")}: {t(`loan.states.${stateOf(l)}`)}</span>
      <span className="line-clamp-2 block opacity-80">{t("loan.board.tipPurpose")}: {l.purpose}</span>
    </span>
  );
  /** แถบ: เกินกำหนดคืนยังไม่คืน = ลากถึงวันนี้ */
  const barEnd = (l: Loan) => (l.is_overdue && today > l.end_on ? today : l.end_on);
  // จอเล็ก: รายการตามวัน (เกินกำหนดยังไม่คืน = ถึงวันนี้)
  const byDay = new Map<string, Loan[]>();
  for (const l of loans) for (const d of daysOf({ ...l, end_on: barEnd(l) })) byDay.set(d, [...(byDay.get(d) ?? []), l]);

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

      {/* จอใหญ่: ตารางเดือนแบบแถบ */}
      <MonthBarGrid
        month={month}
        days={grid.days}
        today={today}
        weekdayLabel={(d) => weekday.format(new Date(`${d}T00:00:00Z`))}
        onDayClick={(d) => canBook && d >= today && onBook(d)}
        onBook={canBook ? onBook : undefined}
        bookLabel={t("loan.board.borrow")}
        moreLabel={(n) => t("loan.more", { n })}
        bars={loans.map((l) => ({
          id: l.id,
          start: l.start_on,
          end: barEnd(l),
          label: l.is_overdue ? `${l.user.name} ${t("loan.board.notReturned")}` : `${l.asset ? `${l.asset.asset_tag} · ` : ""}${l.user.name}`,
          tone: tone(l),
          dashed: l.status === "reserved" && !l.asset,
          onClick: () => setSelected(l),
          detail: detail(l),
        }))}
      />

      {/* จอเล็ก: รายการตามวัน */}
      <ul className="space-y-2 md:hidden">
        {grid.days.filter((d) => d.slice(0, 7) === month && byDay.has(d)).length === 0 && <li className={`p-6 text-center text-muted ${card}`}>{t("loan.free")}</li>}
        {grid.days
          .filter((d) => d.slice(0, 7) === month && byDay.has(d))
          .map((d) => (
            <li key={d} className={`space-y-1.5 p-3 ${card}`}>
              <p className="text-sm font-semibold">{fmt.date(d)}</p>
              {byDay.get(d)!.map((l) => (
                <button key={l.id} type="button" onClick={() => setSelected(l)} className={`block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-xs font-medium ring-1 ring-inset ${tone(l)}`}>
                  {l.is_overdue ? `${l.user.name} ${t("loan.board.notReturned")}` : `${periodText(l, fmt.date)} · ${device(l)} · ${l.user.name}`}
                </button>
              ))}
            </li>
          ))}
      </ul>

      {selected && <LoanDialog loan={selected} onClose={() => setSelected(null)} onChanged={() => reload()} />}
    </div>
  );
}
