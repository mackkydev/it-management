"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { VendorFormValues } from "@/lib/types";

export type VendorResult = ActionResult<keyof VendorFormValues | "vendor" | "files">;

/** id มาจาก client (server action รับค่าอะไรก็ได้) จึงต้องตรวจก่อนนำไปต่อ URL */
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

async function invalidId(): Promise<VendorResult> {
  const { t } = await getI18n();
  return { message: t("vendors.form.notFound") };
}

const toResult = (e: unknown) => toActionResult<keyof VendorFormValues | "vendor" | "files">(e, "vendors.form.notFound");

function done(): VendorResult {
  revalidatePath("/vendors");
  return { ok: true };
}

/** เพิ่ม Vendor (multipart: ช่องในฟอร์ม + files[]) */
export async function createVendor(form: FormData): Promise<VendorResult> {
  try {
    await apiFetch("/vendors", { method: "POST", body: form });
  } catch (e) {
    return toResult(e);
  }
  return done();
}

/** แก้ไข Vendor (multipart: ช่องในฟอร์ม + files[] + remove_file_ids[]) */
export async function updateVendor(id: number, form: FormData): Promise<VendorResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/vendors/${id}`, { method: "PUT", body: form });
  } catch (e) {
    return toResult(e);
  }
  return done();
}

export async function deleteVendor(id: number): Promise<VendorResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/vendors/${id}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  return done();
}
