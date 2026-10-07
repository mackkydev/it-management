"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { useDismiss, useFloating } from "@/components/floating";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/lib/prefs";
import { formatDate, localToday, parseDisplayDate, yearOffset } from "@/lib/date";

interface Props {
  id?: string;
  /** โหมดควบคุม: "YYYY-MM-DD" หรือ "" */
  value?: string;
  /** โหมดไม่ควบคุม (ฟอร์ม GET ของหน้ากรอง) — ใช้คู่กับ name */
  defaultValue?: string;
  onChange?: (iso: string) => void;
  /** ส่งค่า "YYYY-MM-DD" ไปกับฟอร์มด้วย hidden input */
  name?: string;
  min?: string;
  max?: string;
  className: string;
  disabled?: boolean;
  /** ข้อความในช่องว่าง (ค่าเริ่มต้น = รูปแบบวันที่ เช่น วว/ดด/ปปปป) */
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * ช่องวันที่มาตรฐานของระบบ (ใช้แทน <input type="date"> ทุกที่) — dd/MM/yyyy (ไทยใช้ปี พ.ศ.)
 * พิมพ์ตัวเลขได้เลย ใส่ / ให้อัตโนมัติ หรือกดไอคอน/ช่องเพื่อเปิดปฏิทิน (เลือกวัน, เลื่อนเดือน, วันนี้, ล้าง)
 * ส่งออกเป็น "YYYY-MM-DD" ครบวันเท่านั้น — ยังพิมพ์ไม่ครบ/วันที่ไม่มีจริง = ""
 */
export function DateInput({ id, value, defaultValue = "", onChange, name, min, max, className, disabled, placeholder, ...rest }: Props) {
  const { t, locale } = useI18n();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const iso = controlled ? value : inner;
  const show = (v: string) => (v ? formatDate(v, locale) : "");
  const [text, setText] = useState(show(iso));
  const [prev, setPrev] = useState(iso);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const style = useFloating(wrapRef, open, { minWidth: 300, height: 360 });
  useDismiss(open, [wrapRef, popRef], () => setOpen(false));

  // ค่าเปลี่ยนจากภายนอก (เช่น คำนวณวันหมดอายุให้) → แสดงตาม
  if (iso !== prev) {
    setPrev(iso);
    if (parseDisplayDate(text, locale) !== iso) setText(show(iso));
  }

  const emit = (next: string) => {
    setPrev(next);
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const onType = (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    const masked = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
    // ลบถึงเครื่องหมาย / ให้ลบได้ตามปกติ
    const next = e.target.value.length < text.length && e.target.value.endsWith("/") ? e.target.value.slice(0, -1) : masked;
    setText(next);
    emit(parseDisplayDate(next, locale) ?? "");
  };

  const pick = (next: string) => {
    setText(show(next));
    emit(next);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? t("common.datePlaceholder")}
        value={text}
        onChange={onType}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => iso && setText(show(iso))}
        disabled={disabled}
        aria-label={rest["aria-label"]}
        className={`${className} pl-9`}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        tabIndex={-1}
        aria-label={t("common.openCalendar")}
        className="absolute left-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <CalendarIcon width={15} height={15} />
      </button>
      {name && <input type="hidden" name={name} value={iso} />}

      {open &&
        createPortal(
          <div ref={popRef} style={{ ...style, width: 300 }} role="dialog" aria-label={t("common.openCalendar")} className="rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-line">
            <Calendar value={iso} min={min} max={max} locale={locale} onPick={pick} todayLabel={t("common.todayDate")} clearLabel={t("common.clear")} />
          </div>,
          document.body,
        )}
    </div>
  );
}

const MONTHS: Record<Locale, string[]> = {
  th: ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const WEEKDAYS: Record<Locale, string[]> = {
  th: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
};


/** ปฏิทินเดือน: วันที่เลือก = พื้นเข้ม, วันนี้ = มีกรอบ, วันนอกเดือน = จาง, นอกช่วง min/max = กดไม่ได้ */
function Calendar({
  value,
  min,
  max,
  locale,
  onPick,
  todayLabel,
  clearLabel,
}: {
  value: string;
  min?: string;
  max?: string;
  locale: Locale;
  onPick: (iso: string) => void;
  todayLabel: string;
  clearLabel: string;
}) {
  const today = localToday();
  const start = value || today;
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });

  const first = new Date(Date.UTC(view.y, view.m, 1));
  const offset = first.getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(Date.UTC(view.y, view.m, 1 - offset + i));
    return { iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === view.m };
  });
  const move = (delta: number) => setView((v) => ({ y: v.y + Math.floor((v.m + delta) / 12), m: (((v.m + delta) % 12) + 12) % 12 }));
  const outOfRange = (d: string) => Boolean((min && d < min) || (max && d > max));

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label="previous month" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink transition-colors hover:bg-subtle">
          <ChevronLeftIcon width={16} height={16} />
        </button>
        <span className="text-sm font-semibold text-ink">
          {MONTHS[locale][view.m]} {view.y + yearOffset(locale)}
        </span>
        <button type="button" onClick={() => move(1)} aria-label="next month" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink transition-colors hover:bg-subtle">
          <ChevronRightIcon width={16} height={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS[locale].map((w) => (
          <span key={w} className="py-1 text-xs text-muted">
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const selected = c.iso === value;
          const isToday = c.iso === today;
          const off = outOfRange(c.iso);
          return (
            <button
              key={c.iso}
              type="button"
              disabled={off}
              onClick={() => onPick(c.iso)}
              aria-pressed={selected}
              aria-label={c.iso}
              className={`flex h-9 cursor-pointer items-center justify-center rounded-lg text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                selected
                  ? "bg-ink font-semibold text-surface ring-2 ring-line ring-offset-1 ring-offset-surface"
                  : isToday
                    ? "font-semibold text-ink ring-1 ring-accent-300 hover:bg-subtle dark:ring-accent-400/50"
                    : c.inMonth
                      ? "text-ink hover:bg-subtle"
                      : "text-faint hover:bg-subtle"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-3">
        <button type="button" onClick={() => onPick("")} className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-subtle hover:text-ink">
          {clearLabel}
        </button>
        <button
          type="button"
          disabled={outOfRange(today)}
          onClick={() => onPick(today)}
          className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-accent-700 transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 dark:text-accent-300"
        >
          {todayLabel}
        </button>
      </div>
    </div>
  );
}

