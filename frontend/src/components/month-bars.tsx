"use client";

import type { ReactNode } from "react";
import { PlusIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { card } from "@/components/ui";
import { dayOffClass, useDaysOff } from "@/components/days-off";

/** รายการที่แสดงเป็นแถบในปฏิทินเดือน — start/end = "YYYY-MM-DD" (หลายวัน = แถบลากยาวต่อเนื่อง) */
export interface MonthBar {
  id: string;
  start: string;
  end: string;
  /** ข้อความบนแถบ (สั้น) */
  label: ReactNode;
  /** รายละเอียดในทูลทิปตอนชี้ */
  detail: ReactNode;
  /** สีแถบ (token สถานะ/ธีม — bg + text + ring) */
  tone: string;
  /** รออนุมัติ = แถบจาง เส้นประ */
  dashed?: boolean;
  onClick?: () => void;
}

/** แถบสูงสุดต่อสัปดาห์ (ต่อช่องวัน) — เกินแสดง "+n" ที่ช่องวันนั้น */
const LANES = 3;
/** แถบสูง 22px (+10% จาก 20px) + ช่องไฟ 2px */
const LANE_PX = 24;
const HEAD_PX = 32;

interface Segment {
  bar: MonthBar;
  col: number;
  span: number;
  lane: number;
  head: boolean;
  tail: boolean;
}

/** แบ่งรายการเป็นแถบรายสัปดาห์ + จัดเลนไม่ให้ทับกัน (เริ่มก่อน/ยาวกว่าได้เลนบนก่อน) */
function weekSegments(week: string[], bars: MonthBar[]): { segments: Segment[]; hidden: number[] } {
  const first = week[0];
  const last = week[6];
  const inWeek = bars.filter((b) => b.start <= last && b.end >= first).sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const lanes: number[][] = [];
  const segments: Segment[] = [];
  const hidden = Array<number>(7).fill(0);
  for (const bar of inWeek) {
    const col = week.indexOf(bar.start < first ? first : bar.start);
    const endCol = week.indexOf(bar.end > last ? last : bar.end);
    let lane = lanes.findIndex((used) => used.every((c) => c < col || c > endCol));
    if (lane < 0) lane = lanes.push([]) - 1;
    for (let c = col; c <= endCol; c++) lanes[lane].push(c);
    if (lane < LANES) segments.push({ bar, col, span: endCol - col + 1, lane, head: bar.start >= first, tail: bar.end <= last });
    else for (let c = col; c <= endCol; c++) hidden[c]++;
  }
  return { segments, hidden };
}

/**
 * ปฏิทินเดือนแบบแถบ (ห้องประชุม / รถ) — การจองแสดงเป็นแถบพร้อมข้อมูลเบื้องต้น ชี้ = รายละเอียด, จองหลายวัน = แถบลากยาวข้ามวัน
 * คลิกช่องว่างของวัน = เปิดวันนั้น (onDayClick), คลิกแถบ = onClick ของแถบ, + / คลิกขวา = จองวันนั้น (onBook — วันที่ผ่านไปแล้วจองไม่ได้)
 */
export function MonthBarGrid({
  month,
  days,
  today,
  bars,
  weekdayLabel,
  onDayClick,
  onBook,
  bookLabel,
  moreLabel,
}: {
  month: string;
  /** 42 วันของตารางเดือน (monthGrid().days) */
  days: string[];
  today: string;
  bars: MonthBar[];
  weekdayLabel: (d: string) => string;
  onDayClick: (d: string) => void;
  onBook?: (d: string) => void;
  bookLabel: string;
  moreLabel: (n: number) => string;
}) {
  const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  // วันหยุดบริษัท + เสาร์-อาทิตย์ = พื้นต่างจากวันทำงาน
  const daysOff = useDaysOff(days[0], days[days.length - 1]);
  return (
    <div className={`hidden overflow-hidden md:block ${card}`}>
      <div className="grid grid-cols-7 border-b border-line bg-subtle text-center text-xs font-medium text-muted">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="py-2">
            {weekdayLabel(d)}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const { segments, hidden } = weekSegments(week, bars);
        return (
          <div key={week[0]} className="relative grid grid-cols-7 border-b border-line last:border-b-0" style={{ minHeight: HEAD_PX + LANES * LANE_PX + 22 }}>
            {week.map((d, i) => {
              const outside = d.slice(0, 7) !== month;
              const past = d < today;
              return (
                <div
                  key={d}
                  role="button"
                  tabIndex={0}
                  onClick={() => onDayClick(d)}
                  onKeyDown={(e) => e.key === "Enter" && onDayClick(d)}
                  // คลิกขวา = จองวันนั้น (แทนเมนูของเบราว์เซอร์)
                  onContextMenu={(e) => {
                    if (past || !onBook) return;
                    e.preventDefault();
                    onBook(d);
                  }}
                  className={`group relative cursor-pointer border-r border-line p-1.5 transition-colors last:border-r-0 hover:bg-accent-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-300 dark:hover:bg-accent-400/5 ${dayOffClass(d, daysOff)} ${outside ? "text-faint" : ""}`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className={`cal-daynum inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-accent-500 text-white" : ""}`}>{Number(d.slice(8))}</span>
                    {daysOff.has(d) && <span className="min-w-0 flex-1 truncate text-3xs text-danger-700 dark:text-danger-300">{daysOff.get(d)}</span>}
                    {!past && onBook && (
                      <button
                        type="button"
                        onClick={(e) => (e.stopPropagation(), onBook(d))}
                        aria-label={bookLabel}
                        className="cursor-pointer rounded-md p-0.5 text-muted opacity-0 transition-opacity hover:bg-accent-100 hover:text-accent-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-accent-400/20 dark:hover:text-accent-200"
                      >
                        <PlusIcon width={14} height={14} />
                      </button>
                    )}
                  </span>
                  {hidden[i] > 0 && <span className="absolute bottom-1 left-2 text-2xs font-medium text-muted">{moreLabel(hidden[i])}</span>}
                </div>
              );
            })}
            {/* แถบการจอง — หลายวันลากยาวต่อเนื่องในสัปดาห์ (ข้ามสัปดาห์ = ต่อแถบในแถวถัดไป มุมตัดตรง) */}
            {segments.map((s) => (
              <div
                key={`${s.bar.id}-${week[0]}`}
                className="absolute z-10"
                style={{ top: HEAD_PX + s.lane * LANE_PX, left: `calc(${(s.col / 7) * 100}% + 3px)`, width: `calc(${(s.span / 7) * 100}% - 6px)` }}
              >
                <Tooltip className="flex w-full" label={s.bar.detail}>
                  <button
                    type="button"
                    onClick={s.bar.onClick}
                    className={`block h-[22px] w-full cursor-pointer truncate px-2 text-left text-2xs font-medium leading-[22px] ring-1 ring-inset ${s.bar.tone} ${s.head ? "rounded-l-md" : ""} ${s.tail ? "rounded-r-md" : ""} ${s.bar.dashed ? "opacity-60 outline-1 outline-dashed outline-current" : ""}`}
                  >
                    {s.bar.label}
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
