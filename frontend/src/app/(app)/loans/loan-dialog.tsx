"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { loanAction } from "@/app/actions/loans";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { BoxIcon, CheckCircleIcon, InboxIcon, PencilIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Loan } from "@/lib/types";
import { LoanStatusBadge } from "./loan-status";
import { deviceLabel, periodText } from "./loan-utils";

/**
 * รายละเอียดการยืม (กล่องลอย) — แก้ไข / ยกเลิก (ผู้ยืมระหว่างยังไม่ส่งมอบ หรือผู้จัดการ),
 * ส่งมอบ / รับคืน (+ หมายเหตุสภาพอุปกรณ์) เฉพาะผู้จัดการ (loans.manage) — ปุ่มตาม can_* จาก API
 */
export function LoanDialog({ loan: initial, onClose, onChanged }: { loan: Loan; onClose: () => void; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [l, setL] = useState(initial);
  const [returnNote, setReturnNote] = useState("");
  const [pending, start] = useTransition();
  const period = periodText(l, fmt.date);
  const device = deviceLabel(l.asset);

  const act = async (action: "cancel" | "hand-out" | "return") => {
    const msg =
      action === "cancel"
        ? t("loan.actions.confirmCancel", { device, period })
        : action === "hand-out"
          ? t("loan.actions.confirmHandOut", { device, name: l.user.name })
          : t("loan.actions.confirmReturn", { device, name: l.user.name });
    if (!(await confirm(msg))) return;
    start(async () => {
      const res = await loanAction(l.id, action, returnNote);
      if (!res.loan) return void (await showAlert(res.errors?.status ?? res.message ?? t("common.saveFailed")));
      setL(res.loan);
      onChanged();
    });
  };

  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <LoanStatusBadge loan={l} />
            <h3 className="flex items-center gap-1.5 break-words font-semibold">
              <BoxIcon width={16} height={16} className="shrink-0 text-accent-500" />
              {device}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} shrink-0 px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        <dl className="divide-y divide-line">
          {row(t("loan.detail.when"), period)}
          {row(t("loan.detail.borrower"), l.user.name)}
          {row(t("loan.detail.department"), l.department || "-")}
          {row(t("loan.detail.purpose"), <span className="whitespace-pre-line">{l.purpose}</span>)}
          {l.note && row(t("loan.detail.note"), <span className="whitespace-pre-line">{l.note}</span>)}
          {l.handed_out_at && row(t("loan.detail.handedOut"), `${fmt.dateTime(l.handed_out_at)}${l.handed_out_by ? ` · ${l.handed_out_by}` : ""}`)}
          {l.returned_at && row(t("loan.detail.returned"), `${fmt.dateTime(l.returned_at)}${l.returned_by ? ` · ${l.returned_by}` : ""}`)}
          {l.return_note && row(t("loan.detail.returnNote"), <span className="whitespace-pre-line">{l.return_note}</span>)}
        </dl>

        {/* รับคืน: หมายเหตุสภาพอุปกรณ์ (ไม่บังคับ) */}
        {l.can_return && (
          <div className="space-y-1.5 rounded-xl bg-subtle/60 p-3">
            <label htmlFor="return-note" className="block text-xs font-medium text-muted">
              {t("loan.actions.returnNote")}
            </label>
            <textarea id="return-note" rows={2} maxLength={2000} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} className={input} />
          </div>
        )}

        {(l.can_edit || l.can_cancel || l.can_hand_out || l.can_return) && (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {l.can_edit && (
              <Link href={`/loans/${l.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                <PencilIcon width={14} height={14} />
                {t("loan.actions.edit")}
              </Link>
            )}
            {l.can_cancel && (
              <button type="button" disabled={pending} onClick={() => act("cancel")} className={`${btn.secondary} ${btn.sm}`}>
                <XIcon width={14} height={14} />
                {t("loan.actions.cancel")}
              </button>
            )}
            {l.can_hand_out && (
              <button type="button" disabled={pending} onClick={() => act("hand-out")} className={`${btn.primary} ${btn.sm}`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <InboxIcon width={14} height={14} />}
                {t("loan.actions.handOut")}
              </button>
            )}
            {l.can_return && (
              <button type="button" disabled={pending} onClick={() => act("return")} className={`${btn.primary} ${btn.sm}`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <CheckCircleIcon width={14} height={14} />}
                {t("loan.actions.return")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
