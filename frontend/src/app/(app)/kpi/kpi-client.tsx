"use client";

import { useState, useTransition } from "react";
import { deleteKpi, saveKpi, type KpiResult } from "@/app/actions/kpi";
import { AlertIcon, CheckCircleIcon, PencilIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { DateInput } from "@/components/date-input";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday as todayIso } from "@/lib/date";

export interface KpiEntry {
  id: number;
  work_date: string;
  details: string;
  user: { id: number; name: string | null };
  can_edit: boolean;
  updated_at: string | null;
}

/** ฟอร์มบันทึก/แก้ไข KPI — วันที่ + textarea รายละเอียด */
export function KpiForm({ entry, onDone }: { entry?: KpiEntry; onDone?: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ work_date: entry?.work_date ?? todayIso(), details: entry?.details ?? "" });
  const [result, setResult] = useState<KpiResult>({});
  const [pending, start] = useTransition();
  const errors = result.errors ?? {};

  const set = (k: keyof typeof v, value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    setResult((r) => ({ ...r, errors: { ...r.errors, [k]: undefined }, message: undefined }));
  };

  const submit = () => {
    const e: KpiResult["errors"] = {};
    if (!v.work_date) e.work_date = t("kpi.validate.workDate");
    if (!v.details.trim()) e.details = t("kpi.validate.details");
    if (Object.keys(e).length) return setResult({ errors: e, message: t("common.checkInput") });

    start(async () => {
      const res = await saveKpi(entry?.id ?? null, v);
      setResult(res);
      if (res.ok) {
        if (entry) onDone?.();
        else setV({ work_date: todayIso(), details: "" });
      }
    });
  };

  return (
    <div className="space-y-4">
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <div>
          <label htmlFor={`work_date-${entry?.id ?? "new"}`} className="mb-1 block text-sm font-medium">
            {t("kpi.workDate")} <span className="text-red-500">*</span>
          </label>
          <DateInput
            id={`work_date-${entry?.id ?? "new"}`}
            max={todayIso()}
            value={v.work_date}
            onChange={(d) => set("work_date", d)}
            className={`${input} ${errors.work_date ? inputError : ""}`}
          />
          {errors.work_date && <p className="mt-1 text-xs font-medium text-red-500">{errors.work_date}</p>}
        </div>
        <div>
          <label htmlFor={`details-${entry?.id ?? "new"}`} className="mb-1 block text-sm font-medium">
            {t("kpi.details")} <span className="text-red-500">*</span>
          </label>
          <textarea
            id={`details-${entry?.id ?? "new"}`}
            rows={entry ? 4 : 5}
            maxLength={5000}
            value={v.details}
            placeholder={t("kpi.detailsPlaceholder")}
            onChange={(e) => set("details", e.target.value)}
            className={`${input} ${errors.details ? inputError : ""}`}
          />
          {errors.details && <p className="mt-1 text-xs font-medium text-red-500">{errors.details}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {entry && (
          <button type="button" onClick={onDone} disabled={pending} className={btn.secondary}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </button>
        )}
        <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {entry ? t("kpi.update") : t("kpi.save")}
        </button>
      </div>
    </div>
  );
}

/** รายการบันทึก 1 วัน — แก้ไข/ลบได้ถ้าเป็นเจ้าของ (หรือ admin) */
export function KpiItem({ entry, dateLabel, showUser }: { entry: KpiEntry; dateLabel: string; showUser: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const remove = () => {
    if (!confirm(t("kpi.confirmDelete", { date: dateLabel }))) return;
    start(async () => {
      const res = await deleteKpi(entry.id);
      if (!res.ok) setError(res.message ?? "");
    });
  };

  return (
    <li className={`p-4 sm:p-5 ${card}`}>
      {editing ? (
        <KpiForm entry={entry} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex gap-4">
          <div className="w-28 shrink-0">
            <p className="font-semibold text-accent-700 dark:text-accent-300">{dateLabel}</p>
            {showUser && <p className="mt-1 text-xs text-muted">{entry.user.name}</p>}
          </div>
          <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed">{entry.details}</p>
          {entry.can_edit && (
            <div className="flex shrink-0 items-start gap-1">
              <Tooltip label={t("common.edit")}>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={t("common.edit")}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  <PencilIcon width={15} height={15} />
                </button>
              </Tooltip>
              <Tooltip label={t("common.delete")}>
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  aria-label={t("common.delete")}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-100 hover:text-danger-600 disabled:cursor-not-allowed dark:hover:bg-danger-400/15"
                >
                  {pending ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-500">{error}</p>}
    </li>
  );
}
