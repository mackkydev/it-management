"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { PlusIcon, SpinnerIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

/** ตัวเลือกแบบมีรายละเอียด — value = ค่าที่ใส่ในช่อง, hint = บรรทัดรอง (เช่น ชื่อสินทรัพย์ / แผนก) */
export interface SuggestItem<T = unknown> {
  value: string;
  hint?: string;
  /** ข้อมูลเต็มของตัวเลือก ส่งกลับใน onPick */
  data?: T;
}

interface Props<T> {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** ดึงค่าที่มีอยู่แล้วตามคำที่พิมพ์ */
  load: (q: string) => Promise<(string | SuggestItem<T>)[]>;
  /** เลือกจากรายการ (ไม่รวมแถว "เพิ่ม") — ไม่ระบุ = ใส่ value ลงช่อง */
  onPick?: (item: SuggestItem<T>) => void;
  /** แสดงแถว "+ เพิ่ม" เมื่อพิมพ์ค่าที่ไม่มีในรายการ (ค่าที่พิมพ์ใช้ได้เสมอแม้ปิด) */
  allowNew?: boolean;
  className: string;
  maxLength?: number;
  placeholder?: string;
}

/**
 * ช่องพิมพ์แล้วแนะนำค่าที่มีในระบบ (เช่น ยี่ห้อ/รุ่น/เลขครุภัณฑ์/ผู้ใช้) — เลือกจากรายการ หรือถ้ายังไม่มีให้กด "+ เพิ่ม" ใช้ค่าที่พิมพ์
 * ค่าในช่องคือข้อความที่พิมพ์เสมอ (ไม่บังคับต้องเลือกจากรายการ)
 */
export function SuggestInput<T = unknown>({ id, value, onChange, load, onPick, allowNew = true, className, maxLength = 100, placeholder }: Props<T>) {
  const { t } = useI18n();
  const [items, setItems] = useState<SuggestItem<T>[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const typed = value.trim();
  const exact = items.some((i) => i.value.toLowerCase() === typed.toLowerCase());
  // ตัวเลือกทั้งหมด: ค่าที่มี + แถว "เพิ่ม" (ถ้าพิมพ์ค่าใหม่)
  const options: (SuggestItem<T> & { isNew: boolean })[] = [
    ...items.map((i) => ({ ...i, isNew: false })),
    ...(allowNew && typed && !exact ? [{ value: typed, isNew: true }] : []),
  ];

  const search = (q: string) => {
    clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      const n = ++seq.current;
      const found = await load(q);
      if (n !== seq.current) return; // ทิ้งผลลัพธ์เก่าที่ตอบกลับช้ากว่า
      setItems(found.map((f) => (typeof f === "string" ? { value: f } : f)));
      setActive(0);
      setLoading(false);
    }, 250);
  };

  const pick = (o: SuggestItem<T> & { isNew: boolean }) => {
    if (!o.isNew && onPick) onPick(o);
    else onChange(o.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const listId = `${id}-list`;

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          search(value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // รอให้ onMouseDown ของตัวเลือกทำงานก่อน
        onKeyDown={onKeyDown}
        className={`${className} pr-9`}
      />
      {loading && open && (
        <SpinnerIcon width={14} height={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-accent-400" />
      )}
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {options.map((o, i) => (
            <li
              key={`${o.isNew ? "new:" : ""}${o.value}:${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${i === active ? "bg-accent-50 dark:bg-accent-400/10" : ""} ${
                o.isNew ? "border-t border-line font-medium text-accent-700 dark:text-accent-300" : "text-ink"
              }`}
            >
              {o.isNew && <PlusIcon width={14} height={14} />}
              {o.isNew ? (
                t("common.addNew", { value: o.value })
              ) : o.hint ? (
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.value}</span>
                  <span className="block truncate text-xs text-muted">{o.hint}</span>
                </span>
              ) : (
                o.value
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
