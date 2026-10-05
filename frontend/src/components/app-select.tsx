"use client";

import { Children, isValidElement, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@/components/icons";
import { useDismiss, useFloating } from "@/components/floating";
import { useI18n } from "@/i18n/client";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** event แบบเดียวกับ <select onChange> (ใช้ e.target.name / e.target.value) — เปลี่ยนจาก <select> ได้โดยไม่ต้องแก้ handler */
export interface SelectChangeEvent {
  target: { name: string; value: string };
  currentTarget: { name: string; value: string };
}

interface Props {
  id?: string;
  name?: string;
  /** โหมดควบคุม */
  value?: string;
  /** โหมดไม่ควบคุม (ฟอร์ม GET ของหน้ากรอง) — ใช้คู่กับ name (ส่งค่าด้วย hidden input) */
  defaultValue?: string;
  /** รับ handler เดิมของ <select> ได้เลย (อ่าน e.target.name / e.target.value) */
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  onValueChange?: (value: string) => void;
  /** รายการ — หรือใส่เป็น <option> ใน children แบบเดียวกับ <select> */
  options?: SelectOption[];
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** class ของปุ่ม (ใช้ `input` / `inputError` จาก components/ui เหมือนช่องกรอก) */
  className?: string;
  "aria-label"?: string;
  /** แสดงช่องค้นหาเมื่อมีรายการมากกว่าค่านี้ (ค่าเริ่มต้น 8) */
  searchThreshold?: number;
}

/** อ่าน <option value>label</option> (รวมใน fragment / array / เงื่อนไข) เป็นรายการ */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      if (el.type === "option") {
        const label = el.props.children;
        out.push({ value: el.props.value !== undefined ? String(el.props.value) : String(label ?? ""), label, disabled: el.props.disabled });
      } else if (el.props.children) walk(el.props.children);
    });
  };
  walk(children);
  return out;
}

const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : "";

/**
 * Dropdown มาตรฐานของระบบ (ใช้แทน <select> ทุกที่)
 * ปุ่มหน้าตาเหมือนช่องกรอก + รายการลอย: ตัวที่เลือกอยู่พื้นจาง + เครื่องหมายถูกด้านขวา, คีย์บอร์ด ↑ ↓ Enter Esc, ค้นหาเมื่อรายการยาว
 * ค่าว่าง ("") = ตัวเลือกแรกที่เป็น placeholder เช่น "— เลือกสาขา —"
 */
export function AppSelect({
  id,
  name,
  value,
  defaultValue = "",
  onChange,
  onValueChange,
  options,
  children,
  disabled,
  required,
  className = "",
  searchThreshold = 8,
  ...rest
}: Props) {
  const { t } = useI18n();
  const items = useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const style = useFloating(buttonRef, open, { minWidth: 200, height: 300 });
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useDismiss(open, [buttonRef, listRef], close);

  const selected = items.find((o) => o.value === current);
  const searchable = items.length > searchThreshold;
  const shown = query ? items.filter((o) => textOf(o.label).toLowerCase().includes(query.toLowerCase())) : items;

  const choose = (o: SelectOption) => {
    if (o.disabled) return;
    if (!controlled) setInner(o.value);
    const target = { name: name ?? id ?? "", value: o.value };
    onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
    onValueChange?.(o.value);
    close();
    buttonRef.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, items.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        let n = i;
        for (let k = 0; k < shown.length; k++) {
          n = (n + step + shown.length) % shown.length;
          if (!shown[n]?.disabled) break;
        }
        listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: "nearest" });
        return n;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === "Tab") close();
  };

  const placeholder = !selected || selected.value === "";

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={rest["aria-label"]}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        className={`${className} flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`min-w-0 flex-1 truncate ${placeholder ? "text-muted" : "text-ink"}`}>{selected?.label ?? items[0]?.label ?? ""}</span>
        <ChevronDownIcon width={16} height={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}

      {open &&
        createPortal(
          <div
            ref={listRef}
            style={style}
            onKeyDown={onKey}
            className="overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-line"
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <SearchIcon width={14} height={14} className="shrink-0 text-faint" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder={t("common.search")}
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                />
              </div>
            )}
            <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
              {shown.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t("common.noResults")}</p>}
              {shown.map((o, i) => {
                const isSelected = o.value === current;
                return (
                  <div
                    key={`${o.value}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-ink transition-colors ${
                      o.disabled ? "cursor-not-allowed opacity-40" : ""
                    } ${isSelected ? "bg-subtle font-medium" : i === active ? "bg-subtle/60" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {isSelected && <CheckIcon width={15} height={15} className="shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
