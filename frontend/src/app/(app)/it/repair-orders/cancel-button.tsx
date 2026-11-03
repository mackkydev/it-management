"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelRepairOrder } from "@/app/actions/repair-orders";
import { SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ปุ่ม "ยกเลิก" + กล่องกรอกเหตุผล — รายการยังเก็บไว้ในแท็บยกเลิก, สินทรัพย์กลับสถานะเดิม */
export function CancelButton({ id, item, full = false }: { id: string; item: string; full?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setReason("");
    setError("");
    setOpen(true);
  };
  const save = () => {
    if (!reason.trim()) return setError(t("repairOrders.validate.reason"));
    start(async () => {
      const r = await cancelRepairOrder(id, reason);
      if (r.ok) {
        setOpen(false);
        return router.refresh();
      }
      setError(Object.values(r.errors ?? {})[0] ?? r.message ?? t("common.saveFailed"));
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={full ? `${btn.secondary} w-full` : `${btn.secondary} ${btn.sm}`}>
        <XIcon width={13} height={13} />
        {t("repairOrders.cancel.button")}
      </button>
      {open && (
        <ModalShell id="repair-cancel" title={t("repairOrders.cancel.title")} subtitle={item} onClose={() => setOpen(false)} busy={pending}>
          <div className="space-y-4">
            <div>
              <label htmlFor="cancel_reason" className="mb-1 block text-sm font-medium">
                {t("repairOrders.cancel.reason")}
                <span className="text-red-500"> *</span>
              </label>
              <textarea
                id="cancel_reason"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError("");
                }}
                className={`${input} ${error ? inputError : ""}`}
              />
              {error && (
                <p role="alert" className="mt-1 text-xs font-medium text-red-500">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
                <XIcon width={14} height={14} />
                {t("common.close")}
              </button>
              <button type="button" onClick={save} disabled={pending} className={`${btn.danger} disabled:cursor-not-allowed`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <XIcon width={14} height={14} />}
                {t("repairOrders.cancel.submit")}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
