"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { deleteEvent, loadCalendar, saveEvent, setFeedToken, type EventValues } from "@/app/actions/calendar";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { CalendarItem, CalendarMeta, CalendarScope } from "@/lib/types";
import { monthGrid, shiftMonth } from "./calendar-grid";

type Kind = CalendarItem["kind"];
const KINDS: Kind[] = ["leave", "onsite", "event", "holiday"];
const KINDS_KEY = "calendar.kinds";
/** ประเภทที่เลือกแสดงไว้ (localStorage ของเครื่องนี้) — server = แสดงทุกประเภท, client อ่านค่าจริงหลัง hydrate */
const readSavedKinds = () => {
  try {
    return localStorage.getItem(KINDS_KEY) ?? "";
  } catch {
    return "";
  }
};
const noopSubscribe = () => () => {};
const parseKinds = (raw: string): Set<Kind> => {
  try {
    const saved: unknown = JSON.parse(raw);
    if (Array.isArray(saved)) return new Set(KINDS.filter((k) => saved.includes(k)));
  } catch {
    // ไม่มีค่า / ค่าเสีย — แสดงทุกประเภท
  }
  return new Set(KINDS);
};
/** สีแถบตามประเภท */
const KIND_CLS: Record<Kind, string> = {
  leave: "bg-warning-100 text-warning-800 ring-warning-300 dark:bg-warning-400/20 dark:text-warning-200 dark:ring-warning-400/40",
  onsite: "bg-info-100 text-info-800 ring-info-300 dark:bg-info-400/20 dark:text-info-200 dark:ring-info-400/40",
  event: "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/20 dark:text-accent-200 dark:ring-accent-400/40",
  holiday: "bg-danger-100 text-danger-800 ring-danger-300 dark:bg-danger-400/20 dark:text-danger-200 dark:ring-danger-400/40",
};
const DOT: Record<Kind, string> = { leave: "bg-warning-400", onsite: "bg-info-400", event: "bg-accent-400", holiday: "bg-danger-400" };
const LANES = 3;
const EMPTY_EVENT: EventValues = { title: "", start_on: "", end_on: "", note: "", all_company: false, skip_weekends: false };

/** ช่วงวันมีเสาร์หรืออาทิตย์อยู่ไหม (แสดงตัวเลือก "ไม่รวมเสาร์-อาทิตย์") */
const hasWeekend = (start: string, end: string) => {
  if (!start || !end || end < start) return false;
  for (let d = new Date(`${start}T00:00:00Z`), n = 0; d.toISOString().slice(0, 10) <= end && n < 7; d.setUTCDate(d.getUTCDate() + 1), n++) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return true;
  }
  return false;
};

interface Segment {
  item: CalendarItem;
  col: number;
  span: number;
  lane: number;
  head: boolean;
  tail: boolean;
}

/** แบ่งรายการเป็นแถบรายสัปดาห์ + จัดเลน (ไม่ทับกัน) */
function weekSegments(week: string[], items: CalendarItem[]): { segments: Segment[]; hidden: number[] } {
  const first = week[0];
  const last = week[6];
  const inWeek = items
    .filter((i) => i.start <= last && i.end >= first)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const lanes: number[][] = [];
  const segments: Segment[] = [];
  const hidden = Array<number>(7).fill(0);
  for (const item of inWeek) {
    const col = Math.max(0, week.indexOf(item.start < first ? first : item.start));
    const endCol = week.indexOf(item.end > last ? last : item.end);
    const span = endCol - col + 1;
    let lane = lanes.findIndex((used) => used.every((c) => c < col || c > endCol));
    if (lane < 0) lane = lanes.push([]) - 1;
    for (let c = col; c <= endCol; c++) lanes[lane].push(c);
    if (lane < LANES) segments.push({ item, col, span, lane, head: item.start >= first, tail: item.end <= last });
    else for (let c = col; c <= endCol; c++) hidden[c]++;
  }
  return { segments, hidden };
}

export function CalendarView({ month: initialMonth, initialItems, meta, branches, userId, canAddEvent = true, canIcal = true }: {
  month: string;
  initialItems: CalendarItem[];
  meta: CalendarMeta;
  branches: { id: number; name: string }[];
  userId: number;
  /** ปุ่ม "เพิ่มกิจกรรม" (+ ดับเบิลคลิก/คลิกขวาที่วัน) — ตั้งซ่อนได้ที่หน้าสิทธิ์การใช้งาน */
  canAddEvent?: boolean;
  canIcal?: boolean;
}) {
  const { t, fmt, locale } = useI18n();
  const confirm = useConfirm();
  const [month, setMonth] = useState(initialMonth);
  const [items, setItems] = useState(initialItems);
  const [scope, setScope] = useState<CalendarScope>(meta.max_scope);
  const [branchId, setBranchId] = useState("");
  const savedKinds = useSyncExternalStore(noopSubscribe, readSavedKinds, () => "");
  const [kindsOverride, setKinds] = useState<Set<Kind> | null>(null);
  const kinds = kindsOverride ?? parseKinds(savedKinds);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; v: EventValues } | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();
  const [token, setToken] = useState(meta.feed_token);
  const [showIcal, setShowIcal] = useState(false);
  const [copied, setCopied] = useState(false);
  const today = localToday();

  const grid = useMemo(() => monthGrid(month), [month]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => grid.days.slice(w * 7, w * 7 + 7)), [grid]);
  const visible = items.filter((i) => kinds.has(i.kind));
  const monthTitle = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", { weekday: "short", timeZone: "UTC" });

  const reload = (m = month, s = scope, b = branchId) =>
    startLoad(async () => {
      const g = monthGrid(m);
      setItems(await loadCalendar(g.from, g.to, s, s === "all" && b ? Number(b) : null));
    });
  const goMonth = (m: string) => (setMonth(m), reload(m));
  // เลือกแสดง/ซ่อนแต่ละประเภท (เช่น ซ่อนวันหยุดบริษัท) — จำไว้ในเครื่องนี้
  const toggleKind = (k: Kind) => {
    const next = kinds.has(k) ? new Set([...kinds].filter((x) => x !== k)) : new Set([...kinds, k]);
    setKinds(next);
    try {
      localStorage.setItem(KINDS_KEY, JSON.stringify([...next]));
    } catch {
      // เก็บไม่ได้ (private mode) — ใช้ได้เฉพาะรอบนี้
    }
  };

  const openNew = (date?: string) => canAddEvent && (setEditing({ id: null, v: { ...EMPTY_EVENT, start_on: date ?? today, end_on: date ?? today } }), setError(""));
  const saveForm = () => {
    if (!editing) return;
    if (!editing.v.title.trim()) return setError(t("calendar.titleRequired"));
    start(async () => {
      const res = await saveEvent(editing.id, editing.v);
      if (res.ok) {
        setEditing(null);
        reload();
      } else setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
    });
  };
  const remove = async (i: CalendarItem) => {
    if (!i.event_id || !(await confirm(t("calendar.confirmDeleteEvent", { title: i.title })))) return;
    start(async () => {
      await deleteEvent(i.event_id!);
      setSelected(null);
      reload();
    });
  };
  const feedUrl = token && typeof window !== "undefined" ? `${window.location.origin}/ical/${token}.ics` : "";

  const periodText = (i: CalendarItem) => {
    const base = i.start === i.end ? fmt.date(i.start) : `${fmt.date(i.start)} – ${fmt.date(i.end)}`;
    if (!i.leave) return base;
    const unit = t(`leave.units.${i.leave.unit}`) + (i.leave.unit === "hours" && i.leave.start_time ? ` ${i.leave.start_time}–${i.leave.end_time}` : "");
    return `${base} · ${unit} · ${t("calendar.days", { n: fmt.number(i.leave.days) })}`;
  };

  return (
    <div className="space-y-4">
      {/* แถบเครื่องมือ */}
      <div className={`flex flex-wrap items-center gap-3 p-3 ${card}`}>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} aria-label={t("calendar.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <button type="button" onClick={() => goMonth(today.slice(0, 7))} className={`${btn.secondary} ${btn.sm}`}>
            {t("calendar.today")}
          </button>
          <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} aria-label={t("calendar.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {monthTitle}
          {loading && <SpinnerIcon width={16} height={16} className="text-accent-400" />}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* input = w-full → ครอบด้วยความกว้างคงที่ ให้อยู่บรรทัดเดียวกับเดือน/ปุ่ม */}
          {meta.scopes.length > 1 && (
            <div className="w-40">
              <AppSelect value={scope} onValueChange={(s) => (setScope(s as CalendarScope), reload(month, s as CalendarScope))} className={`${input} py-1.5 text-sm`} aria-label={t("calendar.scopeLabel")}>
                {meta.scopes.map((s) => (
                  <option key={s} value={s}>
                    {t(`calendar.scopes.${s}`)}
                  </option>
                ))}
              </AppSelect>
            </div>
          )}
          {scope === "all" && (
            <div className="w-44">
              <AppSelect value={branchId} onValueChange={(b) => (setBranchId(b), reload(month, scope, b))} className={`${input} py-1.5 text-sm`} aria-label={t("calendar.allBranches")}>
                <option value="">{t("calendar.allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </AppSelect>
            </div>
          )}
          {canIcal && (
            <button type="button" onClick={() => setShowIcal((v) => !v)} className={`${btn.secondary} ${btn.sm}`}>
              <ExternalLinkIcon width={14} height={14} />
              iCal
            </button>
          )}
          {canAddEvent && (
            <button type="button" onClick={() => openNew()} className={`${btn.primary} ${btn.sm}`}>
              <PlusIcon width={14} height={14} />
              {t("calendar.addEvent")}
            </button>
          )}
        </div>
        {/* ตัวกรองประเภท */}
        <div className="flex w-full flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kinds.has(k)}
              onClick={() => toggleKind(k)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-opacity ${kinds.has(k) ? KIND_CLS[k] : "text-muted ring-line opacity-60"}`}
            >
              <span className={`h-2 w-2 rounded-full ${DOT[k]}`} aria-hidden="true" />
              {t(`calendar.kinds.${k}`)}
            </button>
          ))}
          {/* บอกวิธีเพิ่มกิจกรรมจากช่องวัน (เฉพาะตารางปฏิทิน — จอเล็กเป็นมุมมองรายการ) */}
          {canAddEvent && (
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted md:flex">
              <PlusIcon width={12} height={12} />
              {t("calendar.addHint")}
            </span>
          )}
        </div>
      </div>

      {showIcal && canIcal && (
        <div className={`space-y-2 p-4 text-sm ${card}`}>
          <p className="font-medium">{t("calendar.ical")}</p>
          <p className="text-xs text-muted">{t("calendar.icalHint")}</p>
          {token ? (
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly value={feedUrl} className={`${input} min-w-64 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" onClick={() => (navigator.clipboard?.writeText(feedUrl), setCopied(true))} className={`${btn.soft} ${btn.sm}`}>
                <CopyIcon width={14} height={14} />
                {copied ? t("calendar.icalCopied") : t("calendar.copy")}
              </button>
              <button type="button" onClick={() => start(async () => (setToken((await setFeedToken(true)).token), setCopied(false)))} className={`${btn.secondary} ${btn.sm}`}>
                {t("calendar.icalRenew")}
              </button>
              <button type="button" onClick={() => start(async () => setToken((await setFeedToken(false)).token))} className={`${btn.danger} ${btn.sm}`}>
                {t("calendar.icalRevoke")}
              </button>
            </div>
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => setToken((await setFeedToken(true)).token))} className={`${btn.primary} ${btn.sm}`}>
              {t("calendar.icalCreate")}
            </button>
          )}
        </div>
      )}

      {/* จอใหญ่: ตารางเดือน */}
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="grid grid-cols-7 border-b border-line bg-subtle text-center text-xs font-medium text-muted">
          {grid.days.slice(0, 7).map((d) => (
            <div key={d} className="py-2">
              {weekday.format(new Date(`${d}T00:00:00Z`))}
            </div>
          ))}
        </div>
        {weeks.map((week) => {
          const { segments, hidden } = weekSegments(week, visible);
          return (
            <div key={week[0]} className="relative grid min-h-32 grid-cols-7 border-b border-line last:border-b-0">
              {week.map((d, i) => {
                const outside = d.slice(0, 7) !== month;
                const isHoliday = visible.some((x) => x.kind === "holiday" && x.start === d);
                return (
                  <div
                    key={d}
                    onDoubleClick={() => openNew(d)}
                    // คลิกขวาที่ช่องวัน = เพิ่มกิจกรรมวันนั้น (แทนเมนูของเบราว์เซอร์)
                    onContextMenu={(e) => {
                      if (!canAddEvent) return;
                      e.preventDefault();
                      openNew(d);
                    }}
                    className={`group min-h-32 border-r border-line p-1.5 text-left last:border-r-0 ${outside ? "bg-subtle/40 text-faint" : ""} ${isHoliday ? "bg-danger-50/50 dark:bg-danger-400/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-accent-500 text-white" : ""}`}>
                        {Number(d.slice(8))}
                      </span>
                      {/* tooltip ตอนชี้ที่ช่องวัน (ซ่อนเมื่อซ่อนปุ่มเพิ่มกิจกรรม) */}
                      <span hidden={!canAddEvent} aria-hidden="true" className="pointer-events-none relative z-20 shrink-0 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[10px] font-medium text-canvas opacity-0 shadow-sm transition-opacity delay-300 group-hover:opacity-90">
                        {t("calendar.rightClickHint")}
                      </span>
                    </div>
                    {hidden[i] > 0 && <span className="absolute bottom-1 text-[11px] text-muted" style={{ left: `calc(${(i / 7) * 100}% + 6px)` }}>{t("calendar.more", { n: hidden[i] })}</span>}
                  </div>
                );
              })}
              {/* แถบรายการ (line) ข้ามหลายวัน */}
              {segments.map((s) => (
                <button
                  key={`${s.item.id}-${week[0]}`}
                  type="button"
                  onClick={() => setSelected(s.item)}
                  title={`${s.item.title} — ${periodText(s.item)}`}
                  className={`absolute z-10 h-5 cursor-pointer truncate px-2 text-left text-[11px] font-medium leading-5 ring-1 ring-inset ${KIND_CLS[s.item.kind]} ${s.head ? "rounded-l-md" : ""} ${s.tail ? "rounded-r-md" : ""} ${s.item.status === "pending" ? "border border-dashed opacity-70" : ""}`}
                  style={{ top: `${32 + s.lane * 23}px`, left: `calc(${(s.col / 7) * 100}% + 3px)`, width: `calc(${(s.span / 7) * 100}% - 6px)` }}
                >
                  {s.item.status === "pending" && `${t("calendar.pending")} · `}
                  {s.item.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* จอเล็ก: รายการ */}
      <ul className="space-y-2 md:hidden">
        {visible.filter((i) => i.end >= `${month}-01` && i.start <= `${month}-31`).length === 0 && <li className={`p-6 text-center text-muted ${card}`}>{t("calendar.empty")}</li>}
        {visible
          .filter((i) => i.end >= `${month}-01` && i.start <= `${month}-31`)
          .map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => setSelected(i)} className={`flex w-full cursor-pointer items-start gap-3 p-3 text-left ${card}`}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[i.kind]}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.title}</span>
                  <span className="block text-xs text-muted">{periodText(i)}</span>
                </span>
              </button>
            </li>
          ))}
      </ul>

      {/* รายละเอียดรายการ */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay p-4" onClick={() => setSelected(null)}>
          <div role="dialog" aria-modal="true" className={`w-full max-w-md space-y-3 p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${KIND_CLS[selected.kind]}`}>{t(`calendar.kinds.${selected.kind}`)}</span>
                <h3 className="mt-1.5 font-semibold">{selected.title}</h3>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} px-2`}>
                <XIcon width={14} height={14} />
              </button>
            </div>
            <p className="text-sm text-muted">
              {selected.range ? `${periodText({ ...selected, start: selected.range.start, end: selected.range.end })} · ${t("calendar.skipWeekends")}` : periodText(selected)}
            </p>
            {selected.status === "pending" && <p className="text-xs font-medium text-warning-700 dark:text-warning-300">{t("calendar.pending")}</p>}
            {selected.note && <p className="whitespace-pre-line text-sm">{selected.note}</p>}
            <div className="flex flex-wrap gap-2">
              {selected.ticket && (
                <Link href={`/tickets/${selected.ticket.id}`} className={`${btn.soft} ${btn.sm}`}>
                  {t("calendar.openTicket")} {selected.ticket.ticket_no}
                </Link>
              )}
              {selected.leave && selected.user?.id === userId && (
                <Link href={`/leave?open=${selected.leave.id}`} className={`${btn.soft} ${btn.sm}`}>
                  {t("calendar.openLeave")}
                </Link>
              )}
              {selected.can_edit && (
                <>
                  <button
                    type="button"
                    onClick={() => (
                      setEditing({
                        id: selected.event_id!,
                        // แถบที่แยกจากกิจกรรมไม่รวมเสาร์-อาทิตย์ = แก้ทั้งกิจกรรม (ช่วงวันเต็ม)
                        v: {
                          title: selected.title,
                          start_on: selected.range?.start ?? selected.start,
                          end_on: selected.range?.end ?? selected.end,
                          note: selected.note ?? "",
                          all_company: Boolean(selected.all_company),
                          skip_weekends: Boolean(selected.skip_weekends),
                        },
                      }),
                      setSelected(null),
                      setError("")
                    )}
                    className={`${btn.secondary} ${btn.sm}`}
                  >
                    <PencilIcon width={14} height={14} />
                    {t("common.edit")}
                  </button>
                  <button type="button" onClick={() => remove(selected)} disabled={pending} className={`${btn.danger} ${btn.sm}`}>
                    <TrashIcon width={14} height={14} />
                    {t("calendar.deleteEvent")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ฟอร์มกิจกรรม */}
      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay p-4" onClick={() => setEditing(null)}>
          <div role="dialog" aria-modal="true" className={`w-full max-w-lg space-y-4 p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">{editing.id ? t("calendar.editEvent") : t("calendar.addEvent")}</h3>
            {error && (
              <p role="alert" className={alert.error}>
                <AlertIcon className="shrink-0 text-danger-400" />
                {error}
              </p>
            )}
            <fieldset disabled={pending} className="grid grid-cols-1 gap-3 disabled:opacity-60 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="ev-title" className="mb-1 block text-sm font-medium">
                  {t("calendar.eventTitle")} <span className="text-red-500">*</span>
                </label>
                <input id="ev-title" maxLength={255} value={editing.v.title} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, title: e.target.value } })} className={`${input} ${error && !editing.v.title.trim() ? inputError : ""}`} />
              </div>
              <div>
                <label htmlFor="ev-start" className="mb-1 block text-sm font-medium">{t("calendar.start")}</label>
                <DateInput id="ev-start" value={editing.v.start_on} onChange={(d) => setEditing({ ...editing, v: { ...editing.v, start_on: d, end_on: editing.v.end_on < d ? d : editing.v.end_on } })} className={input} />
              </div>
              <div>
                <label htmlFor="ev-end" className="mb-1 block text-sm font-medium">{t("calendar.end")}</label>
                <DateInput id="ev-end" value={editing.v.end_on} min={editing.v.start_on || undefined} onChange={(d) => setEditing({ ...editing, v: { ...editing.v, end_on: d } })} className={input} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ev-note" className="mb-1 block text-sm font-medium">{t("calendar.note")}</label>
                <textarea id="ev-note" rows={3} maxLength={2000} value={editing.v.note} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, note: e.target.value } })} className={input} />
              </div>
              {/* ช่วงวันคร่อมเสาร์-อาทิตย์: เลือกไม่รวมเสาร์-อาทิตย์ได้ (ปฏิทินแสดงเฉพาะวันธรรมดา) */}
              {hasWeekend(editing.v.start_on, editing.v.end_on) && (
                <label className="flex cursor-pointer items-start gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={editing.v.skip_weekends}
                    onChange={(e) => setEditing({ ...editing, v: { ...editing.v, skip_weekends: e.target.checked } })}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent-500)]"
                  />
                  <span>
                    <span className="block font-medium">{t("calendar.skipWeekends")}</span>
                    <span className="block text-xs text-muted">{t("calendar.skipWeekendsHint")}</span>
                  </span>
                </label>
              )}
              {meta.can_manage && (
                <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={editing.v.all_company} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, all_company: e.target.checked } })} className="h-4 w-4 accent-[var(--accent-500)]" />
                  {t("calendar.allCompany")}
                </label>
              )}
            </fieldset>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} disabled={pending} className={btn.secondary}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={saveForm} disabled={pending} className={btn.primary}>
                {pending ? <SpinnerIcon /> : <SaveIcon />}
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
