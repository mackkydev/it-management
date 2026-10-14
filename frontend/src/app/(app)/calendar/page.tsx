import type { Metadata } from "next";
import { CalendarIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Branch, CalendarItem, CalendarMeta } from "@/lib/types";
import { monthGrid } from "./calendar-grid";
import { CalendarView } from "./calendar-view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("calendar.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ปฏิทินกลาง — วันลา / ไปหน้างาน / กิจกรรม / วันหยุดบริษัท ตามขอบเขตของกลุ่ม */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const month = typeof params.month === "string" && MONTH_RE.test(params.month) ? params.month : localToday().slice(0, 7);
  const { from, to } = monthGrid(month);
  const [{ t }, user, meta, branches, items, can] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: CalendarMeta }>("/calendar/meta").then((r) => r.data),
    apiFetch<{ data: Branch[] }>("/branches").then((r) => r.data),
    apiFetch<{ data: CalendarItem[]; meta: { scope: CalendarMeta["max_scope"] } }>(`/calendar?${new URLSearchParams({ from, to })}`),
    getAccess(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarIcon} title={t("calendar.title")} subtitle={t("calendar.subtitle")} />
      <CalendarView month={month} initialItems={items.data} meta={meta} branches={branches.map((b) => ({ id: b.id, name: b.name }))} userId={user?.id ?? 0} canAddEvent={can("btn:calendar:event")} canIcal={can("btn:calendar:ical")} />
    </div>
  );
}
