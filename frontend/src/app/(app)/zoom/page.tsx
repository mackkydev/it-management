import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, VideoIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { monthGrid } from "../calendar/calendar-grid";
import { ZoomCalendar } from "./zoom-calendar";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("zoom.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ปฏิทินการใช้ ZOOM — ผู้ใช้ทั่วไปเห็นเฉพาะที่ฝ่าย IT ส่งลิงก์แล้ว / ฝ่าย IT (zoom.manage) เห็นทุกขั้นตอนพร้อมคำอธิบายสี */
export default async function ZoomPage({ searchParams }: PageProps<"/zoom">) {
  const params = await searchParams;
  const month = typeof params.month === "string" && MONTH_RE.test(params.month) ? params.month : localToday().slice(0, 7);
  const { from, to } = monthGrid(month);
  const [{ t }, user, bookings] = await Promise.all([getI18n(), getCurrentUser(), apiFetch<{ data: ZoomBooking[] }>(`/zoom-bookings?${new URLSearchParams({ from, to })}`).then((r) => r.data)]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={VideoIcon}
        title={t("zoom.title")}
        subtitle={t("zoom.subtitle")}
        actions={
          <Link href="/zoom/mine?book=1" className={btn.primary}>
            <PlusIcon />
            {t("zoom.book")}
          </Link>
        }
      />
      <ZoomCalendar month={month} initialBookings={bookings} showStatuses={has(user, "zoom.manage")} />
    </div>
  );
}
