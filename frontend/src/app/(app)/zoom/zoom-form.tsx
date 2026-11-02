"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { loadZoomBookings, saveZoomBooking, type ZoomBookingValues } from "@/app/actions/zoom";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { periodText, TIME_OPTIONS, ZOOM_BAR } from "./zoom-utils";

type Field = keyof ZoomBookingValues;
const daysBetween = (a: string, b: string) => (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
const startAt = (v: Pick<ZoomBookingValues, "start_on" | "start_time">) => `${v.start_on} ${v.start_time}`;
const endAt = (v: Pick<ZoomBookingValues, "end_on" | "end_time">) => `${v.end_on} ${v.end_time}`;

/**
 * ฟอร์มจอง / แก้ไขการจอง ZOOM — หัวข้อ (บังคับ), วันเวลาเริ่ม-สิ้นสุด (บังคับ), รายละเอียด
 * แสดงการจองอื่นที่ช่วงเวลาซ้อนกันให้รู้ล่วงหน้า (ไม่บล็อก — ฝ่าย IT ตรวจบัญชี ZOOM แล้วแจ้งกลับเอง)
 */
export function ZoomForm({
  id,
  initial,
  initialRange,
  onCancel,
  embedded = false,
}: {
  id: string | null;
  initial: ZoomBookingValues;
  initialRange: ZoomBooking[];
  /** ปุ่มยกเลิก (ใน modal = ปิด modal) — ไม่ส่ง = ย้อนกลับ */
  onCancel?: () => void;
  /** อยู่ใน modal = ไม่มีกรอบการ์ด */
  embedded?: boolean;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<ZoomBookingValues>(initial);
  const [range, setRange] = useState(initialRange);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [checking, startCheck] = useTransition();
  const [pending, start] = useTransition();
  const today = localToday();

  const set = <K extends Field>(k: K, value: ZoomBookingValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setDates = (patch: Partial<Pick<ZoomBookingValues, "start_on" | "end_on">>) => {
    const next = { ...v, ...patch };
    if (patch.start_on && (!next.end_on || next.end_on < patch.start_on)) next.end_on = patch.start_on;
    setV(next);
    setErrors((e) => ({ ...e, start_on: undefined, end_on: undefined, end_time: undefined }));
    if (next.start_on && next.end_on && next.end_on >= next.start_on && daysBetween(next.start_on, next.end_on) <= 62) {
      startCheck(async () => setRange(await loadZoomBookings(next.start_on, next.end_on)));
    }
  };

  const timesOk = Boolean(v.start_on && v.end_on && v.start_time && v.end_time && endAt(v) > startAt(v));
  // การจองอื่นที่ช่วงเวลาซ้อนกับที่เลือก
  const overlapping = timesOk ? range.filter((b) => b.id !== id && startAt(b) < endAt(v) && endAt(b) > startAt(v)) : [];
  const timeOptions = [...new Set([...TIME_OPTIONS, initial.start_time, initial.end_time].filter(Boolean))].sort();

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.title.trim()) e.title = t("zoom.validate.title");
    if (!v.start_on || !v.end_on || !v.start_time || !v.end_time) e.end_on = t("zoom.validate.dates");
    else if (!timesOk) e.end_time = t("zoom.validate.order");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveZoomBooking(id, v);
      if (res.ok && res.id) return router.push(`/zoom/bookings/${res.id}?done=${id ? "updated" : "created"}`);
      setErrors(res.errors ?? {});
      setMessage(res.message ?? "");
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;
  const timeSelect = (k: "start_time" | "end_time") => <AppSelect id={k} value={v[k]} onValueChange={(x) => set(k, x)} className={cls(k)} options={timeOptions.map((o) => ({ value: o, label: o }))} />;

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={pending} className={`space-y-4 disabled:opacity-60 ${embedded ? "" : `max-w-3xl p-5 ${card}`}`}>
        <div>
          {label("title", t("zoom.form.title"), true)}
          <input id="title" maxLength={255} value={v.title} onChange={(e) => set("title", e.target.value)} placeholder={t("zoom.form.titlePlaceholder")} className={cls("title")} />
          {err("title")}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            {label("start_on", t("zoom.form.startOn"), true)}
            <DateInput id="start_on" value={v.start_on} min={id ? undefined : today} onChange={(d) => setDates({ start_on: d })} className={cls("start_on")} />
            {err("start_on")}
          </div>
          <div>
            {label("start_time", t("zoom.form.startTime"), true)}
            {timeSelect("start_time")}
          </div>
          <div>
            {label("end_on", t("zoom.form.endOn"), true)}
            <DateInput id="end_on" value={v.end_on} min={v.start_on || undefined} onChange={(d) => setDates({ end_on: d })} className={cls("end_on")} />
            {err("end_on")}
          </div>
          <div>
            {label("end_time", t("zoom.form.endTime"), true)}
            {timeSelect("end_time")}
            {err("end_time")}
          </div>
        </div>

        {/* การจองอื่นในช่วงเวลาที่เลือก (ข้อมูลประกอบ — ไม่บล็อก) */}
        {timesOk && (
          <div className="space-y-2 rounded-xl bg-subtle/60 p-3 text-xs">
            {checking ? (
              <p className="flex items-center gap-2 text-muted">
                <SpinnerIcon width={12} height={12} className="text-accent-400" />
                {t("zoom.form.checking")}
              </p>
            ) : overlapping.length ? (
              <>
                <p role="alert" className={alert.warning}>
                  <AlertIcon className="shrink-0" />
                  {t("zoom.form.overlap", { n: overlapping.length })}
                </p>
                <ul className="space-y-1">
                  {overlapping.map((b) => (
                    <li key={b.id} className={`rounded-lg px-2 py-1 ring-1 ring-inset ${ZOOM_BAR[b.status]}`}>
                      {periodText(b, fmt.date)} · {b.title} ({b.user.name})
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-1.5 font-medium text-success-700 dark:text-success-300">
                <CheckCircleIcon width={14} height={14} />
                {t("zoom.form.free")}
              </p>
            )}
          </div>
        )}

        <div>
          {label("details", t("zoom.form.details"))}
          <textarea id="details" rows={4} maxLength={5000} value={v.details} onChange={(e) => set("details", e.target.value)} placeholder={t("zoom.form.detailsPlaceholder")} className={cls("details")} />
          {err("details")}
        </div>
        <p className="text-xs text-muted">{t("zoom.form.hint")}</p>
      </fieldset>

      <div className={`flex justify-end gap-2 ${embedded ? "" : "max-w-3xl"}`}>
        <button type="button" onClick={() => (onCancel ? onCancel() : router.back())} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {id ? t("zoom.form.saveEdit") : t("zoom.form.save")}
        </button>
      </div>
    </form>
  );
}
