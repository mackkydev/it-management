"use client";

import { useTransition } from "react";
import { previewFixedAssetAutoLink, unlinkAllFixedAssets } from "@/app/actions/fixed-assets";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { SpinnerIcon, XIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * ปุ่ม "ยกเลิกการผูกทั้งหมด" (fixed_assets.link): ดูจำนวนที่ผูกอยู่ → popup ยืนยัน → ล้างการผูกทุกรายการ (รวมที่ผูกด้วยมือ)
 * ไม่ลบข้อมูลที่ซิงค์ — กด "ผูกตามเลขที่ทรัพย์สิน" ใหม่ได้
 */
export function UnlinkAllButton() {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const alertBox = useAlert();
  const toast = useToast();
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const preview = await previewFixedAssetAutoLink();
      if (!preview.data) {
        toast("error", preview.message ?? "");
        return;
      }
      const { linked = 0, manual = 0 } = preview.data;
      if (linked === 0) {
        await alertBox(t("fixedAssets.unlinkAll.none"));
        return;
      }
      const msg = t("fixedAssets.unlinkAll.confirm", { n: fmt.number(linked), manual: fmt.number(manual) });
      if (!(await confirm(msg, { confirmText: t("fixedAssets.unlinkAll.button") }))) return;
      const res = await unlinkAllFixedAssets();
      toast(res.ok ? "success" : "error", res.message ?? "");
    });

  return (
    <button type="button" onClick={run} disabled={pending} aria-busy={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
      {pending ? <SpinnerIcon /> : <XIcon />}
      {t("fixedAssets.unlinkAll.button")}
    </button>
  );
}
