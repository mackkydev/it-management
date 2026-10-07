"use client";

import { useState, type KeyboardEvent } from "react";
import { quickCreateLocation } from "@/app/actions/locations";
import { MapPinIcon, PlusIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Location } from "@/lib/types";

interface Props {
  id: string;
  locations: Location[];
  /** location_id (string ว่าง = ไม่ระบุ) */
  value: string;
  onChange: (id: string) => void;
  className: string;
}

const MAX_SHOWN = 50;

/**
 * ช่องสถานที่: พิมพ์เพื่อค้นจากชื่อ/รหัส → เลือกจากรายการที่ตรง
 * ไม่มีชื่อที่ตรงกัน → "+ เพิ่มสถานที่" สร้างใหม่ทันที (API ออกรหัส LOC-#### และประเภท "ห้อง" ให้ — แก้ได้ที่หน้าสถานที่)
 */
export function LocationPicker({ id, locations: initial, value, onChange, className }: Props) {
  const { t } = useI18n();
  const [locations, setLocations] = useState(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const selected = locations.find((l) => String(l.id) === value);
  const q = query.trim().toLowerCase();
  const matches = (q ? locations.filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)) : locations).slice(0, MAX_SHOWN);
  // เสนอเพิ่มใหม่เมื่อพิมพ์แล้วยังไม่มีชื่อนี้ตรงตัว
  const canAdd = q !== "" && !locations.some((l) => l.name.trim().toLowerCase() === q);
  const count = matches.length + (canAdd ? 1 : 0);

  const pick = (loc: Location) => {
    onChange(String(loc.id));
    setQuery("");
    setOpen(false);
    setError("");
  };

  const add = async () => {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    const res = await quickCreateLocation(name);
    setCreating(false);
    if (res.location) {
      setLocations((list) => [...list, res.location!].sort((a, b) => a.name.localeCompare(b.name, "th")));
      pick(res.location);
    } else setError(res.message ?? t("common.saveFailed"));
  };

  const choose = (i: number) => (i < matches.length ? pick(matches[i]) : add());

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Enter ห้ามส่งฟอร์มสินทรัพย์ — ใช้เลือก/เพิ่มสถานที่แทน
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
          <MapPinIcon width={14} height={14} className="shrink-0 text-accent-500" />
          <span className="truncate">{selected.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{selected.code}</span>
        </span>
        <button type="button" onClick={() => onChange("")} className={`${btn.danger} ${btn.sm} shrink-0 px-2 py-1`} aria-label={t("assets.form.locationClear")}>
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
        maxLength={255}
        placeholder={t("assets.form.locationPlaceholder")}
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
          {matches.map((l, i) => (
            <li
              key={l.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(l))}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
            >
              <span className="truncate font-medium text-ink">{l.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">{l.code}</span>
            </li>
          ))}
          {matches.length === 0 && !canAdd && <li className="px-3 py-2 text-muted">{t("assets.form.noLocations")}</li>}
          {canAdd && (
            <li
              role="option"
              aria-selected={active === matches.length}
              onMouseDown={(e) => (e.preventDefault(), add())}
              onMouseEnter={() => setActive(matches.length)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-accent-700 dark:text-accent-300 ${
                matches.length ? "border-t border-line" : ""
              } ${active === matches.length ? "bg-accent-50 dark:bg-accent-400/10" : ""}`}
            >
              {creating ? <SpinnerIcon width={14} height={14} className="shrink-0" /> : <PlusIcon width={14} height={14} className="shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate">{t("assets.form.locationAdd", { name: query.trim() })}</span>
                <span className="block text-xs font-normal text-muted">{t("assets.form.locationAddHint")}</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}
