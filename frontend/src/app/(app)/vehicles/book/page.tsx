import type { Metadata } from "next";
import Link from "next/link";
import { CarIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleBookingForm } from "../vehicle-booking-form";
import { TIME_OPTIONS } from "../vehicle-utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.form.newTitle") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** จองรถ — เปิดจากปฏิทิน/ไทม์ไลน์ส่ง ?date=&vehicle=&start=&end= มาเติมให้ */
export default async function BookVehiclePage({ searchParams }: PageProps<"/vehicles/book">) {
  const sp = await searchParams;
  const today = localToday();
  // เปิดจากปฏิทิน/ไทม์ไลน์ = เติมวันให้; เปิดจากเมนู = วันว่างไว้ (ต้องเลือกวันเวลาก่อนจึงเลือกรถได้)
  const date = DATE_RE.test(str(sp.date)) && str(sp.date) >= today ? str(sp.date) : "";
  const start = TIME_OPTIONS.includes(str(sp.start)) ? str(sp.start) : "08:00";
  const end = TIME_OPTIONS.includes(str(sp.end)) && str(sp.end) > start ? str(sp.end) : "17:00" > start ? "17:00" : "23:59";
  const [{ t }, user, vehicles, purposes, extras, range] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vehicle_purpose").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vehicle_extra").then((r) => r.data.map((o) => o.name)),
    date ? apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from: date, to: date })}`).then((r) => r.data) : Promise.resolve([] as VehicleBooking[]),
  ]);
  const vehicle = date ? vehicles.find((v) => String(v.id) === str(sp.vehicle)) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader icon={CarIcon} title={t("vehicle.form.newTitle")} subtitle={t("vehicle.form.subtitle")} />
      {vehicles.length === 0 && has(user, "vehicle.manage") && (
        <div className={`flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted ${card}`}>
          {t("vehicle.noVehicles")}
          <Link href="/vehicles/manage/new" className={`${btn.primary} ${btn.sm}`}>
            <PlusIcon width={14} height={14} />
            {t("vehicle.noVehiclesManage")}
          </Link>
        </div>
      )}
      <VehicleBookingForm
        id={null}
        initial={{
          vehicle_id: vehicle ? String(vehicle.id) : "",
          details: "",
          passengers: "",
          purpose: purposes.length === 1 ? purposes[0] : "",
          extras: [],
          note: "",
          start_on: date,
          start_time: start,
          end_on: date,
          end_time: end,
          start_mileage: vehicle?.mileage != null ? String(vehicle.mileage) : "",
          end_mileage: "",
        }}
        initialRange={range}
        vehicles={vehicles}
        purposes={purposes}
        extras={extras}
        booker={{ name: user?.name ?? "", department: user?.department ?? null }}
      />
    </div>
  );
}
