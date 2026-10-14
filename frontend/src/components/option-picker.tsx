"use client";

import { useState, type KeyboardEvent } from "react";
import { PlusIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export interface PickerOption {
  /** ค่าที่บันทึก (เช่น ชื่อ หรือ key ของหมวดตั้งต้น) */
  value: string;
  /** ข้อความที่แสดง */
  label: string;
  /** ข้อความเล็กด้านขวา (ไม่บังคับ) */
  hint?: string;
}

interface Props {
  id: string;
  options: PickerOption[];
  /** ค่าที่เลือก ("" = ยังไม่เลือก) */
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  /** ไม่มีชื่อที่ตรง → "+ เพิ่ม …" สร้างใหม่ทันที (ไม่ระบุ = เพิ่มไม่ได้) — คืนตัวเลือกใหม่ หรือข้อความผิดพลาด */
  onAdd?: (name: string) => Promise<{ option?: PickerOption; message?: string }>;
  maxLength?: number;
}

const MAX_SHOWN = 100;

/**
 * ช่องเลือกแบบพิมพ์เพื่อค้นหา (รูปแบบเดียวกับช่องสถานที่ในฟอร์มสินทรัพย์) — มีแถบเลื่อนเมื่อรายการยาว
 * ไม่มีชื่อที่ตรงกัน → "+ เพิ่ม …" บันทึกเป็นข้อมูล Drop Down ใหม่แล้วเลือกให้ทันที (แก้/ลบได้ที่ ข้อมูลหลัก → ข้อมูล Drop Down)
 */
export function OptionPicker({ id, options: initial, value, onChange, className, placeholder, onAdd, maxLength = 100 }: Props) {
  const { t } = useI18n();
  const [added, setAdded] = useState<PickerOption[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const options = [...initial, ...added.filter((a) => !initial.some((o) => o.value === a.value))];
  // ค่าที่บันทึกไว้แต่ไม่มีในรายการแล้ว (เช่น ปิดใช้งาน) — ยังแสดงค่าเดิม
  const selected = options.find((o) => o.value === value) ?? (value ? { value, label: value } : null);
  const q = query.trim().toLowerCase();
  const matches = (q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options).slice(0, MAX_SHOWN);
  const canAdd = Boolean(onAdd) && q !== "" && !options.some((o) => o.label.trim().toLowerCase() === q || o.value.trim().toLowerCase() === q);
  const count = matches.length + (canAdd ? 1 : 0);

  const pick = (o: PickerOption) => {
    onChange(o.value);
    setQuery("");
    setOpen(false);
    setError("");
  };

  const add = async () => {
    const name = query.trim();
    if (!name || creating || !onAdd) return;
    setCreating(true);
    setError("");
    const res = await onAdd(name);
    setCreating(false);
    if (res.option) {
      setAdded((list) => [...list, res.option!]);
      pick(res.option);
    } else setError(res.message ?? t("common.saveFailed"));
  };

  const choose = (i: number) => (i < matches.length ? pick(matches[i]) : add());

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Enter ห้ามส่งฟอร์ม — ใช้เลือก/เพิ่มแทน
      e.preventDefault();
      if (open && count > 0) choose(Math.min(active, count - 1));
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (selected) {
    return (
      <div className={`${className} flex items-center justify-between gap-2`}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{selected.label}</span>
          {selected.hint && <span className="shrink-0 text-xs text-muted">{selected.hint}</span>}
        </span>
        <button type="button" onClick={() => onChange("")} className={`${btn.danger} -my-1 h-6! shrink-0 gap-1! px-2! py-0! text-xs!`} aria-label={t("common.clear")}>
          <XIcon width={12} height={12} />
          {t("common.clear")}
        </button>
      </div>
    );
  }

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
        placeholder={placeholder ?? t("picker.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          setError("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // รอให้ onMouseDown ของตัวเลือกทำงานก่อน
        onKeyDown={onKeyDown}
        className={`${className} pr-9`}
      />
      {creating && <SpinnerIcon width={14} height={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-accent-400" />}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {matches.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
            >
              <span className="truncate font-medium text-ink">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
            </li>
          ))}
          {matches.length === 0 && !canAdd && <li className="px-3 py-2 text-muted">{t("common.noResults")}</li>}
          {canAdd && (
            <li
              role="option"
              aria-selected={active === matches.length}
              onMouseDown={(e) => {
                e.preventDefault();
                void add();
              }}
              onMouseEnter={() => setActive(matches.length)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-accent-700 dark:text-accent-300 ${
                matches.length ? "border-t border-line" : ""
              } ${active === matches.length ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
            >
              {creating ? <SpinnerIcon width={14} height={14} className="shrink-0" /> : <PlusIcon width={14} height={14} className="shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate">{t("picker.add", { name: query.trim() })}</span>
                <span className="block text-xs font-normal text-muted">{t("picker.addHint")}</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}
