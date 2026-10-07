"use client";

import { useState, type KeyboardEvent } from "react";
import { AlertIcon, ExternalLinkIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { SoftwareOption, SoftwareRef } from "@/lib/types";

const MAX_SHOWN = 50;
/** เพิ่ม Software / License ใหม่ในแท็บใหม่ — กลับมาที่ฟอร์มแล้วรายการโหลดใหม่ให้อัตโนมัติ */
const NEW_LICENSE_HREF = "/assets/new?category=SOFTWARE";

interface SearchProps {
  id: string;
  /** null = กำลังโหลด */
  options: SoftwareOption[] | null;
  /** ตัวเลือกที่ไม่ต้องแสดง (เลือกไว้ในช่องอื่นแล้ว) */
  exclude: string[];
  /** license ที่ติดตั้งบนเครื่องนี้อยู่แล้ว — เลือกได้แม้ seat เต็ม */
  installed: string[];
  onPick: (ref: SoftwareRef) => void;
  placeholder: string;
  className: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}

/** ช่องค้นหา license: พิมพ์ชื่อ/รุ่น/เลขครุภัณฑ์ → เลือก — แสดง seat คงเหลือ, seat เต็ม = เลือกไม่ได้ */
function SoftwareSearch({ id, options, exclude, installed, onPick, placeholder, className, autoFocus, onCancel }: SearchProps) {
  const { t, fmt } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(Boolean(autoFocus));
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const list = (options ?? [])
    .filter((o) => !exclude.includes(o.id))
    .filter((o) => !q || [o.name, o.model ?? "", o.asset_tag].some((s) => s.toLowerCase().includes(q)))
    .slice(0, MAX_SHOWN);
  const full = (o: SoftwareOption) => o.available === 0 && !installed.includes(o.id);

  const pick = (o: SoftwareOption) => {
    if (full(o)) return;
    onPick({ id: o.id, asset_tag: o.asset_tag, name: o.name });
    setQuery("");
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // ไม่ส่งฟอร์มสินทรัพย์
      if (open && list[active]) pick(list[active]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
      onCancel?.();
    }
  };
  const listId = `${id}-list`;

  return (
    <div className="relative">
      <SearchIcon width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={100}
        placeholder={placeholder}
        value={query}
        onChange={(e) => (setQuery(e.target.value), setOpen(true), setActive(0))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => (setOpen(false), !query && onCancel?.()), 150)} // รอให้ onMouseDown ของตัวเลือกทำงานก่อน
        onKeyDown={onKeyDown}
        className={`${className} pl-8`}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {options === null ? (
            <li className="px-3 py-2 text-muted">{t("common.loading")}</li>
          ) : list.length === 0 ? (
            <li className="px-3 py-2 text-muted">{t(options.length ? "assets.software.noMatch" : "assets.software.noLicenses")}</li>
          ) : (
            list.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={full(o)}
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-3 px-3 py-2 ${full(o) ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${i === active ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{o.name}</span>
                  <span className="block truncate text-xs text-muted">{[o.model, o.asset_tag].filter(Boolean).join(" · ")}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    full(o)
                      ? "bg-danger-100 text-danger-700 dark:bg-danger-400/15 dark:text-danger-300"
                      : "bg-subtle text-muted"
                  }`}
                >
                  {/* คงเหลือ/ทั้งหมด เช่น 18/20 */}
                  {o.seats === null ? t("assets.software.unlimited") : `${fmt.number(o.available ?? 0)}/${fmt.number(o.seats)}`}
                </span>
              </li>
            ))
          )}
          <li className="border-t border-line">
            <a
              href={NEW_LICENSE_HREF}
              target="_blank"
              rel="noopener"
              onMouseDown={(e) => e.preventDefault()}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-accent-700 hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-400/10"
            >
              <PlusIcon width={14} height={14} />
              {t("assets.software.addLicense")}
              <ExternalLinkIcon width={12} height={12} className="ml-auto text-faint" />
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}

const Chip = ({ item, onRemove, removeLabel }: { item: SoftwareRef; onRemove: () => void; removeLabel: string }) => (
  <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-accent-50 py-1 pl-2.5 pr-1 text-sm ring-1 ring-inset ring-accent-200 dark:bg-accent-400/10 dark:ring-accent-400/30">
    <span className="truncate font-medium">{item.name}</span>
    <span className="shrink-0 font-mono text-[11px] text-muted">{item.asset_tag}</span>
    <button type="button" onClick={onRemove} aria-label={removeLabel} className="shrink-0 cursor-pointer rounded-md p-0.5 text-muted hover:bg-danger-100 hover:text-danger-700 dark:hover:bg-danger-400/15">
      <XIcon width={12} height={12} />
    </button>
  </span>
);

interface SlotProps {
  id: string;
  options: SoftwareOption[] | null;
  value: SoftwareRef | null;
  /** ข้อความเดิมที่ยังไม่ผูก license (เช่น นำเข้าจาก Excel) */
  legacy: string;
  exclude: string[];
  installed: string[];
  onChange: (ref: SoftwareRef | null) => void;
  onClearLegacy: () => void;
  className: string;
}

/** ช่องเดียว (OS / Office / Anti Virus): เลือก license 1 รายการ */
export function SoftwareSlotPicker({ id, options, value, legacy, exclude, installed, onChange, onClearLegacy, className }: SlotProps) {
  const { t } = useI18n();
  const [searching, setSearching] = useState(false);

  if (value) {
    return (
      <div className={`${className} flex items-center justify-between gap-2`}>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{value.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted">{value.asset_tag}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className={`${btn.danger} ${btn.sm} shrink-0 px-2 py-1`} aria-label={t("common.clear")}>
          <XIcon width={12} height={12} />
        </button>
      </div>
    );
  }
  // ค่าเดิมที่ยังไม่ผูก license: แสดงไว้ + ปุ่มเลือกจาก license
  if (legacy && !searching) {
    return (
      <div className={`${className} flex items-center gap-1.5`}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5" title={t("assets.software.legacyHint")}>
          <AlertIcon width={13} height={13} className="shrink-0 text-warning-500" />
          <span className="truncate">{legacy}</span>
        </span>
        {/* ปุ่มไอคอนเล็ก — ให้ข้อความเดิมมีที่แสดงแม้ช่องแคบ */}
        <button type="button" onClick={() => setSearching(true)} title={t("assets.software.link")} aria-label={t("assets.software.link")} className={`${btn.soft} ${btn.sm} shrink-0 px-1.5 py-1`}>
          <SearchIcon width={12} height={12} />
        </button>
        <button type="button" onClick={onClearLegacy} title={t("common.clear")} aria-label={t("common.clear")} className={`${btn.danger} ${btn.sm} shrink-0 px-1.5 py-1`}>
          <XIcon width={12} height={12} />
        </button>
      </div>
    );
  }
  return (
    <SoftwareSearch
      id={id}
      options={options}
      exclude={exclude}
      installed={installed}
      onPick={(ref) => (setSearching(false), onChange(ref))}
      onCancel={searching ? () => setSearching(false) : undefined}
      autoFocus={searching}
      placeholder={t("assets.software.searchPlaceholder")}
      className={className}
    />
  );
}

/** Software อื่นๆ: เลือกได้หลายรายการ */
export function SoftwareListPicker({ id, options, value, exclude, installed, onChange, className }: Omit<SlotProps, "value" | "legacy" | "onClearLegacy" | "onChange"> & { value: SoftwareRef[]; onChange: (list: SoftwareRef[]) => void }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((s) => (
            <Chip key={s.id} item={s} removeLabel={t("assets.software.remove", { name: s.name })} onRemove={() => onChange(value.filter((x) => x.id !== s.id))} />
          ))}
        </div>
      )}
      {adding || value.length === 0 ? (
        <div className="max-w-md">
          <SoftwareSearch
            id={id}
            options={options}
            exclude={[...exclude, ...value.map((v) => v.id)]}
            installed={installed}
            onPick={(ref) => (onChange([...value, ref]), setAdding(false))}
            onCancel={value.length ? () => setAdding(false) : undefined}
            autoFocus={adding}
            placeholder={t("assets.software.searchPlaceholder")}
            className={className}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${btn.soft} ${btn.sm}`}>
          <PlusIcon width={13} height={13} />
          {t("assets.software.addOther")}
        </button>
      )}
    </div>
  );
}
