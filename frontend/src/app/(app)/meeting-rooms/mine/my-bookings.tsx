"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBooking, deleteBooking } from "@/app/actions/meeting";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { PencilIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { btn, card, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MeetingBooking } from "@/lib/types";

/** รายการการจองของฉัน — แก้ไข / ยกเลิก / ลบ (ตามสิทธิ์ที่ API ส่งมาในแต่ละรายการ) */
export function MyBookings({ items }: { items: MeetingBooking[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const act = async (b: MeetingBooking, kind: "cancel" | "delete") => {
    if (!(await confirm(t(kind === "cancel" ? "meeting.booking.confirmCancel" : "meeting.booking.confirmDelete", { title: b.title })))) return;
    setBusy(b.id);
    start(async () => {
      const res = kind === "cancel" ? await cancelBooking(b.id) : await deleteBooking(b.id);
      setBusy(null);
      if (!res.ok) return void (await showAlert(res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };

  const status = (b: MeetingBooking) => {
    const [cls, key] = b.status === "cancelled" ? [tone.idle.badge, "cancelled"] : b.is_over ? [tone.info.badge, "over"] : [tone.success.badge, "confirmed"];
    return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`meeting.booking.statuses.${key as "confirmed" | "cancelled" | "over"}`)}</span>;
  };
  const actions = (b: MeetingBooking) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {b.can_edit && (
        <Link href={`/meeting-rooms/bookings/${b.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
          <PencilIcon width={14} height={14} />
          {t("meeting.booking.edit")}
        </Link>
      )}
      {b.can_cancel && (
        <button type="button" disabled={busy === b.id} onClick={() => act(b, "cancel")} className={`${btn.secondary} ${btn.sm}`}>
          {busy === b.id ? <SpinnerIcon width={14} height={14} /> : <XIcon width={14} height={14} />}
          {t("meeting.booking.cancel")}
        </button>
      )}
      {b.can_delete && (
        <button type="button" disabled={busy === b.id} onClick={() => act(b, "delete")} className={`${btn.danger} ${btn.sm}`}>
          {busy === b.id ? <SpinnerIcon width={14} height={14} /> : <TrashIcon width={14} height={14} />}
          {t("meeting.booking.delete")}
        </button>
      )}
    </div>
  );
  const when = (b: MeetingBooking) => (
    <>
      <Link href={`/meeting-rooms/day/${b.date}`} className="cursor-pointer font-medium hover:text-accent-600 dark:hover:text-accent-300">
        {b.end_date > b.date ? `${fmt.date(b.date)} – ${fmt.date(b.end_date)}` : fmt.date(b.date)}
      </Link>
      <span className="block text-xs text-muted">{t("meeting.timeRange", { start: b.start_time, end: b.end_time })}</span>
    </>
  );

  return (
    <>
      {/* จอใหญ่: ตาราง */}
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("meeting.detail.when")}</th>
              <th className={table.th}>{t("meeting.detail.room")}</th>
              <th className={table.th}>{t("meeting.form.title")}</th>
              <th className={table.th}>{t("meeting.detail.attendees")}</th>
              <th className={table.th}>{t("meeting.detail.purpose")}</th>
              <th className={table.th} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((b) => (
              <tr key={b.id} className={table.row}>
                <td className={`${table.td} whitespace-nowrap`}>{when(b)}</td>
                <td className={table.td}>{b.room.name}</td>
                <td className={table.td}>
                  <span className="block font-medium">{b.title}</span>
                  {b.equipment.length > 0 && <span className="block text-xs text-muted">{b.equipment.join(", ")}</span>}
                  <span className="mt-1 block">{status(b)}</span>
                </td>
                <td className={`${table.td} whitespace-nowrap`}>{t("meeting.detail.attendeesValue", { n: fmt.number(b.attendees) })}</td>
                <td className={table.td}>{b.purpose ?? "-"}</td>
                <td className={table.td}>{actions(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* จอเล็ก: การ์ด */}
      <ul className="space-y-3 md:hidden">
        {items.map((b) => (
          <li key={b.id} className={`space-y-2 p-4 ${card}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{b.title}</p>
                <p className="text-xs text-muted">{b.room.name}</p>
              </div>
              {status(b)}
            </div>
            <p className="text-sm">{when(b)}</p>
            {actions(b)}
          </li>
        ))}
      </ul>
    </>
  );
}
