"use client";

import Link from "next/link";
import { useTransition } from "react";
import { cancelBooking, deleteBooking } from "@/app/actions/meeting";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { PencilIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MeetingBooking } from "@/lib/types";
import type { RoomTone } from "./meeting-utils";

/** รายละเอียดการจอง (กล่องลอย) — เจ้าของ / ผู้มีสิทธิ์จัดการ แก้ไข / ยกเลิก / ลบได้ */
export function BookingDialog({ booking: b, tone, onClose, onChanged }: { booking: MeetingBooking; tone: RoomTone; onClose: () => void; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [pending, start] = useTransition();

  const act = async (kind: "cancel" | "delete") => {
    if (!(await confirm(t(kind === "cancel" ? "meeting.booking.confirmCancel" : "meeting.booking.confirmDelete", { title: b.title })))) return;
    start(async () => {
      const res = kind === "cancel" ? await cancelBooking(b.id) : await deleteBooking(b.id);
      if (!res.ok) return void (await showAlert(res.message ?? t("common.saveFailed")));
      onChanged();
      onClose();
    });
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`w-full max-w-md space-y-3 p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.bar}`}>{b.room.name}</span>
            <h3 className="mt-1.5 break-words font-semibold">{b.title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} shrink-0 px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        <dl className="divide-y divide-line">
          {row(t("meeting.detail.when"), `${fmt.date(b.date)} · ${t("meeting.timeRange", { start: b.start_time, end: b.end_time })}`)}
          {row(t("meeting.detail.booker"), b.user.name)}
          {row(t("meeting.detail.department"), b.department || t("meeting.detail.none"))}
          {row(t("meeting.detail.attendees"), t("meeting.detail.attendeesValue", { n: fmt.number(b.attendees) }))}
          {row(t("meeting.detail.purpose"), b.purpose || t("meeting.detail.none"))}
          {row(t("meeting.detail.equipment"), b.equipment.length ? b.equipment.join(", ") : t("meeting.detail.none"))}
          {b.note && row(t("meeting.detail.note"), <span className="whitespace-pre-line">{b.note}</span>)}
        </dl>
        {(b.can_edit || b.can_cancel || b.can_delete) && (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {b.can_edit && (
              <Link href={`/meeting-rooms/bookings/${b.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                <PencilIcon width={14} height={14} />
                {t("meeting.booking.edit")}
              </Link>
            )}
            {b.can_cancel && (
              <button type="button" disabled={pending} onClick={() => act("cancel")} className={`${btn.secondary} ${btn.sm}`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <XIcon width={14} height={14} />}
                {t("meeting.booking.cancel")}
              </button>
            )}
            {b.can_delete && (
              <button type="button" disabled={pending} onClick={() => act("delete")} className={`${btn.danger} ${btn.sm}`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <TrashIcon width={14} height={14} />}
                {t("meeting.booking.delete")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
