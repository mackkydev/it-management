import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CarIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleBookingForm } from "../../../vehicle-booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.form.editTitle") };
}

/** แก้ไขการจองรถ — เจ้าของ หรือผู้จัดคิวรถ (ยกเลิกแล้ว / เลยเวลา = แก้ไม่ได้ แต่บันทึกเลขไมล์ได้จากรายละเอียด) */
export default async function EditVehicleBookingPage({ params }: PageProps<"/vehicles/bookings/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const booking = await apiFetch<{ data: VehicleBooking }>(`/vehicle-bookings/${id}`)
    .then((r) => r.data)
    .catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  if (!booking.can_edit) redirect(`/vehicles/day/${booking.start_on}`);
  const days = (new Date(`${booking.end_on}T00:00:00Z`).getTime() - new Date(`${booking.start_on}T00:00:00Z`).getTime()) / 86_400_000;
  const [{ t }, vehicles, purposes, extras, range] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vehicle_purpose").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vehicle_extra").then((r) => r.data.map((o) => o.name)),
    days <= 62 ? apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from: booking.start_on, to: booking.end_on })}`).then((r) => r.data) : Promise.resolve([]),
  ]);
  // รถที่ถูกปิดใช้งานภายหลัง — ยังแสดงคันเดิมของการจองนี้ให้เลือกค้างไว้
  const list = !booking.vehicle || vehicles.some((v) => v.id === booking.vehicle!.id)
    ? vehicles
    : [...vehicles, { id: booking.vehicle.id, name: booking.vehicle.name, plate_no: booking.vehicle.plate_no, branch: null, seats: 0, parking: null, description: null, mileage: null, vehicle_type: null, fuel_type: null, is_active: false, sort_order: 0, images: [] }];
  const s = (n: number | null) => (n === null ? "" : String(n));

  return (
    <div className="space-y-5">
      <PageHeader icon={CarIcon} title={t("vehicle.form.editTitle")} subtitle={t("vehicle.form.subtitle")} />
      <VehicleBookingForm
        id={booking.id}
        initial={{
          vehicle_id: booking.vehicle ? String(booking.vehicle.id) : "",
          details: booking.details,
          passengers: String(booking.passengers),
          purpose: booking.purpose ?? "",
          extras: booking.extras,
          note: booking.note ?? "",
          start_on: booking.start_on,
          start_time: booking.start_time,
          end_on: booking.end_on,
          end_time: booking.end_time,
          start_mileage: s(booking.start_mileage),
          end_mileage: s(booking.end_mileage),
        }}
        initialRange={range}
        vehicles={list}
        purposes={purposes}
        extras={extras}
        booker={{ name: booking.user.name, department: booking.department }}
        lockVehicle={!booking.can_change_vehicle}
      />
    </div>
  );
}
