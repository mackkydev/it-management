"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { linkMissingAsset, suggestAssetsToLink } from "@/app/actions/assets";
import { ExternalLinkIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { SuggestInput } from "@/components/suggest-input";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** เลขในใบแจ้งซ่อมไม่ตรงสินทรัพย์ที่มีอยู่ (เช่น ผู้แจ้งพิมพ์ผิด) — เลือกสินทรัพย์ให้เอง แล้วใบเหล่านั้นขึ้นประวัติซ่อมของเครื่อง */
export function LinkMissingAsset({ assetNo, full = false }: { assetNo: string; full?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setTag("");
    setError("");
    setOpen(true);
  };
  const save = () => {
    if (!tag.trim()) return setError(t("assets.missing.linkRequired"));
    start(async () => {
      const res = await linkMissingAsset(assetNo, tag.trim());
      if (res.ok) {
        setOpen(false);
        return router.refresh();
      }
      setError(res.message ?? t("common.saveFailed"));
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={full ? `${btn.secondary} mt-2 w-full` : `${btn.secondary} ${btn.sm}`}>
        <ExternalLinkIcon width={13} height={13} />
        {t("assets.missing.link")}
      </button>
      {open && (
        <ModalShell id="link-missing-asset" title={t("assets.missing.linkTitle", { no: assetNo })} subtitle={t("assets.missing.linkHint")} onClose={() => setOpen(false)} busy={pending}>
          <label htmlFor="link-asset-tag" className="mb-1 block text-sm font-medium">
            {t("assets.missing.linkAsset")}
          </label>
          <SuggestInput
            id="link-asset-tag"
            value={tag}
            onChange={(v) => {
              setTag(v);
              setError("");
            }}
            load={suggestAssetsToLink}
            allowNew={false}
            className={`${input} ${error ? inputError : ""}`}
          />
          {error && <p role="alert" className={`mt-2 ${alert.error}`}>{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
              <XIcon width={14} height={14} />
              {t("common.cancel")}
            </button>
            <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
              {pending ? <SpinnerIcon width={14} height={14} /> : <ExternalLinkIcon width={14} height={14} />}
              {t("assets.missing.link")}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
