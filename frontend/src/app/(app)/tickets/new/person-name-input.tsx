"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchPersonNames } from "@/app/actions/tickets";
import { useDismiss, useFloating } from "@/components/floating";

export type PersonName = { th: string; en: string };

/**
 * ช่องชื่อ-สกุล (ไทย / อังกฤษ) ในหัวข้อ 1.1 เพิ่ม/ระงับสิทธิ์ — พิมพ์แล้วแสดงรายชื่อที่ตรงกัน (Autocomplete)
 * เลือกแล้ว onPick ส่งคู่ชื่อไทย/อังกฤษ ให้ฟอร์มเติมทั้งสองช่อง (ฝั่งที่ไม่ทราบ = คงค่าเดิม)
 */
export function PersonNameInput({
  id,
  side,
  value,
  onChange,
  onPick,
  className,
  lang,
}: {
  id: string;
  side: keyof PersonName;
  value: string;
  onChange: (value: string) => void;
  onPick: (person: PersonName) => void;
  className: string;
  lang?: string;
}) {
  const [items, setItems] = useState<PersonName[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // ค้นหาเฉพาะเมื่อผู้ใช้พิมพ์ (ไม่ค้นตอนเลือกรายการ / ค่าตั้งต้น)
  const [query, setQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const style = useFloating(inputRef, open && items.length > 0, { height: 260 });
  useDismiss(open, [inputRef, listRef], () => setOpen(false));

  useEffect(() => {
    if (query === null) return;
    const q = query.trim();
    let alive = true;
    const timer = setTimeout(async () => {
      const found = q ? await searchPersonNames(q).catch(() => []) : [];
      if (!alive) return;
      setItems(found);
      setActive(-1);
      setOpen(found.length > 0);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pick = (p: PersonName) => {
    onPick(p);
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        value={value}
        lang={lang}
        maxLength={255}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
        }}
        onFocus={() => items.length > 0 && value.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {open && items.length > 0 && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          style={style}
          className="max-h-64 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((p, i) => {
            const main = p[side] || p[side === "th" ? "en" : "th"];
            const other = p[side] ? p[side === "th" ? "en" : "th"] : "";
            return (
              <li
                key={`${p.th}|${p.en}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${i === active ? "bg-accent-50 dark:bg-accent-400/15" : ""}`}
              >
                <span className="font-medium">{main}</span>
                {other && <span className="ml-2 text-xs text-muted">{other}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
