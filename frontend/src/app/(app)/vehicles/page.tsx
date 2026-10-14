import type { Metadata } from "next";
import Link from "next/link";
import { CarIcon, PlusIcon } from "@/components/icons";
import { BranchFilter } from "@/components/branch-filter";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { branchQuery, getBookingScope, selectedBranch } from "@/lib/booking-scope";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { monthGrid } from "../calendar/calendar-grid";
import { VehicleCalendar } from "./vehicle-calendar";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ปฏิทินจองรถ (หน้าแรกของระบบจองรถ) — ทุกคนเห็นการจองของทุกคัน */
export default async function VehiclesPage({ searchParams }: PageProps<"/vehicles">) {
  const params = await searchParams;
  const month = typeof params.month === "string" && MONTH_RE.test(params.month) ? params.month : localToday().slice(0, 7);
  const { from, to } = monthGrid(month);
  // ขอบเขตตามสาขา (ตั้งต่อกลุ่มสิทธิ์) + สาขาที่เลือกดู — API กรองให้
  const scope = await getBookingScope("vehicle");
  const branch = await selectedBranch("vehicle", scope);
  const [{ t }, user, vehicles, bookings, can] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: Vehicle[] }>(`/vehicles?${new URLSearchParams(branchQuery(branch))}`).then((r) => r.data),
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from, to, ...branchQuery(branch) })}`).then((r) => r.data),
    getAccess(),
  ]);
  const canBook = can("btn:vehicles:book");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CarIcon}
        title={t("vehicle.title")}
        subtitle={t("vehicle.subtitle")}
        actions={
          canBook && (
            <Link href="/vehicles/book" className={btn.primary}>
              <PlusIcon />
      <BranchFilter kind="vehicle" meta={scope} value={branch} />
              {t("vehicle.book")}
            </Link>
          )
        }
      />
      {/* ยังไม่มีรถ: แจ้งเป็นแถบด้านบน — ปฏิทินแสดงเสมอ (จองแบบไม่ระบุรถได้) */}
      {vehicles.length === 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted ${card}`}>
          {t("vehicle.noVehicles")}
          {has(user, "vehicle.manage") && can("btn:vehicles:create") && (
            <Link href="/vehicles/manage/new" className={`${btn.primary} ${btn.sm}`}>
              <PlusIcon width={14} height={14} />
              {t("vehicle.noVehiclesManage")}
            </Link>
          )}
        </div>
      )}
      <VehicleCalendar month={month} initialBookings={bookings} vehicles={vehicles} canDispatch={has(user, "vehicle.dispatch")} canBook={canBook} />
    </div>
  );
}
