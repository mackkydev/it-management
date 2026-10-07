"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteKpi, saveKpiEntry, saveKpiTicket, type KpiEntryValues, type KpiResult } from "@/app/actions/kpi";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CalendarIcon, DownloadIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { KpiMonth, KpiSheetRow } from "@/lib/types";
import { RequesterPicker } from "./requester-picker";
import { useConfirm } from "@/components/dialog-provider";

const cell = "px-3 py-2 align-top";
const small = `${input} px-2 py-1.5 text-sm`;

/* ---------------------------------------------------------------- export */

/** เลือกช่วงเดือนแล้วดาวน์โหลด .xlsx แบบเดียวกับไฟล์ KPI ต้นฉบับ (ชีตละเดือน) */
export function KpiExport({ months, defaultMonth, userId }: { months: { value: string; label: string }[]; defaultMonth: string; userId: number }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(defaultMonth);
  const [to, setTo] = useState(defaultMonth);
  const href = `/files/kpi/export?${new URLSearchParams({ from: from <= to ? from : to, to: from <= to ? to : from, user_id: String(userId) })}`;
  const options = months.map((m) => (
    <option key={m.value} value={m.value}>
      {m.label}
    </option>
  ));
  return (
    <div className="space-y-1.5 lg:border-l lg:border-line lg:pl-4">
      <p className="text-sm font-medium">{t("kpi.exportTitle")}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(2,minmax(0,11rem))_auto] sm:items-center">
        <AppSelect value={from} onValueChange={setFrom} className={input} aria-label={t("kpi.exportFrom")}>
          {options}
        </AppSelect>
        <AppSelect value={to} onValueChange={setTo} className={input} aria-label={t("kpi.exportTo")}>
          {options}
        </AppSelect>
        <a href={href} className={`${btn.soft} whitespace-nowrap`}>
          <DownloadIcon />
          {t("kpi.exportButton")}
        </a>
      </div>
      <p className="text-xs text-muted">{t("kpi.exportHint")}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- ตาราง */

interface SheetProps {
  sheet: KpiMonth;
  /** สาขาในระบบ (ช่องสาขาของแถวที่กรอกเอง) */
  branches: string[];
  monthText: string;
  canAdd: boolean;
  canEdit: boolean;
}

/** ชีต KPI รายเดือน — คอลัมน์ตามไฟล์ต้นฉบับ: วันที่แจ้ง … Complexity, Mark, วันที่แล้วเสร็จ + Total */
export function KpiSheet({ sheet, branches, monthText, canAdd, canEdit }: SheetProps) {
  const { t, fmt } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<"work" | "holiday" | null>(null);
  const { data, totals } = sheet;
  // วันตั้งต้นของแถวใหม่: วันนี้ถ้าอยู่ในเดือนที่ดู ไม่งั้นวันที่ 1 ของเดือน
  const today = localToday();
  const defaultDate = today.startsWith(sheet.month) ? today : `${sheet.month}-01`;
  const cols = 11;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          {t("kpi.sheetTitle", { name: sheet.user.name, month: monthText })}
          {!canEdit && <span className="ml-2 text-xs font-normal text-faint">{t("kpi.readOnly")}</span>}
        </h2>
        {canAdd && (
          <div className="flex gap-2">
            <button type="button" onClick={() => (setAdding("holiday"), setEditing(null))} className={`${btn.secondary} ${btn.sm}`}>
              <CalendarIcon width={14} height={14} />
              {t("kpi.addHoliday")}
            </button>
            <button type="button" onClick={() => (setAdding("work"), setEditing(null))} className={`${btn.primary} ${btn.sm}`}>
              <PlusIcon width={14} height={14} />
              {t("kpi.addRow")}
            </button>
          </div>
        )}
      </div>

      <div className={table.wrap}>
        <table className={`${table.table} min-w-[1400px]`}>
          <thead className={table.head}>
            <tr>
              <th className={`${cell} w-32`}>{t("kpi.col.date")}</th>
              <th className={`${cell} w-36`}>{t("kpi.col.requester")}</th>
              <th className={`${cell} w-28`}>{t("kpi.col.branch")}</th>
              <th className={`${cell} w-48`}>{t("kpi.col.serviceType")}</th>
              <th className={cell}>{t("kpi.col.details")}</th>
              <th className={`${cell} w-28`}>{t("kpi.col.assignee")}</th>
              <th className={cell}>{t("kpi.col.solution")}</th>
              <th className={`${cell} w-36`}>{t("kpi.col.complexity")}</th>
              <th className={`${cell} w-16 text-right`}>{t("kpi.col.mark")}</th>
              <th className={`${cell} w-32`}>{t("kpi.col.completed")}</th>
              <th className={`${cell} w-20`} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {data.length === 0 && !adding && (
              <tr>
                <td colSpan={cols} className="p-10 text-center text-muted">
                  {t("kpi.empty")}
                </td>
              </tr>
            )}
            {data.map((r) =>
              editing === r.key && r.entry_id ? (
                <EntryEditor key={r.key} sheet={sheet} branches={branches} kind={r.kind === "holiday" ? "holiday" : "work"} row={r} defaultDate={r.work_date} onDone={() => setEditing(null)} />
              ) : r.kind === "ticket" ? (
                <TicketRow key={r.key} row={r} sheet={sheet} />
              ) : (
                <EntryRow key={r.key} row={r} onEdit={() => (setEditing(r.key), setAdding(null))} />
              ),
            )}
            {adding && <EntryEditor sheet={sheet} branches={branches} kind={adding} defaultDate={defaultDate} onDone={() => setAdding(null)} />}
          </tbody>
          <tfoot className="border-t-2 border-line bg-subtle font-semibold">
            <tr>
              <td colSpan={7} className={`${cell} text-right`}>
                {t("kpi.total")}
              </td>
              <td className={`${cell} tabular-nums`}>{fmt.number(totals.complexity)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmt.number(totals.mark)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <ServiceTypeLegend sheet={sheet} />
    </div>
  );
}

/** คำอธิบายประเภทการแจ้ง (ชีต ServiceType ของไฟล์ต้นฉบับ) */
function ServiceTypeLegend({ sheet }: { sheet: KpiMonth }) {
  const { t } = useI18n();
  return (
    <details className={`group p-4 ${card}`}>
      <summary className="cursor-pointer list-none text-sm font-medium">{t("kpi.serviceTypes")}</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[12rem_1fr]">
        {sheet.service_types.map((s) => (
          <div key={s.name} className="contents">
            <dt className="font-medium">{s.name}</dt>
            <dd className="text-muted">{s.description}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-faint">{sheet.service_type_note}</p>
    </details>
  );
}

const dateText = (fmt: ReturnType<typeof useI18n>["fmt"], d: string | null) => (d ? fmt.date(d) : "-");

/** ตัวเลือก Complexity (แสดง Mark ที่ได้) — คืนเป็น <option> ตรง ๆ เพราะ AppSelect อ่านตัวเลือกจาก children */
function complexityOptions(sheet: KpiMonth, t: ReturnType<typeof useI18n>["t"], fmt: ReturnType<typeof useI18n>["fmt"]) {
  return sheet.complexity_values.map((c) => (
    <option key={c.value} value={String(c.value)}>
      {t("kpi.complexityOption", { value: fmt.number(c.value), mark: fmt.number(c.mark) })}
    </option>
  ));
}

/**
 * แถวใบแจ้งงาน — ข้อมูลจากใบงาน (อ่านอย่างเดียว) + ประเภทการแจ้ง / Complexity
 * ยังไม่เคยบันทึก = เลือกแล้วกด "บันทึก" / บันทึกแล้ว = แสดงค่า + ปุ่ม "แก้ไข" (แก้ภายหลังได้)
 */
function TicketRow({ row, sheet }: { row: KpiSheetRow; sheet: KpiMonth }) {
  const { t, fmt } = useI18n();
  const saved = row.entry_id !== null;
  const [editing, setEditing] = useState(!saved);
  const [serviceType, setServiceType] = useState(row.service_type ?? "");
  const [complexity, setComplexity] = useState(String(row.complexity));
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const pendingComplexity = row.complexity === 0;
  const canEditNow = row.can_edit && editing;
  const mark = canEditNow ? (sheet.complexity_values.find((c) => String(c.value) === complexity)?.mark ?? 0) : row.mark;

  const save = () =>
    start(async () => {
      const res = await saveKpiTicket(row.ticket!.id, { service_type: serviceType || undefined, complexity: Number(complexity) });
      if (res.ok) {
        setError("");
        setEditing(false);
      } else setError(res.message ?? "");
    });
  const cancel = () => {
    setServiceType(row.service_type ?? "");
    setComplexity(String(row.complexity));
    setError("");
    setEditing(false);
  };

  return (
    <tr className={`${table.row} ${canEditNow ? "bg-accent-50/60 dark:bg-accent-400/[0.06]" : pendingComplexity && row.can_edit ? "bg-warning-50/60 dark:bg-warning-400/[0.06]" : ""}`}>
      <td className={`${cell} whitespace-nowrap`}>{fmt.date(row.work_date)}</td>
      <td className={cell}>{row.requester ?? "-"}</td>
      <td className={cell}>{row.branch ?? "-"}</td>
      <td className={cell}>
        {canEditNow ? (
          <AppSelect value={serviceType} onValueChange={setServiceType} disabled={pending} className={small} aria-label={t("kpi.col.serviceType")}>
            {sheet.service_types.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </AppSelect>
        ) : (
          (row.service_type ?? "-")
        )}
      </td>
      <td className={cell}>
        <Tooltip label={t("kpi.ticketHint")} side="top">
          <Link href={`/tickets/${row.ticket!.id}`} className={`mb-1 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-xs font-medium ${tone.info.badge}`}>
            {row.ticket!.ticket_no}
          </Link>
        </Tooltip>
        <p className="whitespace-pre-line">{row.details}</p>
      </td>
      <td className={cell}>{row.assignee ?? "-"}</td>
      <td className={`${cell} whitespace-pre-line`}>{row.solution ?? "-"}</td>
      <td className={cell}>
        {canEditNow ? (
          <AppSelect value={complexity} onValueChange={setComplexity} disabled={pending} className={small} aria-label={t("kpi.col.complexity")}>
            {complexityOptions(sheet, t, fmt)}
          </AppSelect>
        ) : (
          <span className="tabular-nums">{fmt.number(row.complexity)}</span>
        )}
        {!canEditNow && pendingComplexity && row.can_edit && <p className="mt-1 text-xs text-warning-700 dark:text-warning-300">{t("kpi.complexityPending")}</p>}
        {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
      </td>
      <td className={`${cell} text-right tabular-nums`}>{fmt.number(mark)}</td>
      <td className={`${cell} whitespace-nowrap`}>{dateText(fmt, row.completed_date)}</td>
      <td className={cell}>
        {row.can_edit &&
          (canEditNow ? (
            <div className="flex justify-end gap-1">
              {saved && (
                <IconButton label={t("common.cancel")} onClick={cancel} disabled={pending}>
                  <XIcon width={14} height={14} />
                </IconButton>
              )}
              <Tooltip label={t("kpi.save")} side="top">
                <button type="button" onClick={save} disabled={pending} aria-label={t("kpi.save")} className={`${btn.primary} ${btn.sm} h-8 px-2.5`}>
                  {pending ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="flex justify-end">
              <IconButton label={t("common.edit")} onClick={() => setEditing(true)}>
                <PencilIcon width={14} height={14} />
              </IconButton>
            </div>
          ))}
      </td>
    </tr>
  );
}

/** แถวที่กรอกเอง / วันหยุด (แสดงผล) */
function EntryRow({ row, onEdit }: { row: KpiSheetRow; onEdit: () => void }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const remove = async () => {
    if (!(await confirm(t("kpi.confirmDelete", { date: fmt.date(row.work_date) })))) return;
    start(async () => {
      const res = await deleteKpi(row.entry_id!);
      if (!res.ok) setError(res.message ?? "");
    });
  };
  const actions = row.can_edit && (
    <div className="flex justify-end gap-1">
      <IconButton label={t("common.edit")} onClick={onEdit}>
        <PencilIcon width={14} height={14} />
      </IconButton>
      <IconButton label={t("common.delete")} onClick={remove} danger disabled={pending}>
        {pending ? <SpinnerIcon width={14} height={14} /> : <TrashIcon width={14} height={14} />}
      </IconButton>
    </div>
  );

  if (row.kind === "holiday") {
    return (
      <tr className="bg-subtle/70">
        <td className={`${cell} whitespace-nowrap`}>{fmt.date(row.work_date)}</td>
        {/* วันหยุด: รวมช่อง ผู้แจ้ง–วิธีการแก้ไข เหมือนไฟล์ต้นฉบับ (B:G) */}
        <td colSpan={6} className={`${cell} font-medium text-muted`}>
          {row.details}
          {error && <span className="ml-2 text-xs font-medium text-red-500">{error}</span>}
        </td>
        <td className={`${cell} tabular-nums`}>0</td>
        <td className={`${cell} text-right tabular-nums`}>0</td>
        <td className={cell} />
        <td className={cell}>{actions}</td>
      </tr>
    );
  }
  return (
    <tr className={table.row}>
      <td className={`${cell} whitespace-nowrap`}>{fmt.date(row.work_date)}</td>
      <td className={cell}>{row.requester ?? "-"}</td>
      <td className={cell}>{row.branch ?? "-"}</td>
      <td className={cell}>{row.service_type ?? "-"}</td>
      <td className={`${cell} whitespace-pre-line`}>
        {row.details}
        {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
      </td>
      <td className={cell}>{row.assignee ?? "-"}</td>
      <td className={`${cell} whitespace-pre-line`}>{row.solution ?? "-"}</td>
      <td className={`${cell} tabular-nums`}>{fmt.number(row.complexity)}</td>
      <td className={`${cell} text-right tabular-nums`}>{fmt.number(row.mark)}</td>
      <td className={`${cell} whitespace-nowrap`}>{dateText(fmt, row.completed_date)}</td>
      <td className={cell}>{actions}</td>
    </tr>
  );
}

function IconButton({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors disabled:cursor-not-allowed ${
          danger ? "hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-400/15" : "hover:bg-subtle hover:text-ink"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** แถวแก้ไข/เพิ่ม — งานที่ไม่มีใบแจ้งงาน (ทุกช่อง) หรือวันหยุด (วันที่ + ชื่อวันหยุด) */
function EntryEditor({
  sheet,
  branches,
  kind,
  row,
  defaultDate,
  onDone,
}: {
  sheet: KpiMonth;
  branches: string[];
  kind: "work" | "holiday";
  row?: KpiSheetRow;
  defaultDate: string;
  onDone: () => void;
}) {
  const { t, fmt } = useI18n();
  const [v, setV] = useState({
    work_date: row?.work_date ?? defaultDate,
    requester_name: row?.requester ?? "",
    branch_name: row?.branch ?? "",
    service_type: row?.service_type ?? "",
    details: row?.details ?? "",
    solution: row?.solution ?? "",
    complexity: row ? String(row.complexity) : "",
    completed_date: row?.completed_date ?? "",
  });
  const [result, setResult] = useState<KpiResult>({});
  const [pending, start] = useTransition();
  const errors = result.errors ?? {};
  const mark = sheet.complexity_values.find((c) => String(c.value) === v.complexity)?.mark ?? 0;

  const set = (k: keyof typeof v, value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    setResult((r) => ({ ...r, errors: { ...r.errors, [k]: undefined }, message: undefined }));
  };
  const cls = (k: keyof typeof v) => `${small} ${errors[k] ? inputError : ""}`;
  const err = (k: keyof typeof v) => errors[k] && <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p>;

  const submit = () => {
    const e: KpiResult["errors"] = {};
    if (!v.work_date) e.work_date = t("kpi.validate.workDate");
    if (!v.details.trim()) e.details = kind === "holiday" ? t("kpi.validate.holiday") : t("kpi.validate.details");
    if (Object.keys(e).length) return setResult({ errors: e, message: t("common.checkInput") });
    const values: KpiEntryValues = { entry_type: kind, ...v, user_id: sheet.user.id };
    start(async () => {
      const res = await saveKpiEntry(row?.entry_id ?? null, values);
      if (res.ok) onDone();
      else setResult(res);
    });
  };

  const buttons = (
    <div className="flex justify-end gap-1">
      <IconButton label={t("common.cancel")} onClick={onDone} disabled={pending}>
        <XIcon width={14} height={14} />
      </IconButton>
      <Tooltip label={t("kpi.save")} side="top">
        <button type="button" onClick={submit} disabled={pending} aria-label={t("kpi.save")} className={`${btn.primary} ${btn.sm} h-8 px-2.5`}>
          {pending ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
        </button>
      </Tooltip>
    </div>
  );
  const message = result.message && !result.ok && (
    <tr>
      <td colSpan={11} className="px-3 pb-3">
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {result.message}
        </p>
      </td>
    </tr>
  );
  const dateCell = (
    <td className={cell}>
      <DateInput value={v.work_date} max={kind === "work" ? localToday() : undefined} onChange={(d) => set("work_date", d)} className={cls("work_date")} aria-label={t("kpi.col.date")} />
      {err("work_date")}
    </td>
  );

  if (kind === "holiday") {
    return (
      <>
        <tr className="bg-accent-50/60 dark:bg-accent-400/[0.06]">
          {dateCell}
          <td colSpan={6} className={cell}>
            <input
              value={v.details}
              maxLength={5000}
              placeholder={t("kpi.holidayPlaceholder")}
              onChange={(e) => set("details", e.target.value)}
              className={cls("details")}
              aria-label={t("kpi.holidayName")}
            />
            {err("details")}
          </td>
          <td className={`${cell} tabular-nums`}>0</td>
          <td className={`${cell} text-right tabular-nums`}>0</td>
          <td className={cell} />
          <td className={cell}>{buttons}</td>
        </tr>
        {message}
      </>
    );
  }

  return (
    <>
      <tr className="bg-accent-50/60 dark:bg-accent-400/[0.06]">
        {dateCell}
        <td className={cell}>
          <RequesterPicker
            value={v.requester_name}
            onChange={(name) => set("requester_name", name)}
            onPick={(p) => {
              set("requester_name", p.name);
              if (p.branch) set("branch_name", p.branch.name);
            }}
            className={cls("requester_name")}
            ariaLabel={t("kpi.col.requester")}
          />
          {err("requester_name")}
        </td>
        <td className={cell}>
          <AppSelect value={v.branch_name} onValueChange={(x) => set("branch_name", x)} className={cls("branch_name")} aria-label={t("kpi.col.branch")}>
            <option value="">{t("kpi.noBranch")}</option>
            {/* ค่าเดิมที่ไม่มีในรายการสาขาแล้ว (เช่น สาขาถูกเปลี่ยนชื่อ) ยังเลือกค้างไว้ได้ */}
            {[...(v.branch_name && !branches.includes(v.branch_name) ? [v.branch_name] : []), ...branches].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </AppSelect>
          {err("branch_name")}
        </td>
        <td className={cell}>
          <AppSelect value={v.service_type} onValueChange={(x) => set("service_type", x)} className={cls("service_type")} aria-label={t("kpi.col.serviceType")}>
            <option value="">{t("kpi.noServiceType")}</option>
            {sheet.service_types.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </AppSelect>
          {err("service_type")}
        </td>
        <td className={cell}>
          <textarea rows={2} value={v.details} maxLength={5000} onChange={(e) => set("details", e.target.value)} className={cls("details")} aria-label={t("kpi.col.details")} />
          {err("details")}
        </td>
        <td className={`${cell} text-muted`}>{sheet.user.name}</td>
        <td className={cell}>
          <textarea rows={2} value={v.solution} maxLength={5000} onChange={(e) => set("solution", e.target.value)} className={cls("solution")} aria-label={t("kpi.col.solution")} />
          {err("solution")}
        </td>
        <td className={cell}>
          <AppSelect value={v.complexity} onValueChange={(x) => set("complexity", x)} className={cls("complexity")} aria-label={t("kpi.col.complexity")}>
            <option value="">{t("kpi.noServiceType")}</option>
            {complexityOptions(sheet, t, fmt)}
          </AppSelect>
          {err("complexity")}
        </td>
        <td className={`${cell} text-right tabular-nums`}>{fmt.number(mark)}</td>
        <td className={cell}>
          <DateInput value={v.completed_date} min={v.work_date || undefined} onChange={(d) => set("completed_date", d)} className={cls("completed_date")} aria-label={t("kpi.col.completed")} />
          {err("completed_date")}
        </td>
        <td className={cell}>{buttons}</td>
      </tr>
      {message}
    </>
  );
}
