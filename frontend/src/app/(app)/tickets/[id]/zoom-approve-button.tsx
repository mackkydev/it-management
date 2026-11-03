"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveZoomBooking } from "@/app/actions/zoom";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { CheckCircleIcon, SpinnerIcon } from "@/components/icons";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ใบงานของการจอง ZOOM: ผู้จัดการ IT กดอนุมัติ = ประทับชื่อ + ลายเซ็นในโปรไฟล์ลงใบงาน (ไม่มีฟอร์ม) */
export function ZoomApproveButton({ bookingId }: { bookingId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  const approve = async () => {
    if (!(await confirm(t("zoom.actions.approveConfirm"), { danger: false }))) return;
    setBusy(true);
    start(async () => {
      const res = await approveZoomBooking(bookingId);
      setBusy(false);
      if (!res.ok) return void (await showAlert(res.errors?.signature ?? res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };

  return (
    <section className={`space-y-2 p-4 sm:p-5 ${card}`}>
      <h2 className="font-semibold">{t("zoom.actions.headTitle")}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={approve} disabled={busy} className={btn.primary}>
          {busy ? <SpinnerIcon width={16} height={16} /> : <CheckCircleIcon width={16} height={16} />}
          {t("zoom.actions.approve")}
        </button>
        <p className="text-xs text-muted">{t("zoom.actions.approveHint")}</p>
      </div>
    </section>
  );
}
