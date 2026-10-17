"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveLoan, type LoanValues } from "@/app/actions/loans";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, ChevronDownIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { LoanDevice } from "@/lib/types";
import { endAt, overlaps, periodText, startAt, TIME_OPTIONS } from "./loan-utils";

type Field = keyof LoanValues;
/** เปิดฟอร์มของเครื่องนี้จากภายนอก (ปฏิทิน: ดับเบิลคลิก / คลิกขวาที่วัน) — nonce เปลี่ยนทุกครั้งที่สั่งเปิด */
export type OpenRequest = { deviceId: number; date: string; nonce: number } | null;

const blank = (date: string, deviceId: number): LoanValues => ({
  asset_id: String(deviceId),
  purpose: "",
  note: "",
  start_on: date,
  start_time: "09:00",
  end_on: date,
  end_time: "17:00",
});

/**
 * รายการโน้ตบุ๊กที่ให้ยืม (คอลัมน์ซ้ายของหน้า ยืมโน้ตบุ๊ก) — สีประจำเครื่องตรงกับแถบในปฏิทิน,
 * บอกสถานะ ยืมอยู่ / ช่วงที่ติดยืม, ปุ่ม ยืม-จอง ขยายฟอร์มเลือกวันเริ่ม-สิ้นสุด (+ เวลา, วัตถุประสงค์) แล้วบันทึก
 */
export function DeviceList({
  devices,
  colorOf,
  canBook,
  open,
  onSaved,
}: {
  devices: LoanDevice[];
  colorOf: (id: number) => string;
  canBook: boolean;
  open: OpenRequest;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const today = localToday();
  const [openId, setOpenId] = useState<number | null>(null);
  const [v, setV] = useState<LoanValues>(blank(today, 0));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const rows = useRef(new Map<number, HTMLLIElement>());

  const expand = (deviceId: number, date = today) => {
    setOpenId(deviceId);
    setV(blank(date, deviceId));
    setErrors({});
    setMessage("");
    setSaved("");
  };

  // ปฏิทินสั่งเปิดฟอร์มของเครื่อง + วันที่ → ขยายแล้วเลื่อนให้เห็น
  useEffect(() => {
    if (!open) return;
    expand(open.deviceId, open.date);
    window.requestAnimationFrame(() => rows.current.get(open.deviceId)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- เปิดตามคำสั่งแต่ละครั้ง (nonce)
  }, [open?.nonce]);

  const set = (k: Field, value: string) => {
    setV((p) => {
      const next = { ...p, [k]: value };
      if (k === "start_on" && (!p.end_on || p.end_on < value)) next.end_on = value;
      return next;
    });
    setErrors((e) => ({ ...e, [k]: undefined, ...(k.startsWith("start") || k.startsWith("end") ? { start_on: undefined, end_on: undefined, end_time: undefined } : {}) }));
  };

  const submit = (d: LoanDevice) => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.start_on || !v.end_on) e.start_on = t("loan.form.validate.dates");
    else if (endAt(v) <= startAt(v)) e.end_time = t("loan.form.validate.order");
    else {
      const clash = (d.busy ?? []).find((b) => overlaps(b, v));
      if (clash) e.end_on = t("loan.board.clash", { period: periodText(clash, fmt.date) });
    }
    if (!v.purpose.trim()) e.purpose = t("loan.form.validate.purpose");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveLoan(null, v);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors ? (res.errors.asset_id ?? "") : (res.message ?? ""));
        return;
      }
      setOpenId(null);
      setSaved(t("loan.form.saved"));
      onSaved();
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;
  const time = (k: "start_time" | "end_time") => (
    <AppSelect id={`loan-${k}`} value={v[k]} onValueChange={(x) => set(k, x)} className={cls(k)}>
      {TIME_OPTIONS.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </AppSelect>
  );

  return (
    <section className={`p-3 sm:p-4 ${card}`}>
      <h2 className="mb-3 px-1 font-semibold">{t("loan.board.devices")}</h2>
      {saved && (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-success-50 px-3 py-2 text-sm text-success-800 dark:bg-success-400/10 dark:text-success-300">
          <CheckCircleIcon width={15} height={15} className="shrink-0" />
          {saved}
        </p>
      )}
      {devices.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted">{t("loan.noDevices")}</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const isOpen = openId === d.id;
            const busy = d.busy ?? [];
            const sub = [d.asset_tag, [d.brand, d.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
            return (
              <li
                key={d.id}
                ref={(el) => {
                  if (el) rows.current.set(d.id, el);
                  else rows.current.delete(d.id);
                }}
                className={`rounded-xl ring-1 transition-shadow ${isOpen ? "ring-2 ring-accent-300 dark:ring-accent-400/50" : "ring-line"}`}
              >
                <div className="flex items-start gap-3 p-3">
                  <span className={`mt-1 h-4 w-4 shrink-0 rounded ring-1 ring-inset ${colorOf(d.id)}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    {sub && <p className="truncate text-xs text-muted">{sub}</p>}
                    {d.on_loan ? (
                      <p className={`text-xs font-medium ${d.on_loan.is_overdue ? "text-danger-600 dark:text-danger-300" : "text-warning-700 dark:text-warning-300"}`}>
                        {t("loan.board.onLoan", { name: d.on_loan.user, end: `${fmt.date(d.on_loan.end_on)} ${d.on_loan.end_time}` })}
                      </p>
                    ) : (
                      busy.length === 0 && <p className="text-xs font-medium text-success-700 dark:text-success-300">{t("loan.board.free")}</p>
                    )}
                    {/* ช่วงที่ติดยืม / จองไว้ */}
                    {busy.filter((b) => b.status === "reserved").length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-xs text-muted">{t("loan.board.busy")}:</span>
                        {busy
                          .filter((b) => b.status === "reserved")
                          .map((b) => (
                            <span key={b.id} className="rounded-md bg-subtle px-1.5 py-0.5 text-[11px] text-ink">
                              {t("loan.board.busyItem", { period: periodText(b, fmt.date), name: b.user })}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                  {canBook && (
                    <button
                      type="button"
                      onClick={() => (isOpen ? setOpenId(null) : expand(d.id))}
                      aria-expanded={isOpen}
                      className={`${isOpen ? btn.secondary : btn.primary} ${btn.sm} shrink-0`}
                    >
                      {isOpen ? <XIcon width={14} height={14} /> : <ChevronDownIcon width={14} height={14} />}
                      {isOpen ? t("loan.board.close") : t("loan.board.borrow")}
                    </button>
                  )}
                </div>

                {/* ฟอร์มยืม-จอง (ขยายด้านล่าง) */}
                {isOpen && (
                  <form action={() => submit(d)} className="space-y-3 border-t border-line p-3">
                    {message && (
                      <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-500">
                        <AlertIcon width={14} height={14} className="shrink-0" />
                        {message}
                      </p>
                    )}
                    <fieldset disabled={pending} className="grid grid-cols-2 gap-3 disabled:opacity-60">
                      <div>
                        {label("loan-start_on", t("loan.form.startOn"), true)}
                        <DateInput id="loan-start_on" value={v.start_on} min={today} onChange={(x) => set("start_on", x)} className={cls("start_on")} />
                        {err("start_on")}
                      </div>
                      <div>
                        {label("loan-start_time", t("loan.form.startTime"))}
                        {time("start_time")}
                      </div>
                      <div>
                        {label("loan-end_on", t("loan.form.endOn"), true)}
                        <DateInput id="loan-end_on" value={v.end_on} min={v.start_on || today} onChange={(x) => set("end_on", x)} className={cls("end_on")} />
                        {err("end_on")}
                      </div>
                      <div>
                        {label("loan-end_time", t("loan.form.endTime"))}
                        {time("end_time")}
                        {err("end_time")}
                      </div>
                      <div className="col-span-2">
                        {label("loan-purpose", t("loan.form.purpose"), true)}
                        <input
                          id="loan-purpose"
                          value={v.purpose}
                          maxLength={2000}
                          placeholder={t("loan.form.purposePlaceholder")}
                          onChange={(e) => set("purpose", e.target.value)}
                          className={cls("purpose")}
                        />
                        {err("purpose")}
                      </div>
                    </fieldset>
                    <div className="flex justify-end">
                      <button type="submit" disabled={pending} className={`${btn.primary} ${btn.sm}`}>
                        {pending ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
                        {t("loan.form.save")}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
