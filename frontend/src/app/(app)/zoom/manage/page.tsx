import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { ZoomBooking } from "@/lib/types";
import { ZoomList } from "../zoom-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("zoom.manage.title") };
}

const TABS = ["pending", "accepted", "needs_change", "confirmed"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** จัดการคำขอ ZOOM (zoom.manage) — รอรับงาน / รับงานแล้ว (รอส่งลิงก์) / รอผู้จองแก้วันเวลา / ส่งลิงก์แล้ว ที่ยังไม่จบเวลา */
export default async function ZoomManagePage({ searchParams }: PageProps<"/zoom/manage">) {
  const user = await getCurrentUser();
  if (!has(user, "zoom.manage")) redirect("/zoom");
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "pending";
  const [{ t }, res] = await Promise.all([getI18n(), apiFetch<{ data: ZoomBooking[]; meta: { counts: Record<(typeof TABS)[number], number> } }>(`/zoom-bookings/manage?status=${status}`)]);
  const items = res.data;
  // ตัวเลขแดง = รายการค้าง (รอรับงาน / รอส่งลิงก์) — ส่งลิงก์แล้ว / รอผู้จองแก้ แสดงเป็นตัวเลขปกติ
  const badge = (s: (typeof TABS)[number]) => {
    const n = res.meta.counts[s] ?? 0;
    if (!n) return null;
    const urgent = s !== "confirmed" && s !== "needs_change";
    return (
      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${urgent ? "bg-danger-500 text-white" : "bg-subtle text-muted ring-1 ring-line"}`}>
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={CheckCircleIcon} title={t("zoom.manage.title")} subtitle={t("zoom.manage.subtitle")} />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/zoom/manage?status=${s}`} aria-current={s === status ? "page" : undefined} className={`inline-flex cursor-pointer items-center gap-2 ${TAB_CLS(s === status)}`}>
            {t(`zoom.manage.tabs.${s}`)}
            {badge(s)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t(`zoom.manage.empty.${status}`)}</div> : <ZoomList items={items} mode="manage" />}
    </div>
  );
}
