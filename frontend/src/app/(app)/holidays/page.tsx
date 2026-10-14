import type { Metadata } from "next";
import { SunIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { CompanyHoliday, HolidayCalendar, LeaveSettings } from "@/lib/types";
import { HolidaysManager } from "./holidays-manager";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("holidays.title") };
}

/** วันหยุดบริษัท (ทุกคนดูได้) + ตั้งค่าการลา + โควตารายคน (เฉพาะ holidays.manage — มอบให้กลุ่ม HR ได้) */
export default async function HolidaysPage({ searchParams }: PageProps<"/holidays">) {
  const canManage = has(await getCurrentUser(), "holidays.manage");
  const params = await searchParams;
  const year = typeof params.year === "string" && /^\d{4}$/.test(params.year) ? Number(params.year) : Number(localToday().slice(0, 4));
  const [{ t }, holidays, settings, quotas] = await Promise.all([
    getI18n(),
    // แท็บปฏิทินวันหยุด: ?calendar= ที่เลือก — ไม่ระบุ = ชุดของสาขาผู้ใช้ (API เลือกให้)
    apiFetch<{ data: CompanyHoliday[]; meta: { calendar_id: number | null; calendars: HolidayCalendar[] } }>(
      `/holidays?year=${year}${typeof params.calendar === "string" && /^\d+$/.test(params.calendar) ? `&calendar_id=${params.calendar}` : ""}`,
    ),
    canManage ? apiFetch<{ data: LeaveSettings }>("/leave/settings").then((r) => r.data) : null,
    canManage ? apiFetch<{ data: { user: { id: number; name: string }; leave_type: string; days: number }[] }>(`/leave/quotas?year=${year}`).then((r) => r.data) : [],
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={SunIcon} title={t("holidays.title")} subtitle={canManage ? t("holidays.subtitle") : t("holidays.subtitleView")} />
      <HolidaysManager year={year} holidays={holidays.data} calendars={holidays.meta.calendars} calendarId={holidays.meta.calendar_id} settings={settings} quotas={quotas} canManage={canManage} />
    </div>
  );
}
