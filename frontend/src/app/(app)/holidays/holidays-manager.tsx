"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { searchUsers } from "@/app/actions/assets";
import {
  copyHolidayYear,
  deleteHoliday,
  deleteHolidayCalendar,
  importHolidays,
  saveHoliday,
  saveHolidayCalendar,
  saveLeaveQuota,
  saveLeaveSettings,
  type HolidayImportResult,
} from "@/app/actions/calendar";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, CopyIcon, DownloadIcon, PencilIcon, PlusIcon, SaveIcon, SettingsIcon, SpinnerIcon, TrashIcon, UploadIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import { LEAVE_TYPES, type CompanyHoliday, type HolidayCalendar, type LeaveSettings, type LeaveType, type UserOption } from "@/lib/types";

type Tab = "list" | "settings" | "quotas";
const TAB_CLS = (active: boolean) =>
  `cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
const WEEK = [0, 1, 2, 3, 4, 5, 6];

/**
 * ทุกคนดูรายการวันหยุดได้ — แยกแท็บตามปฏิทินวันหยุด (เช่น กรุงเทพ / สาขา) เปิดที่ชุดของสาขาผู้ใช้ก่อน
 * เพิ่ม/แก้/นำเข้า, ตั้งค่าชุด, ตั้งค่าการลา, โควตา เฉพาะผู้มีสิทธิ์ holidays.manage (เช่น กลุ่ม HR)
 */
export function HolidaysManager({
  year,
  holidays,
  calendars,
  calendarId,
  settings,
  quotas,
  canManage,
}: {
  year: number;
  holidays: CompanyHoliday[];
  calendars: HolidayCalendar[];
  calendarId: number | null;
  settings: LeaveSettings | null;
  quotas: {
    user: { id: number; name: string };
    leave_type: string;
    days: number;
  }[];
  canManage: boolean;
}) {
  const { t, fmt, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("list");
  const yearText = (y: number) => fmt.date(`${y}-01-01`).slice(-4);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canManage ? (
          <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
            {(["list", "settings", "quotas"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={TAB_CLS(tab === k)}>
                {t(`holidays.tabs.${k}`)}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {tab !== "settings" && (
          <div className="flex items-center gap-1">
            {[year - 1, year, year + 1].map((y) => (
              <Link key={y} href={`/holidays?year=${y}${calendarId ? `&calendar=${calendarId}` : ""}`} className={`${btn.sm} ${y === year ? btn.soft : btn.secondary}`}>
                {yearText(y)}
              </Link>
            ))}
          </div>
        )}
      </div>
      {tab === "list" && <HolidayList year={year} holidays={holidays} calendars={calendars} calendarId={calendarId} yearText={yearText} canManage={canManage} />}
      {tab === "settings" && settings && (
        <LeaveSettingsForm
          initial={settings}
          weekday={(d) =>
            new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
              weekday: "short",
              timeZone: "UTC",
            }).format(new Date(Date.UTC(2023, 0, 1 + d)))
          }
        />
      )}
      {tab === "quotas" && settings && <QuotaEditor year={year} quotas={quotas} defaults={settings.quotas} />}
    </div>
  );
}

/* ---------------------------------------------------------------- วันหยุด */

function HolidayList({
  year,
  holidays,
  calendars,
  calendarId,
  yearText,
  canManage,
}: {
  year: number;
  holidays: CompanyHoliday[];
  calendars: HolidayCalendar[];
  calendarId: number | null;
  yearText: (y: number) => string;
  canManage: boolean;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{
    id: number | null;
    date: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = calendars.find((c) => c.id === calendarId);
  const today = localToday();

  const save = () => {
    if (!editing) return;
    if (!editing.date) return setError(t("holidays.dateRequired"));
    if (!editing.name.trim()) return setError(t("holidays.nameRequired"));
    start(async () => {
      const res = await saveHoliday(editing.id, calendarId, editing.date, editing.name);
      if (res.ok) setEditing(null);
      else setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
    });
  };
  const remove = async (h: CompanyHoliday) => {
    if (!(await confirm(t("holidays.confirmDelete", { name: h.name })))) return;
    start(async () => void (await deleteHoliday(h.id)));
  };

  return (
    <div className="space-y-3">
      {/* ปฏิทินวันหยุดแต่ละชุด (ตามประกาศ) — แท็บที่เลือกไว้ = ชุดของสาขาผู้ใช้ */}
      {calendars.length > 0 && (
        <div className="space-y-2">
          <div role="tablist" aria-label={t("holidays.calendars")} className="flex flex-wrap gap-2">
            {calendars.map((c) => (
              <Link
                key={c.id}
                role="tab"
                aria-selected={c.id === calendarId}
                href={`/holidays?year=${year}&calendar=${c.id}`}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition-colors ${c.id === calendarId ? "bg-accent-500 text-white ring-accent-500" : "bg-surface text-muted ring-line hover:text-ink"}`}
              >
                {c.name}
              </Link>
            ))}
          </div>
          {current && (
            <p className="text-xs text-muted">
              {t("holidays.usedBy", { branches: current.branches.map((b) => b.name).join(", ") || "-" })}
              {current.is_default && <span className={`ml-2 rounded-full px-2 py-0.5 ${tone.info.badge}`}>{t("holidays.defaultCalendar")}</span>}
            </p>
          )}
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => (setEditing({ id: null, date: `${year}-01-01`, name: "" }), setError(""))} className={btn.primary}>
            <PlusIcon />
            {t("holidays.add")}
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className={btn.secondary}>
            <UploadIcon />
            {t("holidays.import")}
          </button>
          <button type="button" disabled={pending} onClick={() => start(async () => setFeedback((await copyHolidayYear(calendarId, year - 1, year)).message ?? ""))} className={btn.secondary}>
            <CopyIcon />
            {t("holidays.copyFrom", { year: yearText(year - 1) })}
          </button>
          <button type="button" onClick={() => setCalendarsOpen(true)} className={`${btn.secondary} ml-auto`}>
            <SettingsIcon />
            {t("holidays.manageCalendars")}
          </button>
        </div>
      )}
      {feedback && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {feedback}
        </p>
      )}
      {editing && (
        <div className={`grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[12rem_1fr_auto] ${card}`}>
          <div>
            <label htmlFor="h-date" className="mb-1 block text-sm font-medium">
              {t("holidays.date")}
            </label>
            <DateInput id="h-date" value={editing.date} onChange={(d) => setEditing({ ...editing, date: d })} className={input} />
          </div>
          <div>
            <label htmlFor="h-name" className="mb-1 block text-sm font-medium">
              {t("holidays.name")}
            </label>
            <input
              id="h-name"
              maxLength={255}
              value={editing.name}
              onChange={(e) => (setEditing({ ...editing, name: e.target.value }), setError(""))}
              className={`${input} ${error ? inputError : ""}`}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className={btn.secondary} aria-label={t("common.cancel")}>
              <XIcon />
            </button>
            <button type="button" onClick={save} disabled={pending} className={btn.primary}>
              {pending ? <SpinnerIcon /> : <SaveIcon />}
              {t("common.save")}
            </button>
          </div>
          {error && <p className="text-xs font-medium text-red-500 sm:col-span-3">{error}</p>}
        </div>
      )}
      {holidays.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("holidays.empty")}</div>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={`${table.th} w-48`}>{t("holidays.date")}</th>
                <th className={table.th}>{t("holidays.name")}</th>
                {canManage && <th className={`${table.th} w-28`} aria-label={t("common.manage")} />}
              </tr>
            </thead>
            <tbody className={table.body}>
              {holidays.map((h) => (
                // วันหยุดที่ผ่านไปแล้ว = สีเทา
                <tr key={h.id} className={`${table.row} ${h.date < today ? "text-faint" : ""}`}>
                  <td className={`${table.td} whitespace-nowrap`}>{fmt.date(h.date)}</td>
                  <td className={table.td}>{h.name}</td>
                  {canManage && (
                    <td className={`${table.td} whitespace-nowrap text-right`}>
                      <button
                        type="button"
                        onClick={() => (setEditing({ id: h.id, date: h.date, name: h.name }), setError(""))}
                        aria-label={t("common.edit")}
                        className={`${btn.soft} ${btn.sm} mr-1 px-2`}
                      >
                        <PencilIcon width={13} height={13} />
                      </button>
                      <button type="button" onClick={() => remove(h)} disabled={pending} aria-label={t("common.delete")} className={`${btn.danger} ${btn.sm} px-2`}>
                        <TrashIcon width={13} height={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importOpen && <ImportDialog year={year} onClose={() => setImportOpen(false)} />}
      {calendarsOpen && <CalendarsDialog calendars={calendars} onClose={() => setCalendarsOpen(false)} />}
    </div>
  );
}

/** ตั้งค่าปฏิทินวันหยุด: ชื่อชุด + สาขาที่ใช้ + ชุดตั้งต้น (สาขาที่ไม่ได้เลือก / ผู้ใช้ไม่มีสาขา) */
function CalendarsDialog({ calendars, onClose }: { calendars: HolidayCalendar[]; onClose: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const branches = calendars.flatMap((c) => c.branches).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const [rows, setRows] = useState(calendars.map((c) => ({ id: c.id as number | null, name: c.name, is_default: c.is_default, branch_ids: c.branches.map((b) => b.id) })));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (i: number, v: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...v } : x)));
  // สาขาหนึ่งใช้ได้ชุดเดียว — ติ๊กในชุดนี้ = เอาออกจากชุดอื่น
  const toggleBranch = (i: number, id: number) =>
    setRows((r) =>
      r.map((x, j) =>
        j === i ? { ...x, branch_ids: x.branch_ids.includes(id) ? x.branch_ids.filter((b) => b !== id) : [...x.branch_ids, id] } : { ...x, branch_ids: x.branch_ids.filter((b) => b !== id) },
      ),
    );
  const saveAll = () =>
    start(async () => {
      if (rows.some((r) => !r.name.trim())) return setError(t("holidays.calendarNameRequired"));
      // ชุดตั้งต้นบันทึกก่อน (สาขาที่เอาออกจากชุดอื่นจะกลับไปชุดตั้งต้น)
      for (const r of [...rows].sort((a, b) => Number(b.is_default) - Number(a.is_default))) {
        const res = await saveHolidayCalendar(r.id, { name: r.name, branch_ids: r.branch_ids, is_default: r.is_default });
        if (!res.ok) return setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
      }
      onClose();
    });
  const remove = async (i: number) => {
    const r = rows[i];
    if (r.id && !(await confirm(t("holidays.confirmDeleteCalendar", { name: r.name })))) return;
    if (!r.id) return setRows((x) => x.filter((_, j) => j !== i));
    start(async () => {
      const res = await deleteHolidayCalendar(r.id!);
      if (res.ok) setRows((x) => x.filter((_, j) => j !== i));
      else setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
    });
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t("holidays.manageCalendars")}</h3>
            <p className="mt-1 text-sm text-muted">{t("holidays.calendarsHint")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="space-y-2 rounded-xl p-3 ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-2">
              <input value={r.name} maxLength={100} onChange={(e) => set(i, { name: e.target.value })} aria-label={t("holidays.calendarName")} className={`${input} max-w-xs`} />
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="radio" name="default-calendar" checked={r.is_default} onChange={() => setRows((x) => x.map((y, j) => ({ ...y, is_default: j === i })))} className="accent-[var(--accent-500)]" />
                {t("holidays.defaultCalendar")}
              </label>
              {!r.is_default && (
                <button type="button" onClick={() => remove(i)} disabled={pending} aria-label={t("common.delete")} className={`${btn.danger} ${btn.sm} ml-auto px-2`}>
                  <TrashIcon width={13} height={13} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => (
                <label key={b.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ${r.branch_ids.includes(b.id) ? tone.info.badge + " ring-transparent" : "text-muted ring-line"}`}>
                  <input type="checkbox" checked={r.branch_ids.includes(b.id)} onChange={() => toggleBranch(i, b.id)} className="h-3.5 w-3.5 accent-[var(--accent-500)]" />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => [...r, { id: null, name: "", is_default: false, branch_ids: [] }])} className={`${btn.secondary} ${btn.sm}`}>
          <PlusIcon width={14} height={14} />
          {t("holidays.addCalendar")}
        </button>
        {error && <p className="text-xs font-medium text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={btn.secondary}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={saveAll} disabled={pending} className={btn.primary}>
            {pending ? <SpinnerIcon /> : <SaveIcon />}
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({ year, onClose }: { year: number; onClose: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<HolidayImportResult | null>(null);
  const [pending, start] = useTransition();
  const submit = async () => {
    // ยืนยันก่อนอัปโหลด (ไม่มีไฟล์ = ให้ API แจ้งเตือนตามเดิม)
    if (file && !(await confirm(t("common.confirmImport", { name: file.name }), { title: t("common.confirmImportTitle"), confirmText: t("common.importConfirm"), danger: false }))) return;
    start(async () => {
      const form = new FormData();
      if (file) form.set("file", file);
      setResult(await importHolidays(form));
    });
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`w-full max-w-lg space-y-4 p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t("holidays.importTitle")}</h3>
            <p className="mt-1 text-sm text-muted">{t("holidays.importHint")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        <a href={`/files/holidays/import-template?year=${year}`} className={`${btn.soft} ${btn.sm} w-fit`}>
          <DownloadIcon width={14} height={14} />
          {t("holidays.template")}
        </a>
        <div>
          <label htmlFor="h-file" className="mb-1 block text-sm font-medium">
            {t("holidays.file")}
          </label>
          <input
            id="h-file"
            type="file"
            accept=".xlsx"
            onChange={(e) => (setFile(e.target.files?.[0] ?? null), setResult(null))}
            className={`${input} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-accent-800 hover:file:bg-accent-200 dark:file:bg-accent-400/15 dark:file:text-accent-200`}
          />
        </div>
        {result && (
          <div className={result.ok ? alert.success : alert.error}>
            {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
            <div>
              <p>
                {result.ok
                  ? t("holidays.importSuccess", {
                      created: result.created,
                      updated: result.updated,
                    })
                  : result.message}
              </p>
              {!result.ok && result.rows.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {result.rows.map((r, i) => (
                    <li key={i}>
                      {r.row > 0 && `${t("holidays.row", { row: r.row })}: `}
                      {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {t("common.close")}
          </button>
          <button type="button" onClick={submit} disabled={pending || !file} className={btn.primary}>
            {pending ? <SpinnerIcon /> : <UploadIcon />}
            {t("holidays.import")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- ตั้งค่าการลา */

function LeaveSettingsForm({ initial, weekday }: { initial: LeaveSettings; weekday: (d: number) => string }) {
  const { t } = useI18n();
  const [quotas, setQuotas] = useState<Record<LeaveType, string>>(
    Object.fromEntries(LEAVE_TYPES.map((k) => [k, initial.quotas[k] === null ? "" : String(initial.quotas[k])])) as Record<LeaveType, string>,
  );
  const [cert, setCert] = useState(String(initial.sick_cert_days));
  const [days, setDays] = useState<number[]>(initial.work_days);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  const save = () =>
    start(async () =>
      setResult(
        await saveLeaveSettings({
          quotas: Object.fromEntries(LEAVE_TYPES.map((k) => [k, quotas[k].trim() === "" ? null : Number(quotas[k])])) as LeaveSettings["quotas"],
          sick_cert_days: Number(cert) || 0,
          work_days: days,
        }),
      ),
    );
  return (
    <section className={`space-y-5 p-4 sm:p-6 ${card}`}>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}
      <div>
        <h3 className="font-semibold">{t("holidays.quotaTitle")}</h3>
        <p className="mb-3 text-xs text-muted">{t("holidays.quotaHint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LEAVE_TYPES.map((k) => (
            <label key={k} className="text-sm">
              <span className="mb-1 block font-medium">{t(`leave.types.${k}`)}</span>
              <input
                type="number"
                min={0}
                max={365}
                step={0.5}
                value={quotas[k]}
                onChange={(e) => setQuotas({ ...quotas, [k]: e.target.value })}
                placeholder={t("leave.unlimited")}
                className={input}
              />
            </label>
          ))}
        </div>
      </div>
      <label className="block max-w-sm text-sm">
        <span className="mb-1 block font-medium">{t("holidays.certDays")}</span>
        <input type="number" min={0} max={60} value={cert} onChange={(e) => setCert(e.target.value)} className={input} />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("holidays.workDays")}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK.map((d) => (
            <label
              key={d}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ${days.includes(d) ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10" : "ring-line"}`}
            >
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={() => setDays((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d].sort()))}
                className="accent-[var(--accent-500)]"
              />
              {weekday(d)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending || days.length === 0} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- โควตารายคน */

function QuotaEditor({
  year,
  quotas,
  defaults,
}: {
  year: number;
  quotas: {
    user: { id: number; name: string };
    leave_type: string;
    days: number;
  }[];
  defaults: LeaveSettings["quotas"];
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<UserOption[]>([]);
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [values, setValues] = useState<Record<LeaveType, string>>({
    sick: "",
    personal: "",
    vacation: "",
    other: "",
  });
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const people = [...new Map(quotas.map((q) => [q.user.id, q.user])).values()];
  const pick = (u: { id: number; name: string }) => {
    setUser(u);
    setFound([]);
    setQuery("");
    setSaved("");
    setValues(Object.fromEntries(LEAVE_TYPES.map((k) => [k, String(quotas.find((q) => q.user.id === u.id && q.leave_type === k)?.days ?? "")])) as Record<LeaveType, string>);
  };
  const save = () =>
    user &&
    start(async () => {
      for (const k of LEAVE_TYPES) await saveLeaveQuota(user.id, year, k, values[k]);
      setSaved(t("holidays.quotaSaved"));
    });
  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <p className="text-sm text-muted">{t("holidays.quotasHint")}</p>
      <div className="relative max-w-md">
        <input
          value={query}
          placeholder={t("assets.form.custodianPlaceholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            const q = e.target.value;
            if (q.trim().length >= 1) start(async () => setFound(await searchUsers(q)));
          }}
          className={input}
          aria-label={t("holidays.user")}
        />
        {found.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
            {found.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => pick(u)} className="w-full cursor-pointer px-3 py-2 text-left hover:bg-subtle">
                  {u.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {people.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p)} className={`${btn.soft} ${btn.sm}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      {user && (
        <div className="space-y-3 rounded-xl p-4 ring-1 ring-line">
          <p className="font-medium">{user.name}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LEAVE_TYPES.map((k) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block font-medium">{t(`leave.types.${k}`)}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  step={0.5}
                  value={values[k]}
                  placeholder={defaults[k] === null ? t("leave.unlimited") : String(defaults[k])}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  className={input}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-success-600">{saved}</span>}
            <button type="button" onClick={save} disabled={pending} className={btn.primary}>
              {pending ? <SpinnerIcon /> : <SaveIcon />}
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
