"use client";

import { useTransition } from "react";
import { applyFixedAssetAutoLink, previewFixedAssetAutoLink } from "@/app/actions/fixed-assets";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { LinkIcon, SpinnerIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * ปุ่ม "ผูกตามเลขที่ทรัพย์สิน" (fixed_assets.link): ดูก่อนว่าผูกได้กี่รายการ → ยืนยัน → ผูกทีเดียว
 * กติกา (API autoLinkPlan): Fixed asset number = เลขที่ทรัพย์สิน, Manufacturer = เลขที่ทรัพย์สิน (เดิม) — ตรงเครื่องเดียวเท่านั้น
 */
export function AutoLinkButton() {
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
      const { total, by_rule: rule, conflicts } = preview.data;
      // ข้อความหลายบรรทัด — กล่องยืนยันแสดงแบบ whitespace-pre-line
      const skipped = conflicts > 0 ? "\n" + t("fixedAssets.autoLink.conflicts", { n: fmt.number(conflicts) }) : "";
      if (total === 0) {
        await alertBox(t("fixedAssets.autoLink.none") + skipped);
        return;
      }
      const msg = t("fixedAssets.autoLink.confirm", {
        total: fmt.number(total),
        number: fmt.number(rule.number),
        old: fmt.number(rule.old_number),
      });
      if (!(await confirm(msg + skipped, { danger: false, confirmText: t("fixedAssets.autoLink.button") }))) return;
      const res = await applyFixedAssetAutoLink();
      toast(res.ok ? "success" : "error", res.message ?? "");
    });

  return (
    <button type="button" onClick={run} disabled={pending} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
      {pending ? <SpinnerIcon /> : <LinkIcon />}
      {t("fixedAssets.autoLink.button")}
    </button>
  );
}
