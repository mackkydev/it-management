"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { Location, LocationFormValues } from "@/lib/types";

export type LocationResult = ActionResult<keyof LocationFormValues | "location">;

/** id มาจาก client (server action รับค่าอะไรก็ได้) จึงต้องตรวจก่อนนำไปต่อ URL */
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

async function invalidId(): Promise<LocationResult> {
  const { t } = await getI18n();
  return { message: t("locations.form.notFound") };
}

function toPayload(v: LocationFormValues) {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    type: v.type,
    parent_id: v.parent_id ? Number(v.parent_id) : null,
    address: v.address.trim() || null,
    is_active: v.is_active,
  };
}

const toResult = (e: unknown) => toActionResult<keyof LocationFormValues | "location">(e, "locations.form.notFound");

function done(saved: "created" | "updated" | "deleted"): never {
  revalidatePath("/locations");
  revalidatePath("/assets"); // ตัวเลือกสถานที่ในหน้าสินทรัพย์
  redirect(`/locations?saved=${saved}`);
}

export async function createLocation(values: LocationFormValues): Promise<LocationResult> {
  try {
    await apiFetch("/locations", { method: "POST", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  done("created");
}

export async function updateLocation(id: number, values: LocationFormValues): Promise<LocationResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/locations/${id}`, { method: "PATCH", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  done("updated");
}

export async function deleteLocation(id: number): Promise<LocationResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/locations/${id}`, { method: "DELETE" });
  } catch (e) {
    const result = await toResult(e);
    // กรณีลบไม่ได้ (มีสินทรัพย์/สถานที่ย่อย) API ส่งเหตุผลมาที่ errors.location — แสดงเป็นข้อความหลัก
    return result.errors?.location ? { message: result.errors.location } : result;
  }
  done("deleted");
}

/** เพิ่มสถานที่ด่วนจากฟอร์มสินทรัพย์ — พิมพ์แค่ชื่อ (API สร้างรหัส LOC-#### และประเภท "ห้อง" ให้) */
export async function quickCreateLocation(name: string): Promise<{ location?: Location; message?: string }> {
  try {
    const res = await apiFetch<{ data: Location }>("/locations", { method: "POST", body: JSON.stringify({ name: String(name).trim().slice(0, 255) }) });
    revalidatePath("/locations");
    revalidatePath("/assets");
    return { location: res.data };
  } catch (e) {
    const result = await toResult(e);
    return { message: result.errors?.name ?? result.message };
  }
}
