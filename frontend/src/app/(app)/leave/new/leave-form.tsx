"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { previewLeaveDays, submitLeave } from "@/app/actions/calendar";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, SendIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { LeaveOptions, LeaveType, LeaveUnit } from "@/lib/types";

/** ฟอร์มขอลา: ประเภท / รูปแบบ (เต็มวัน ครึ่งวัน รายชั่วโมง) / ช่วงวัน / เหตุผล / ผู้อนุมัติ / ไฟล์แนบ */
export function LeaveForm({ options }: { options: LeaveOptions }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [type, setType] = useState<LeaveType>("personal");
  const [unit, setUnit] = useState<LeaveUnit>("full");
  const [start, setStart] = useState(localToday());
  const [end, setEnd] = useState(localToday());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState(options.default_approver_id ? String(options.default_approver_id) : "");
  const [days, setDays] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start_] = useTransition();
  const single = unit !== "full";
  const balance = options.balance.find((b) => b.type === type);

  // จำนวนวันลา (ไม่นับวันหยุดสุดสัปดาห์ / วันหยุดบริษัท) — คำนวณที่ API
  useEffect(() => {
    let alive = true;
    previewLeaveDays(unit, start, single ? start : end, unit === "hours" ? startTime : "", unit === "hours" ? endTime : "").then((d) => alive && setDays(d));
    return () => {
      alive = false;
    };
  }, [unit, start, end, startTime, endTime, single]);

  const submit = (form: FormData) => {
    const e: Record<string, string> = {};
    if (!start) e.start_on = t("leave.validate.start");
    if (!reason.trim()) e.reason = t("leave.validate.reason");
    if (!approver) e.approver_id = t("leave.validate.approver");
    if (unit === "hours" && (!startTime || !endTime)) e.end_time = t("leave.validate.times");
    setErrors(e);
    if (Object.keys(e).length) return;
    form.set("leave_type", type);
    form.set("unit", unit);
    form.set("start_on", start);
    form.set("end_on", single ? start : end);
    if (unit === "hours") {
      form.set("start_time", startTime);
      form.set("end_time", endTime);
    }
    form.set("reason", reason);
    form.set("approver_id", approver);
    start_(async () => {
      const res = await submitLeave(form);
      if (res.ok) return router.push("/leave?done=1");
      setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, m ?? ""])));
      setMessage(res.message ?? "");
    });
  };
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={pending} className={`grid grid-cols-1 gap-4 p-4 disabled:opacity-60 sm:grid-cols-2 sm:p-6 ${card}`}>
        <div>
          <label htmlFor="leave_type" className="mb-1 block text-sm font-medium">{t("leave.form.type")}</label>
          <AppSelect id="leave_type" value={type} onValueChange={(v) => setType(v as LeaveType)} className={cls("leave_type")}>
            {options.types.map((x) => (
              <option key={x} value={x}>
                {t(`leave.types.${x}`)}
              </option>
            ))}
          </AppSelect>
          {err("leave_type") ??
            (balance && (
              <p className="mt-1 text-xs text-muted">
                {balance.remaining === null ? t("leave.unlimited") : t("leave.remaining", { n: fmt.number(balance.remaining) })}
              </p>
            ))}
        </div>
        <div>
          <label htmlFor="unit" className="mb-1 block text-sm font-medium">{t("leave.form.unit")}</label>
          <AppSelect id="unit" value={unit} onValueChange={(v) => setUnit(v as LeaveUnit)} className={cls("unit")}>
            {options.units.map((x) => (
              <option key={x} value={x}>
                {t(`leave.units.${x}`)}
              </option>
            ))}
          </AppSelect>
        </div>
        <div>
          <label htmlFor="start_on" className="mb-1 block text-sm font-medium">{single ? t("leave.form.date") : t("leave.form.start")}</label>
          <DateInput id="start_on" value={start} onChange={(d) => (setStart(d), end < d && setEnd(d))} className={cls("start_on")} />
          {err("start_on")}
        </div>
        {single ? (
          unit === "hours" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="start_time" className="mb-1 block text-sm font-medium">{t("leave.form.startTime")}</label>
                <input id="start_time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cls("start_time")} />
              </div>
              <div>
                <label htmlFor="end_time" className="mb-1 block text-sm font-medium">{t("leave.form.endTime")}</label>
                <input id="end_time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={cls("end_time")} />
                {err("end_time")}
              </div>
            </div>
          ) : (
            <span className="hidden sm:block" />
          )
        ) : (
          <div>
            <label htmlFor="end_on" className="mb-1 block text-sm font-medium">{t("leave.form.end")}</label>
            <DateInput id="end_on" value={end} min={start || undefined} onChange={setEnd} className={cls("end_on")} />
            {err("end_on")}
          </div>
        )}
        <p className="rounded-xl bg-subtle/60 px-3 py-2 text-sm font-medium sm:col-span-2">{t("leave.form.days", { n: days === null ? "-" : fmt.number(days) })}</p>
        <div className="sm:col-span-2">
          <label htmlFor="reason" className="mb-1 block text-sm font-medium">
            {t("leave.form.reason")} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="reason"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((x) => ({ ...x, reason: "" }));
            }}
            className={cls("reason")}
          />
          {err("reason")}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="approver_id" className="mb-1 block text-sm font-medium">
            {t("leave.form.approver")} <span className="text-red-500">*</span>
          </label>
          <AppSelect id="approver_id" value={approver} onValueChange={setApprover} className={cls("approver_id")}>
            <option value="">{t("leave.form.chooseApprover")}</option>
            {options.approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </AppSelect>
          {err("approver_id") ?? <p className="mt-1 text-xs text-muted">{!options.approvers.length ? t("leave.form.noApprover") : options.approver_source === "route" ? t("leave.form.approverHintRoute") : t("leave.form.approverHint")}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="files" className="mb-1 block text-sm font-medium">{t("leave.form.files")}</label>
          <input id="files" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className={`${cls("files")} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-accent-800 hover:file:bg-accent-200 dark:file:bg-accent-400/15 dark:file:text-accent-200`} />
          {err("files") ?? <p className="mt-1 text-xs text-muted">{t("leave.form.filesHint", { n: options.sick_cert_days })}</p>}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SendIcon />}
          {t("leave.form.submit")}
        </button>
      </div>
    </form>
  );
}
