"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { CalendarIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";
import { formatDate, parseDisplayDate } from "@/lib/date";

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
  "aria-label"?: string;
}

/**
 * ช่องวันที่ dd/MM/yyyy (ไทยใช้ปี พ.ศ.) — พิมพ์ตัวเลขได้เลย ใส่ / ให้อัตโนมัติ หรือกดปุ่มปฏิทินเพื่อเลือก
 * ใช้แทน <input type="date"> ซึ่งแสดงรูปแบบตามภาษาเครื่อง (บางเครื่องเป็น MM/dd/yyyy)
 * ส่งออกเป็น "YYYY-MM-DD" ครบวันเท่านั้น — ยังพิมพ์ไม่ครบ/วันที่ไม่มีจริง = ""
 */
export function DateInput({ id, value, defaultValue = "", onChange, name, min, max, className, disabled, ...rest }: Props) {
  const { t, locale } = useI18n();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const iso = controlled ? value : inner;
  const show = (v: string) => (v ? formatDate(v, locale) : "");
  const [text, setText] = useState(show(iso));
  const [prev, setPrev] = useState(iso);
  const picker = useRef<HTMLInputElement>(null);

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

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t("common.datePlaceholder")}
        value={text}
        onChange={onType}
        onBlur={() => iso && setText(show(iso))}
        disabled={disabled}
        aria-label={rest["aria-label"]}
        className={`${className} pr-10`}
      />
      <Tooltip label={t("common.openCalendar")}>
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          aria-label={t("common.openCalendar")}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-accent-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-accent-300"
        >
          <CalendarIcon width={15} height={15} />
        </button>
      </Tooltip>
      {/* ปฏิทินของเบราว์เซอร์ (ซ่อนไว้ เปิดด้วย showPicker) */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        min={min}
        max={max}
        onChange={(e) => {
          setText(show(e.target.value));
          emit(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </div>
  );
}
