"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { createAssetsFromFixedAssets } from "@/app/actions/fixed-assets";
import { AppSelect } from "@/components/app-select";
import { PlusIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * เลือก Fixed Asset ที่ยังไม่ผูกหลายรายการ → "เพิ่มเข้าระบบสินทรัพย์" (สร้างสินทรัพย์ใหม่ + ผูกให้)
 * ใช้กับรายการที่ยังไม่มีในระบบ — มีอยู่แล้วให้ใช้ปุ่มผูก / "ผูกตามเลขที่ทรัพย์สิน"
 * ที่เลือกจำไว้ระหว่างอยู่หน้าเดิม (เปลี่ยนหน้า/ตัวกรอง = ล้าง เพราะ provider ถูกสร้างใหม่)
 */

type Row = { id: number; fanum: string };
type Ctx = { selected: Map<number, string>; toggle: (rows: Row[], on: boolean) => void; clear: () => void };

const SelectionContext = createContext<Ctx | null>(null);
const useSelection = () => useContext(SelectionContext);

export function FaSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const toggle = useCallback((rows: Row[], on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (on) next.set(r.id, r.fanum);
        else next.delete(r.id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  const value = useMemo(() => ({ selected, toggle, clear }), [selected, toggle, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const BOX = "h-4 w-4 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed";

export function FaSelectBox({ id, fanum }: Row) {
  const { t } = useI18n();
  const ctx = useSelection();
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={ctx.selected.has(id)}
      onChange={(e) => ctx.toggle([{ id, fanum }], e.target.checked)}
      aria-label={t("fixedAssets.createAssets.selectRow", { fanum })}
    />
  );
}

export function FaSelectAllBox({ rows }: { rows: Row[] }) {
  const { t } = useI18n();
  const ctx = useSelection();
  if (!ctx || rows.length === 0) return null;
  const all = rows.every((r) => ctx.selected.has(r.id));
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={all}
      onChange={(e) => ctx.toggle(rows, e.target.checked)}
      aria-label={t("fixedAssets.createAssets.selectAll")}
    />
  );
}

/** แถบลอยล่างจอเมื่อมีรายการที่เลือก + กล่องเลือกหมวดหมู่ก่อนเพิ่มเข้าระบบ */
export function CreateAssetsBar({ categories }: { categories: { value: string; label: string }[] }) {
  const { t, fmt } = useI18n();
  const ctx = useSelection();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!ctx || ctx.selected.size === 0) return null;
  const n = ctx.selected.size;
  const numbers = [...ctx.selected.values()];

  const submit = () => {
    if (!category) {
      setError(t("fixedAssets.createAssets.chooseCategory"));
      return;
    }
    start(async () => {
      const res = await createAssetsFromFixedAssets([...ctx.selected.keys()], category);
      if (res.ok) {
        toast("success", res.message ?? "");
        setOpen(false);
        ctx.clear();
      } else if (res.errors?.category || res.errors?.ids) {
        setError(res.errors.category ?? res.errors.ids ?? null);
      } else {
        toast("error", res.message ?? "");
      }
    });
  };

  return (
    <>
      <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 shadow-lg ring-1 ring-accent-200 dark:ring-accent-400/30">
        <span className="text-sm font-medium">{t("fixedAssets.createAssets.selected", { n: fmt.number(n) })}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={ctx.clear} className={`${btn.secondary} ${btn.sm}`}>
            <XIcon />
            {t("fixedAssets.createAssets.clear")}
          </button>
          <button type="button" onClick={() => (setError(null), setOpen(true))} className={btn.primary}>
            <PlusIcon />
            {t("fixedAssets.createAssets.button")}
          </button>
        </div>
      </div>

      {open && (
        <ModalShell id="fa-create-assets" title={t("fixedAssets.createAssets.title", { n: fmt.number(n) })} subtitle={t("fixedAssets.createAssets.hint")} onClose={() => setOpen(false)} busy={pending}>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("fixedAssets.createAssets.category")}</span>
              <AppSelect
                value={category}
                onChange={(e) => (setCategory(e.target.value), setError(null))}
                className={input}
                aria-label={t("fixedAssets.createAssets.category")}
                options={[{ value: "", label: t("fixedAssets.createAssets.chooseCategory") }, ...categories]}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </label>
            {category === "COMPUTER" && <p className="text-xs text-muted">{t("fixedAssets.createAssets.computerNote")}</p>}
            <p className="text-xs text-muted">{t("fixedAssets.createAssets.mapping")}</p>
            <p className="break-words rounded-xl bg-subtle px-3 py-2 font-mono text-xs">
              {numbers.slice(0, 30).join(", ")}
              {n > 30 && <span className="font-sans text-muted"> {t("fixedAssets.createAssets.more", { n: fmt.number(n - 30) })}</span>}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
              {pending ? <SpinnerIcon /> : <PlusIcon />}
              {t("fixedAssets.createAssets.confirm")}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
