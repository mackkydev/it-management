import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleBookingList } from "../vehicle-booking-list";
import { shiftDay } from "../vehicle-utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.dispatch.title") };
}

const TABS = ["unassigned", "upcoming"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** จัดคิวรถ (vehicle.dispatch) — เลือกรถให้การจองที่ยังไม่ระบุรถ / เปลี่ยนรถของการจองที่กำลังจะถึง */
export default async function VehicleDispatchPage({ searchParams }: PageProps<"/vehicles/dispatch">) {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.dispatch")) redirect("/vehicles");
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "unassigned";
  const today = localToday();
  const [{ t }, items, vehicles, busy] = await Promise.all([
    getI18n(),
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings/dispatch?status=${status}`).then((r) => r.data),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    // ใช้บอกรถที่ไม่ว่าง (การจองใน 2 เดือนข้างหน้า)
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from: today, to: shiftDay(today, 62) })}`).then((r) => r.data),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={CheckCircleIcon} title={t("vehicle.dispatch.title")} subtitle={t("vehicle.dispatch.subtitle")} />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/vehicles/dispatch?status=${s}`} aria-current={s === status ? "page" : undefined} className={`cursor-pointer ${TAB_CLS(s === status)}`}>
            {t(`vehicle.dispatch.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t(`vehicle.dispatch.empty.${status}`)}</div>
      ) : (
        <VehicleBookingList items={items} vehicles={vehicles} mode="dispatch" busy={busy} />
      )}
    </div>
  );
}
