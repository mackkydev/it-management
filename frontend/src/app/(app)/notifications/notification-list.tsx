"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { clearNotifications, deleteNotification, markAllNotificationsRead, markNotificationRead } from "@/app/actions/tickets";
import { CheckIcon, ClipboardIcon, FileTextIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { DATA_CHANGED_EVENT } from "@/components/live-refresh";
import { notificationHref, notificationText } from "@/components/shell/notification-text";
import { Tooltip } from "@/components/tooltip";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AppNotification } from "@/lib/types";

/** แจ้งให้กระดิ่งโหลดจำนวนใหม่ทันที */
const refreshBell = () => window.dispatchEvent(new Event(DATA_CHANGED_EVENT));

/** ปุ่มจัดการทั้งหมด: อ่านทั้งหมด / ลบที่อ่านแล้ว / ลบทั้งหมด */
export function NotificationActions({ unread, total }: { unread: number; total: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<void>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      await action();
      refreshBell();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending && <SpinnerIcon className="text-accent-500" />}
      <button type="button" disabled={pending || unread === 0} onClick={() => run(markAllNotificationsRead)} className={`${btn.secondary} ${btn.sm} disabled:cursor-not-allowed`}>
        <CheckIcon width={14} height={14} className="text-accent-500" />
        {t("notifications.markAll")}
      </button>
      <button
        type="button"
        disabled={pending || total - unread === 0}
        onClick={() => run(() => clearNotifications("read"), t("notifications.page.confirmClearRead"))}
        className={`${btn.secondary} ${btn.sm} disabled:cursor-not-allowed`}
      >
        <TrashIcon width={14} height={14} className="text-faint" />
        {t("notifications.page.clearRead")}
      </button>
      <button
        type="button"
        disabled={pending || total === 0}
        onClick={() => run(() => clearNotifications("all"), t("notifications.page.confirmClearAll"))}
        className={`${btn.danger} ${btn.sm} disabled:cursor-not-allowed`}
      >
        <TrashIcon width={14} height={14} />
        {t("notifications.page.clearAll")}
      </button>
    </div>
  );
}

/** รายการแจ้งเตือน: คลิก = ทำเครื่องหมายอ่านแล้ว + ไปหน้าที่เกี่ยวข้อง, ปุ่มถังขยะ = ลบรายการนั้น */
export function NotificationList({ items }: { items: AppNotification[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const open = (n: AppNotification) => {
    start(async () => {
      if (!n.read_at) {
        await markNotificationRead(n.id);
        refreshBell();
      }
      router.push(notificationHref(n));
    });
  };

  const remove = (n: AppNotification) => {
    start(async () => {
      await deleteNotification(n.id);
      refreshBell();
      router.refresh();
    });
  };

  return (
    <ul className={`divide-y divide-line overflow-hidden ${card} ${pending ? "opacity-70" : ""}`}>
      {items.map((n) => {
        const Icon = n.data.kind === "ticket" ? ClipboardIcon : FileTextIcon;
        return (
          <li key={n.id} className={`flex items-start gap-1 pr-2 transition-colors hover:bg-subtle ${n.read_at ? "" : "bg-accent-50/60 dark:bg-accent-400/[0.06]"}`}>
            <button type="button" onClick={() => open(n)} disabled={pending} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-4 py-3 text-left">
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  n.data.kind === "ticket"
                    ? "bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300"
                    : "bg-warning-100 text-warning-700 dark:bg-warning-400/15 dark:text-warning-300"
                }`}
              >
                <Icon width={16} height={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${n.read_at ? "text-muted" : "font-medium text-ink"}`}>{notificationText(n, t)}</span>
                <span className="mt-0.5 block text-xs text-faint">{fmt.dateTime(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />}
            </button>
            <Tooltip label={t("notifications.page.delete")} side="top">
              <button
                type="button"
                onClick={() => remove(n)}
                disabled={pending}
                aria-label={t("notifications.page.delete")}
                className="mt-3 cursor-pointer rounded-lg p-2 text-faint transition-colors hover:bg-surface hover:text-danger-500 disabled:cursor-not-allowed"
              >
                <TrashIcon width={15} height={15} />
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
