"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { Vehicle, VehicleBooking } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validId = (id: number) => Number.isInteger(id) && id > 0;
const num = (v: string) => (v.trim() === "" ? null : Number(v));

const refresh = () => {
  for (const p of ["/vehicles", "/vehicles/mine", "/vehicles/dispatch", "/vehicles/manage"]) revalidatePath(p);
};

/* ---------------------------------------------------------------- การจอง */

/** การจองที่ยืนยันแล้วที่คาบเกี่ยวช่วงวัน (เปลี่ยนเดือน / ตรวจรถว่างในฟอร์ม) — ช่วงไม่เกิน 62 วัน */
export async function loadVehicleBookings(from: string, to: string): Promise<VehicleBooking[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  try {
    return (await apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from, to })}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export interface VehicleBookingValues {
  vehicle_id: string;
  details: string;
  passengers: string;
  purpose: string;
  extras: string[];
  note: string;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
  start_mileage: string;
  end_mileage: string;
}

/** จองใหม่ (id = null) / แก้ไขการจอง */
export async function saveVehicleBooking(id: string | null, v: VehicleBookingValues): Promise<ActionResult<keyof VehicleBookingValues> & { id?: string }> {
  const { t } = await getI18n();
  if (id !== null && !UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: VehicleBooking }>(id ? `/vehicle-bookings/${id}` : "/vehicle-bookings", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        vehicle_id: Number(v.vehicle_id) || null,
        details: v.details.trim(),
        passengers: Number(v.passengers) || null,
        purpose: v.purpose,
        extras: v.extras,
        note: v.note.trim() || null,
        start_on: v.start_on,
        start_time: v.start_time,
        end_on: v.end_on,
        end_time: v.end_time,
        start_mileage: num(v.start_mileage),
        end_mileage: num(v.end_mileage),
      }),
    });
    refresh();
    return { ok: true, id: res.data.id };
  } catch (e) {
    return toActionResult(e);
  }
}

type BookingResult = ActionResult<"vehicle_id" | "start_mileage" | "end_mileage" | "status"> & { booking?: VehicleBooking };

/** ผู้จัดคิวรถเลือก / เปลี่ยน / เอารถออก (vehicleId = null) */
export async function assignVehicle(id: string, vehicleId: number | null): Promise<BookingResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id) || (vehicleId !== null && !validId(vehicleId))) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: VehicleBooking }>(`/vehicle-bookings/${id}/vehicle`, { method: "PUT", body: JSON.stringify({ vehicle_id: vehicleId }) });
    refresh();
    return { ok: true, booking: res.data, message: t("vehicle.dispatch.assigned") };
  } catch (e) {
    return toActionResult(e);
  }
}

/** บันทึกเลขไมล์เริ่มต้น / สิ้นสุด (ระหว่าง / หลังใช้งาน) */
export async function saveMileage(id: string, start: string, end: string): Promise<BookingResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: VehicleBooking }>(`/vehicle-bookings/${id}/mileage`, { method: "PUT", body: JSON.stringify({ start_mileage: num(start), end_mileage: num(end) }) });
    refresh();
    return { ok: true, booking: res.data, message: t("vehicle.mileage.saved") };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function cancelVehicleBooking(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/vehicle-bookings/${id}/cancel`, { method: "POST" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true };
}

export async function deleteVehicleBooking(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/vehicle-bookings/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true };
}

/* ---------------------------------------------------------------- รถ */

export interface VehicleValues {
  name: string;
  plate_no: string;
  branch_id: string;
  seats: string;
  parking: string;
  description: string;
  mileage: string;
  is_active: boolean;
  sort_order: string;
}

export async function saveVehicle(id: number | null, v: VehicleValues): Promise<ActionResult<keyof VehicleValues> & { vehicle?: Vehicle }> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: Vehicle }>(id ? `/vehicles/${id}` : "/vehicles", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        name: v.name.trim(),
        plate_no: v.plate_no.trim() || null,
        branch_id: Number(v.branch_id) || null,
        seats: Number(v.seats) || null,
        parking: v.parking.trim() || null,
        description: v.description.trim() || null,
        mileage: num(v.mileage),
        is_active: v.is_active,
        sort_order: Number(v.sort_order) || 0,
      }),
    });
    refresh();
    return { ok: true, vehicle: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function deleteVehicle(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/vehicles/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true };
}

export async function uploadVehicleImages(id: number, form: FormData): Promise<ActionResult & { vehicle?: Vehicle }> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  const body = new FormData();
  form.getAll("images").forEach((f, i) => {
    if (f instanceof File && f.size > 0) body.set(`images[${i}]`, f, f.name);
  });
  try {
    const res = await apiFetch<{ data: Vehicle }>(`/vehicles/${id}/images`, { method: "POST", body });
    refresh();
    return { ok: true, vehicle: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function updateVehicleImage(id: number, imageId: number, action: "primary" | "delete"): Promise<ActionResult & { vehicle?: Vehicle }> {
  const { t } = await getI18n();
  if (!validId(id) || !validId(imageId)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: Vehicle }>(`/vehicles/${id}/images/${imageId}`, { method: action === "primary" ? "PUT" : "DELETE" });
    refresh();
    return { ok: true, vehicle: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}
