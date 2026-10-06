"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/app/actions/tickets";
import { BellIcon, CheckIcon, ChevronRightIcon, ClipboardIcon, FileTextIcon, SpinnerIcon } from "@/components/icons";
import { DATA_CHANGED_EVENT } from "@/components/live-refresh";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";
import type { AppNotification } from "@/lib/types";
import { notificationHref, notificationText } from "./notification-text";

const POLL_MS = 60_000;

/**
 * กระดิ่งแจ้งเตือน: ดึงข้อมูลทุก 60 วินาที (และทุกครั้งที่กลับมาที่แท็บ), แสดงจำนวนที่ยังไม่อ่าน
 * คลิกรายการ → ทำเครื่องหมายว่าอ่านแล้ว และไปยังหน้าที่เกี่ยวข้อง
 */
export function NotificationBell({ tooltipSide = "right", size = "md" }: { tooltipSide?: "right" | "bottom"; size?: "md" | "lg" }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const [loading, startLoading] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    startLoading(async () => {
      const res = await fetchNotifications();
      setItems(res.items);
      setUnread(res.unread);
    });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    // ข้อมูลในระบบเปลี่ยน (LiveRefresh) → โหลดการแจ้งเตือนใหม่ทันที ไม่ต้องรอรอบ 60 วินาที
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(DATA_CHANGED_EVENT, load);
    };
  }, [load]);

  // ปิดเมื่อคลิกนอก / Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !btnRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      // อยู่ใน sidebar (ชิดซ้าย) → เปิดไปทางขวา, อยู่บน topbar → เปิดลงด้านล่างชิดขวา
      setPos(
        r.left < 320 && window.innerWidth >= 1024
          ? { left: r.right + 10, top: Math.max(8, r.top), width }
          : { left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), top: r.bottom + 8, width },
      );
      load();
    }
    setOpen((o) => !o);
  };

  const text = (n: AppNotification) => notificationText(n, t);
  const href = notificationHref;

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markNotificationRead(n.id);
    }
    router.push(href(n));
  };

  const readAll = async () => {
    setItems((list) => list.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await markAllNotificationsRead();
  };

  return (
    <>
      <Tooltip label={t("notifications.title")} side={tooltipSide} disabled={open}>
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          aria-label={`${t("notifications.title")}${unread ? ` (${unread})` : ""}`}
          aria-expanded={open}
          className={`relative flex cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-subtle hover:text-ink ${
            size === "lg" ? "h-11 w-11" : "h-9 w-9"
          } ${unread > 0 ? "text-accent-600 dark:text-accent-300" : "text-muted"}`}
        >
          {/* มีแจ้งเตือนค้าง → กระดิ่งสั่นเป็นจังหวะ (หยุดตอนเปิดรายการ) */}
          <BellIcon width={size === "lg" ? 23 : 18} height={size === "lg" ? 23 : 18} className={unread > 0 && !open ? "bell-ring" : undefined} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-danger-400 opacity-60 motion-reduce:hidden" aria-hidden="true" />
              <span className="relative flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
                {unread > 99 ? "99+" : unread}
              </span>
            </span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("notifications.title")}
          style={pos}
          className="fixed z-50 max-h-[min(70vh,520px)] overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="flex items-center gap-2 font-semibold">
              {t("notifications.title")}
              {loading && <SpinnerIcon width={14} height={14} className="text-accent-500" />}
            </span>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
                <CheckIcon width={13} height={13} />
                {t("notifications.markAll")}
              </button>
            )}
          </div>
          <ul className="max-h-[calc(min(70vh,520px)-96px)] overflow-y-auto py-1">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{t("notifications.empty")}</li>}
            {items.map((n) => {
              const Icon = n.data.kind === "ticket" ? ClipboardIcon : FileTextIcon;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle ${n.read_at ? "" : "bg-accent-50/60 dark:bg-accent-400/[0.06]"}`}
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        n.data.kind === "ticket"
                          ? "bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300"
                          : "bg-warning-100 text-warning-700 dark:bg-warning-400/15 dark:text-warning-300"
                      }`}
                    >
                      <Icon width={15} height={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read_at ? "text-muted" : "font-medium text-ink"}`}>{text(n)}</span>
                      <span className="mt-0.5 block text-xs text-faint">{fmt.dateTime(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* หน้ารวมแจ้งเตือนทั้งหมด (ดูย้อนหลัง / ล้างแจ้งเตือน) */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex h-11 cursor-pointer items-center justify-center gap-1 border-t border-line text-sm font-medium text-accent-700 transition-colors hover:bg-subtle dark:text-accent-300"
          >
            {t("notifications.viewAll")}
            <ChevronRightIcon width={14} height={14} />
          </Link>
        </div>
      )}
    </>
  );
}
