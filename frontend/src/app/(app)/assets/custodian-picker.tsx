"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { searchUsers } from "@/app/actions/assets";
import { SpinnerIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { UserOption } from "@/lib/types";

interface Props {
  id: string;
  value: { id: number; name: string } | null;
  onChange: (user: UserOption | null) => void;
  className: string;
}

/**
 * ช่องค้นหาผู้ถือครอง: พิมพ์ชื่อ/อีเมล → ค้นจาก API ทีละ 10 รายการ (debounce 300ms)
 * ไม่โหลดผู้ใช้ทั้งหมดมาไว้ใน dropdown เพื่อรองรับองค์กรที่มีผู้ใช้จำนวนมาก
 */
export function CustodianPicker({ id, value, onChange, className }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestSeq = useRef(0);

  const search = (text: string) => {
    clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      const seq = ++requestSeq.current;
      const users = await searchUsers(text);
      if (seq !== requestSeq.current) return; // ทิ้งผลลัพธ์เก่าที่ตอบกลับช้ากว่า
      setResults(users);
      setActive(0);
      setLoading(false);
    }, 300);
  };

  const select = (user: UserOption) => {
    onChange(user);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      select(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div className={`${className} flex items-center justify-between gap-2`}>
        <span className="truncate">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`${btn.danger} ${btn.sm} shrink-0 px-2 py-1`}
          aria-label={t("assets.form.custodianClear")}
        >
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
        maxLength={100}
        placeholder={t("assets.form.custodianPlaceholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          search(query);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // รอให้ onMouseDown ของตัวเลือกทำงานก่อน
        onKeyDown={onKeyDown}
        className={`${className} pr-9`}
      />
      {loading && (
        <SpinnerIcon
          width={14}
          height={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-accent-400"
        />
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-surface py-1 text-sm shadow-lg ring-1 ring-line"
        >
          {loading && results.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-2 text-accent-600 dark:text-accent-300" role="status">
              <SpinnerIcon width={14} height={14} />
              {t("common.searching")}
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-muted">{t("assets.form.noUsers")}</li>
          ) : (
            results.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(u);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 ${i === active ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
              >
                <div className="font-medium text-ink">{u.name}</div>
                <div className="text-xs text-muted">{u.email}</div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
