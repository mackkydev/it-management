"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelLeave, decideLeave } from "@/app/actions/calendar";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckIcon, PaperclipIcon, PrinterIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { LeaveRequest, LeaveStatus } from "@/lib/types";

const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: tone.warning.badge,
  approved: tone.success.badge,
  rejected: tone.danger.badge,
  cancelled: tone.idle.badge,
};

/** การ์ดใบลา — ใช้ทั้งหน้าใบลาของฉัน / ทั้งหมด / รออนุมัติ (showUser = แสดงชื่อผู้ลา) */
export function LeaveCard({ leave: l, showUser = false, highlight = false }: { leave: LeaveRequest; showUser?: boolean; highlight?: boolean }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const period = l.start_on === l.end_on ? fmt.date(l.start_on) : `${fmt.date(l.start_on)} – ${fmt.date(l.end_on)}`;
  const unit = t(`leave.units.${l.unit}`) + (l.unit === "hours" && l.start_time ? ` ${l.start_time}–${l.end_time}` : "");

  const decide = (approve: boolean) => {
    if (!approve && !note.trim()) return setError(t("leave.noteRequired"));
    start(async () => {
      const res = await decideLeave(l.id, approve, note);
      if (!res.ok) setError(res.message ?? "");
    });
  };
  const cancel = async () => {
    if (!(await confirm(t("leave.confirmCancel")))) return;
    start(async () => {
      const res = await cancelLeave(l.id);
      if (!res.ok) setError(res.message ?? "");
    });
  };

  return (
    <li id={`leave-${l.id}`} className={`space-y-2 p-4 ${card} ${highlight ? "ring-2 ring-accent-300" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {showUser && <span>{l.user.name}</span>}
            <span>{t(`leave.types.${l.leave_type}`)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[l.status]}`}>{t(`leave.statuses.${l.status}`)}</span>
          </p>
          <p className="text-sm text-muted">
            {period} · {unit} · {t("calendar.days", { n: fmt.number(l.days) })}
            {showUser && l.user.department && ` · ${l.user.department}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={`/leave-print/${l.id}`} target="_blank" className={`${btn.secondary} ${btn.sm}`}>
            <PrinterIcon width={14} height={14} />
            {t("leave.print")}
          </Link>
          {l.can_cancel && (
            <button type="button" onClick={cancel} disabled={pending} className={`${btn.danger} ${btn.sm}`}>
              {pending ? <SpinnerIcon width={14} height={14} /> : <XIcon width={14} height={14} />}
              {t("leave.cancel")}
            </button>
          )}
        </div>
      </div>
      {l.reason && <p className="whitespace-pre-line text-sm">{l.reason}</p>}
      <p className="text-xs text-muted">
        {l.approver && t("leave.approverLabel", { name: l.approver.name })}
        {l.decision_note && ` · ${t("leave.decisionNote", { note: l.decision_note })}`}
      </p>
      {l.files.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <PaperclipIcon width={13} height={13} className="text-muted" />
          {l.files.map((f) => (
            <a key={f.id} href={`/files/leave/${l.id}/files/${f.id}`} target="_blank" rel="noopener" className="text-accent-700 hover:underline dark:text-accent-300">
              {f.name}
            </a>
          ))}
        </p>
      )}
      {error && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {error}
        </p>
      )}
      {l.can_decide && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <input
            value={note}
            maxLength={2000}
            onChange={(e) => (setNote(e.target.value), setError(""))}
            placeholder={t("leave.note")}
            aria-label={t("leave.note")}
            className={`${input} min-w-48 flex-1 ${error && !note.trim() ? inputError : ""}`}
          />
          <button type="button" onClick={() => decide(false)} disabled={pending} className={btn.danger}>
            <XIcon />
            {t("leave.reject")}
          </button>
          <button type="button" onClick={() => decide(true)} disabled={pending} className={btn.primary}>
            {pending ? <SpinnerIcon /> : <CheckIcon />}
            {t("leave.approve")}
          </button>
        </div>
      )}
    </li>
  );
}
