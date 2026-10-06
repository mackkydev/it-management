import type { Metadata } from "next";
import Link from "next/link";
import { BellIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
import { NotificationActions, NotificationList } from "./notification-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("notifications.title") };
}

const PER_PAGE = 20;

/** หน้ารวมการแจ้งเตือนของตัวเอง — ทั้งหมด / ยังไม่อ่าน, อ่านทั้งหมด, ล้างแจ้งเตือน */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const params = await searchParams;
  const unreadOnly = params.filter === "unread";
  const page = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;

  const q = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
  if (unreadOnly) q.set("unread", "1");
  const [{ t, fmt }, res, all] = await Promise.all([
    getI18n(),
    apiFetch<{ data: AppNotification[]; unread_count: number; meta: { current_page: number; last_page: number; total: number } }>(`/notifications?${q}`),
    // จำนวนทั้งหมด (ใช้กับปุ่มล้าง) — หน้ายังไม่อ่านนับเฉพาะที่ยังไม่อ่าน
    unreadOnly ? apiFetch<{ meta: { total: number } }>("/notifications?per_page=1").then((r) => r.meta.total) : null,
  ]);
  const total = all ?? res.meta.total;
  const from = res.data.length ? (res.meta.current_page - 1) * PER_PAGE + 1 : null;

  const tab = (href: string, label: string, active: boolean, count?: number) => (
    <Link
      href={href}
      className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition-colors ${
        active ? "bg-surface font-medium text-accent-800 shadow-sm ring-1 ring-line dark:text-accent-200" : "text-muted hover:text-ink"
      }`}
    >
      {label}
      {count ? (
        <span className="rounded-full bg-accent-200 px-1.5 text-[11px] font-semibold text-accent-900 dark:bg-accent-400/30 dark:text-accent-100">{count}</span>
      ) : null}
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={BellIcon} title={t("notifications.title")} subtitle={t("notifications.page.subtitle")} actions={<NotificationActions unread={res.unread_count} total={total} />} />

      <nav className="flex w-fit gap-1 rounded-2xl bg-subtle p-1" aria-label="Tabs">
        {tab("/notifications", t("notifications.page.all"), !unreadOnly, total)}
        {tab("/notifications?filter=unread", t("notifications.page.unread"), unreadOnly, res.unread_count)}
      </nav>

      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("notifications.empty")}</div>
      ) : (
        <NotificationList items={res.data} />
      )}

      <Pagination
        meta={{ current_page: res.meta.current_page, last_page: res.meta.last_page, total: res.meta.total, from, to: from === null ? null : from + res.data.length - 1 }}
        href={(p) => `/notifications?${new URLSearchParams({ ...(unreadOnly ? { filter: "unread" } : {}), page: String(p) })}`}
      />
    </div>
  );
}
