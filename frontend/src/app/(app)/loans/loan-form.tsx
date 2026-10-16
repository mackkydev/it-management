"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { loadLoans, saveLoan, type LoanValues } from "@/app/actions/loans";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan, LoanDevice } from "@/lib/types";
import { endAt, overlaps, startAt, TIME_OPTIONS } from "./loan-utils";

type Field = keyof LoanValues;

/**
 * จอง / แก้ไขการยืมอุปกรณ์ IT — เลือกวันเวลารับ-คืนก่อน แล้วเลือกอุปกรณ์ (อุปกรณ์ที่ถูกจองซ้อนช่วงนั้นเลือกไม่ได้)
 * API ตรวจซ้ำ (ช่วงซ้อน / อุปกรณ์ที่ให้ยืมได้ / ไม่เกิน 90 วัน)
 */
export function LoanForm({ id, initial, devices, borrower }: { id: string | null; initial: LoanValues; devices: LoanDevice[]; borrower: { name: string; department: string | null } }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const today = localToday();
  const [v, setV] = useState<LoanValues>(initial);
  const [range, setRange] = useState<Loan[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [saving, startSave] = useTransition();
  const [checking, startCheck] = useTransition();

  const set = <K extends Field>(k: K, value: LoanValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const datesOk = Boolean(v.start_on && v.end_on && v.end_on >= v.start_on && endAt(v) > startAt(v));

  // วันเวลาเปลี่ยน → โหลดการยืมช่วงนั้นมาตรวจอุปกรณ์ว่าง
  useEffect(() => {
    if (!v.start_on || !v.end_on || v.end_on < v.start_on) return;
    startCheck(async () => setRange(await loadLoans(v.start_on, v.end_on)));
  }, [v.start_on, v.end_on]);

  /** การยืมของอุปกรณ์นั้นที่ซ้อนช่วงที่เลือก (ไม่นับรายการนี้เอง / ยกเลิก / คืนแล้ว) */
  const clashOf = (assetId: number) =>
    datesOk ? range.find((l) => l.id !== id && l.asset.id === assetId && (l.status === "reserved" || l.status === "on_loan") && overlaps(l, v)) : undefined;

  const pickDevice = (value: string) => {
    const clash = value ? clashOf(Number(value)) : undefined;
    if (clash) return setErrors((e) => ({ ...e, asset_id: t("loan.form.validate.busy") }));
    set("asset_id", value);
  };

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.start_on || !v.end_on) e.start_on = t("loan.form.validate.dates");
    else if (!datesOk) e.end_time = t("loan.form.validate.order");
    if (!v.asset_id) e.asset_id = t("loan.form.validate.device");
    else if (clashOf(Number(v.asset_id))) e.asset_id = t("loan.form.validate.busy");
    if (!v.purpose.trim()) e.purpose = t("loan.form.validate.purpose");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    startSave(async () => {
      const res = await saveLoan(id, v);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors ? "" : (res.message ?? ""));
        return;
      }
      router.push("/loans/mine?done=1");
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
  const deviceText = (d: LoanDevice) => {
    const base = `${d.asset_tag} · ${d.name}${d.brand || d.model ? ` (${[d.brand, d.model].filter(Boolean).join(" ")})` : ""}`;
    if (clashOf(d.id)) return `${base} — ${t("loan.form.busy")}`;
    if (d.on_loan) return `${base} — ${t("loan.form.onLoanNow", { name: d.on_loan.user })}`;
    return base;
  };

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={saving} className={`grid grid-cols-1 gap-4 p-5 disabled:opacity-60 sm:grid-cols-2 ${card}`}>
        <div className="sm:col-span-2">
          <p className="text-sm text-muted">
            {t("loan.form.borrower")}: <span className="font-medium text-ink">{borrower.name}</span>
            {borrower.department ? ` · ${borrower.department}` : ""}
          </p>
        </div>
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
        <div className="sm:col-span-2">
          {label("asset_id", t("loan.form.device"), true)}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <AppSelect id="asset_id" value={v.asset_id} onValueChange={pickDevice} disabled={!datesOk} className={cls("asset_id")}>
                <option value="">{datesOk ? t("loan.form.deviceChoose") : t("loan.form.deviceFirst")}</option>
                {devices.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {deviceText(d)}
                  </option>
                ))}
              </AppSelect>
            </div>
            {checking && <SpinnerIcon className="shrink-0 text-accent-400" />}
          </div>
          {err("asset_id")}
          {datesOk && v.asset_id && <p className="mt-1 text-xs text-muted">{t("loan.form.pickupHint", { start: `${fmt.date(v.start_on)} ${v.start_time}`, end: `${fmt.date(v.end_on)} ${v.end_time}` })}</p>}
        </div>
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
        <button type="button" onClick={() => router.back()} disabled={saving} className={btn.secondary}>
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
