"use client";

import { useState, type KeyboardEvent } from "react";
import { PlusIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, input, inputError } from "@/components/ui";

/** รายการแบบ chip: พิมพ์แล้วกด Enter/ปุ่มเพิ่ม, กด × เพื่อลบ — grid = เรียงเป็นตาราง บรรทัดละ 5 (จอใหญ่) ช่องกรอกอยู่ต่อจากรายการ */
export function ChipList({
  items,
  onChange,
  placeholder,
  addLabel,
  validate,
  emptyText,
  grid = false,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  addLabel: string;
  validate: (v: string) => string | null;
  emptyText?: string;
  grid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const err = validate(v);
    if (err) return setError(err);
    onChange([...items, v]);
    setDraft("");
    setError("");
  };

  const draftRow = (
    <div className="flex min-w-0 gap-2">
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => (setDraft(e.target.value), setError(""))}
        onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), add())}
        className={`${input} min-w-0 ${error ? inputError : ""}`}
      />
      <button type="button" onClick={add} className={`${btn.secondary} shrink-0`}>
        <PlusIcon width={14} height={14} className="text-accent-500" />
        {addLabel}
      </button>
    </div>
  );

  if (grid) {
    return (
      <div>
        {items.length === 0 && emptyText && <p className="mb-2 text-sm text-muted">{emptyText}</p>}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {items.map((it) => (
            <span key={it} className="flex min-h-10 min-w-0 items-center gap-1 rounded-xl bg-accent-100 py-1 pl-3 pr-1 text-sm text-accent-900 dark:bg-accent-400/15 dark:text-accent-100">
              <Tooltip label={it}>
                <span className="block min-w-0 flex-1 truncate">{it}</span>
              </Tooltip>
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x !== it))}
                aria-label={`× ${it}`}
                className="ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent-200 dark:hover:bg-accent-400/30"
              >
                <XIcon width={12} height={12} />
              </button>
            </span>
          ))}
          <div className="sm:col-span-2 lg:col-span-2">{draftRow}</div>
        </div>
        {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex min-h-9 flex-wrap gap-1.5">
        {items.length === 0 && emptyText && <span className="text-sm text-muted">{emptyText}</span>}
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 rounded-full bg-accent-100 py-1 pl-3 pr-1 text-sm text-accent-900 dark:bg-accent-400/15 dark:text-accent-100">
            {it}
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== it))}
              aria-label={`× ${it}`}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent-200 dark:hover:bg-accent-400/30"
            >
              <XIcon width={12} height={12} />
            </button>
          </span>
        ))}
      </div>
      {draftRow}
      {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}
