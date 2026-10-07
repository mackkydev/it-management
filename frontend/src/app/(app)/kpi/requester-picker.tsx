"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { searchKpiPeople, type KpiPerson } from "@/app/actions/kpi";
import { SpinnerIcon } from "@/components/icons";
import { useDismiss, useFloating } from "@/components/floating";
import { tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** เลือกจากรายการ — ส่งผู้ใช้ไปเติมช่องสาขาต่อ */
  onPick: (person: KpiPerson) => void;
  className: string;
  ariaLabel: string;
}

/**
 * ช่องผู้แจ้งของ KPI: พิมพ์ชื่อ-สกุล / สาขา / แผนก → ค้นผู้ใช้ในระบบ + ผู้ใช้จาก API (debounce 300ms)
 * เลือกแล้วเติมชื่อ (และสาขาผ่าน onPick) — ไม่พบในระบบก็ใช้ชื่อที่พิมพ์ได้
 * รายการลอยแบบ position: fixed (useFloating) เพื่อไม่ให้ถูกตัดในตารางที่เลื่อนแนวนอน
 */
export function RequesterPicker({ value, onChange, onPick, className, ariaLabel }: Props) {
  const { t } = useI18n();
  const [results, setResults] = useState<KpiPerson[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const listId = useId();
  const style = useFloating(wrapRef, open, { minWidth: 280, height: 320 });
  useDismiss(open, [wrapRef, popRef], () => setOpen(false));

  const search = (text: string) => {
    clearTimeout(timer.current);
    if (!text.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setOpen(true);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      const people = await searchKpiPeople(text);
      if (mine !== seq.current) return; // ทิ้งผลลัพธ์เก่าที่ตอบกลับช้ากว่า
      setResults(people);
      setActive(0);
      setLoading(false);
    }, 300);
  };

  const pick = (p: KpiPerson) => {
    onPick(p);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    }
  };

  return (
    <div ref={wrapRef}>
      <input
        value={value}
        maxLength={255}
        placeholder={t("kpi.requesterPlaceholder")}
        onChange={(e) => (onChange(e.target.value), search(e.target.value))}
        onFocus={() => value.trim() && search(value)}
        onKeyDown={onKeyDown}
        className={className}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        role="combobox"
        autoComplete="off"
      />
      {open &&
        createPortal(
          <div ref={popRef} id={listId} style={style} role="listbox" className="max-h-80 overflow-y-auto rounded-xl bg-surface p-1 shadow-xl ring-1 ring-line">
            {loading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                <SpinnerIcon width={14} height={14} />
                {t("common.searching")}
              </p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">{t("kpi.noPeople")}</p>
            ) : (
              results.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                  className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === active ? "bg-accent-100 dark:bg-accent-400/15" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="block text-xs text-muted">{[p.branch?.name, p.department].filter(Boolean).join(" · ") || "-"}</span>
                  </span>
                  {p.type === "API" && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.info.badge}`}>{t("kpi.apiUser")}</span>}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
