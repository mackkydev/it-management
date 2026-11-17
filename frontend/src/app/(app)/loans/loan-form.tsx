"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLoan, type LoanValues } from "@/app/actions/loans";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan } from "@/lib/types";
import { endAt, startAt, TIME_OPTIONS } from "./loan-utils";

type Field = keyof LoanValues;

export const blankLoan = (date: string): LoanValues => ({ asset_id: "", purpose: "", note: "", start_on: date, start_time: "09:00", end_on: date, end_time: "17:00" });

/**
 * ขอยืม-จอง / แก้ไขคำขอยืมโน้ตบุ๊ก — ผู้ยืมเลือกแค่วันเวลา + วัตถุประสงค์ (เจ้าหน้าที่ IT เลือกเครื่องตอนเตรียมเครื่อง)
 * ใช้ทั้งในกล่อง ยืม-จอง (onDone) และหน้าแก้ไข (ไม่ส่ง onDone = ไปหน้าการยืมของฉัน) — API ตรวจซ้ำ (ไม่เกิน 90 วัน / ไม่ย้อนหลัง)
 */
export function LoanForm({
  id,
  initial,
  borrower,
  onDone,
  onCancel,
}: {
  id: string | null;
  initial: LoanValues;
  borrower: { name: string; department: string | null };
  onDone?: (loan: Loan) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const today = localToday();
  const [v, setV] = useState<LoanValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [saving, startSave] = useTransition();

  const set = <K extends Field>(k: K, value: LoanValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const datesOk = Boolean(v.start_on && v.end_on && v.end_on >= v.start_on && endAt(v) > startAt(v));

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.start_on || !v.end_on) e.start_on = t("loan.form.validate.dates");
    else if (!datesOk) e.end_time = t("loan.form.validate.order");
    if (!v.purpose.trim()) e.purpose = t("loan.form.validate.purpose");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    startSave(async () => {
      const res = await saveLoan(id, v);
      if (!res.ok || !res.loan) {
        setErrors(res.errors ?? {});
        setMessage(res.errors ? "" : (res.message ?? ""));
        return;
      }
      if (onDone) onDone(res.loan);
      else router.push("/loans/mine?done=1");
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;
  const timeSelect = (k: "start_time" | "end_time") => (
    <AppSelect id={k} value={v[k]} onValueChange={(x) => set(k, x)} className={cls(k)}>
      {TIME_OPTIONS.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </AppSelect>
  );

  return (
    <form action={submit} className="space-y-4">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={saving} className="grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2">
        <p className="text-sm text-muted sm:col-span-2">
          {t("loan.form.borrower")}: <span className="font-medium text-ink">{borrower.name}</span>
          {borrower.department ? ` · ${borrower.department}` : ""}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:col-span-2">
          <div>
            {label("start_on", t("loan.form.startOn"), true)}
            <DateInput id="start_on" value={v.start_on} min={id ? undefined : today} onChange={(d) => (set("start_on", d), !v.end_on || v.end_on < d ? set("end_on", d) : null)} className={cls("start_on")} />
            {err("start_on")}
          </div>
          <div>
            {label("start_time", t("loan.form.startTime"), true)}
            {timeSelect("start_time")}
          </div>
          <div>
            {label("end_on", t("loan.form.endOn"), true)}
            <DateInput id="end_on" value={v.end_on} min={v.start_on || undefined} onChange={(d) => set("end_on", d)} className={cls("end_on")} />
            {err("end_on")}
          </div>
          <div>
            {label("end_time", t("loan.form.endTime"), true)}
            {timeSelect("end_time")}
            {err("end_time")}
          </div>
        </div>
        {errors.asset_id && <p className="text-xs font-medium text-red-500 sm:col-span-2">{errors.asset_id}</p>}
        <div className="sm:col-span-2">
          {label("purpose", t("loan.form.purpose"), true)}
          <textarea id="purpose" rows={2} maxLength={2000} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder={t("loan.form.purposePlaceholder")} className={cls("purpose")} />
          {err("purpose")}
        </div>
        <div className="sm:col-span-2">
          {label("note", t("loan.form.note"))}
          <textarea id="note" rows={2} maxLength={2000} value={v.note} onChange={(e) => set("note", e.target.value)} className={cls("note")} />
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => (onCancel ? onCancel() : router.back())} disabled={saving} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={saving} className={btn.primary}>
          {saving ? <SpinnerIcon /> : <SaveIcon />}
          {t("loan.form.save")}
        </button>
      </div>
    </form>
  );
}
