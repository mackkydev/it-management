"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { markNotificationRead } from "@/app/actions/tickets";
import { AlertIcon, BellIcon, CheckCircleIcon, ChevronRightIcon, ClipboardIcon, FileTextIcon, XIcon } from "@/components/icons";
import { btn, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AppNotification, PublicAnnouncement } from "@/lib/types";
import { WELCOME_COOKIE } from "@/lib/welcome";
import { notificationHref, notificationText } from "./notification-text";

const MAX_ITEMS = 5;
const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;

/**
 * หน้าต่างสรุปหลัง login — แสดงครั้งเดียวต่อการ login
 *   กล่องซ้าย: งานที่รอฉันอนุมัติ + การแจ้งเตือนที่ยังไม่อ่าน   กล่องขวา: ประกาศจากฝ่าย IT (ถ้ามี)
 * (layout ส่งข้อมูลมาเมื่อมี cookie eam_welcome; หน้าต่างลบ cookie ทันทีที่แสดง)
 */
export function LoginDigest({
  items,
  unread,
  approvals,
  announcements,
}: {
  items: AppNotification[];
  unread: number;
  approvals: number;
  announcements: PublicAnnouncement[];
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const list = items.filter((n) => !n.read_at).slice(0, MAX_ITEMS);
  const pending = approvals > 0 || list.length > 0;
  const hasNews = announcements.length > 0;

  useEffect(() => {
    document.cookie = `${WELCOME_COOKIE}=; Max-Age=0; path=/`; // รีเฟรชหน้าแล้วไม่เด้งซ้ำ
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const go = (n: AppNotification) => {
    setOpen(false);
    void markNotificationRead(n.id);
    router.push(notificationHref(n));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-digest-title"
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${hasNews ? "max-w-3xl" : "max-w-md"} overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
              <BellIcon width={20} height={20} className={pending ? "bell-ring" : undefined} />
            </span>
            <div>
              <h2 id="login-digest-title" className="font-semibold">
                {t(pending ? "loginDigest.title" : "loginDigest.titleAnnouncements")}
              </h2>
              <p className="text-sm text-muted">{t(pending ? "loginDigest.subtitle" : "loginDigest.subtitleAnnouncements")}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className={`grid max-h-[65vh] gap-4 overflow-y-auto p-5 ${hasNews ? "md:grid-cols-2" : ""}`}>
          {/* กล่องการแจ้งเตือน */}
          <section className="space-y-3 rounded-xl p-4 ring-1 ring-line">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BellIcon width={15} height={15} className="text-accent-500" />
              {t("loginDigest.notifications")}
            </p>
            {!pending && <p className="py-6 text-center text-sm text-muted">{t("loginDigest.nothingPending")}</p>}

            {approvals > 0 && (
              <Link
                href="/tickets/approvals"
                onClick={() => setOpen(false)}
                className="flex cursor-pointer items-center gap-3 rounded-xl bg-warning-100 px-4 py-3 text-warning-800 ring-1 ring-warning-200 transition-colors hover:bg-warning-200/70 dark:bg-warning-400/15 dark:text-warning-200 dark:ring-warning-400/30"
              >
                <CheckCircleIcon width={18} height={18} className="shrink-0" />
                <span className="flex-1 text-sm font-medium">{t("loginDigest.approvals", { count: fmt.number(approvals) })}</span>
                <ChevronRightIcon width={16} height={16} />
              </Link>
            )}

            {list.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">{t("loginDigest.unread", { count: fmt.number(unread) })}</p>
                <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                  {list.map((n) => {
                    const Icon = n.data.kind === "ticket" ? ClipboardIcon : FileTextIcon;
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => go(n)} className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle">
                          <Icon width={15} height={15} className="mt-0.5 shrink-0 text-accent-500" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-ink">{notificationText(n, t)}</span>
                            <span className="mt-0.5 block text-xs text-faint">{fmt.dateTime(n.created_at)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {unread > list.length && <p className="mt-1.5 text-xs text-muted">{t("loginDigest.more", { count: fmt.number(unread - list.length) })}</p>}
              </div>
            )}
          </section>

          {/* กล่องประกาศจากฝ่าย IT — อยู่ข้างกล่องการแจ้งเตือน */}
          {hasNews && (
            <section className="space-y-3 rounded-xl p-4 ring-1 ring-line">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertIcon width={15} height={15} className="text-accent-500" />
                {t("loginDigest.announcements")}
              </p>
              <ul className="space-y-2">
                {announcements.map((a) => (
                  <li key={a.id} className="relative overflow-hidden rounded-lg bg-subtle py-2.5 pl-4 pr-3">
                    <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level]?.dot ?? tone.info.dot}`} aria-hidden="true" />
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    {a.body && <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{a.body}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3">
          <button type="button" onClick={() => setOpen(false)} className={btn.secondary}>
            {t("loginDigest.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
