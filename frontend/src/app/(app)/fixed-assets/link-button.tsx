"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { linkFixedAsset, searchAssetsForLink } from "@/app/actions/fixed-assets";
import { useConfirm } from "@/components/dialog-provider";
import { LinkIcon, ResetIcon, SearchIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { FixedAsset, FixedAssetAssetOption } from "@/lib/types";

/**
 * ผูก Fixed Asset กับสินทรัพย์ในระบบ (fixed_assets.link): ค้นเลขที่/รหัส/ชื่อ → เลือก = ผูกด้วยมือ (การซิงค์ไม่เปลี่ยนอีก)
 * ยกเลิกการผูก (ไม่ผูกกลับเอง) / กลับไปผูกอัตโนมัติตามเลขที่ทรัพย์สิน
 */
export function LinkFixedAssetButton({ fa, compact = false }: { fa: FixedAsset; compact?: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(fa.fanum);
  const [options, setOptions] = useState<FixedAssetAssetOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  // ค้นหาเมื่อพิมพ์ (หน่วง 300ms) — ผลของคำค้นเก่าที่ตอบช้าไม่ทับผลล่าสุด
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const search = (value: string, delay = 300) => {
    setQ(value);
    const term = value.trim();
    latest.current = term;
    if (timer.current) clearTimeout(timer.current);
    if (term.length < 2) {
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const rows = await searchAssetsForLink(term);
      if (latest.current !== term) return;
      setOptions(rows);
      setSearching(false);
    }, delay);
  };
  const openModal = () => {
    setError("");
    setOpen(true);
    search(fa.fanum, 0); // เริ่มด้วยเลขที่ทรัพย์สินของรายการนี้
  };

  const submit = (input: { asset_id: string | null } | { reset: true }) =>
    start(async () => {
      const res = await linkFixedAsset(fa.id, input);
      if (res.ok) {
        toast("success", res.message ?? "");
        setOpen(false);
      } else {
        setError(res.message ?? "");
      }
    });

  const unlink = async () => {
    if (!(await confirm(t("fixedAssets.confirmUnlink", { fanum: fa.fanum })))) return;
    submit({ asset_id: null });
  };

  const label = fa.asset ? t("fixedAssets.changeLink") : t("fixedAssets.link");
  return (
    <>
      {compact ? (
        <Tooltip label={label}>
          <button type="button" onClick={openModal} aria-label={label} className={`${btn.secondary} ${btn.icon}`}>
            <LinkIcon width={15} height={15} />
          </button>
        </Tooltip>
      ) : (
        <button type="button" onClick={openModal} className={`${btn.secondary} ${btn.sm}`}>
          <LinkIcon width={14} height={14} />
          {label}
        </button>
      )}
      {open && (
        <ModalShell id={`fa-link-${fa.id}`} title={label} subtitle={`${fa.fanum} · ${fa.description ?? ""}`} onClose={() => setOpen(false)} busy={pending}>
          <div className="space-y-4">
            {error && <p className={alert.error}>{error}</p>}
            {fa.asset && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-subtle p-3 text-sm">
                <span>
                  <span className="text-muted">{t("fixedAssets.currentLink")} </span>
                  <span className="font-mono">{fa.asset.cpu_tag || fa.asset.asset_tag}</span> {fa.asset.name}
                  <span className="ml-1 text-xs text-muted">({t(`fixedAssets.linkSource.${fa.link_source ?? "auto"}`)})</span>
                </span>
                <button type="button" onClick={unlink} disabled={pending} className={`${btn.danger} ${btn.sm}`}>
                  <XIcon width={14} height={14} />
                  {t("fixedAssets.unlink")}
                </button>
              </div>
            )}
            <div>
              <label htmlFor={`fa-q-${fa.id}`} className="mb-1 block text-sm font-medium">
                {t("fixedAssets.searchAsset")}
              </label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
                <input id={`fa-q-${fa.id}`} value={q} onChange={(e) => search(e.target.value)} maxLength={50} autoFocus className={`${input} pl-9`} />
                {searching && <SpinnerIcon width={14} height={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-accent-400" />}
              </div>
              <p className="mt-1 text-xs text-muted">{t("fixedAssets.searchAssetHint")}</p>
            </div>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={pending || o.id === fa.asset?.id}
                    onClick={() => submit({ asset_id: o.id })}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ring-1 ring-line hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-accent-400/10"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-accent-700 dark:text-accent-300">{o.cpu_tag || o.asset_tag}</span>
                      <span className="block truncate">{o.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{t(`status.${o.status}` as never)}</span>
                  </button>
                </li>
              ))}
              {!searching && q.trim().length >= 2 && options.length === 0 && <li className="px-1 text-sm text-muted">{t("fixedAssets.noAssetFound")}</li>}
            </ul>
            {fa.link_source === "manual" && (
              <div className="flex justify-end">
                <button type="button" onClick={() => submit({ reset: true })} disabled={pending} className={`${btn.secondary} ${btn.sm}`}>
                  {pending ? <SpinnerIcon width={14} height={14} /> : <ResetIcon width={14} height={14} />}
                  {t("fixedAssets.resetAuto")}
                </button>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}
