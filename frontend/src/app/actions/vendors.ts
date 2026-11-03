"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { VendorFormValues } from "@/lib/types";

export type VendorResult = ActionResult<keyof VendorFormValues | "vendor">;

/** id มาจาก client (server action รับค่าอะไรก็ได้) จึงต้องตรวจก่อนนำไปต่อ URL */
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

async function invalidId(): Promise<VendorResult> {
  const { t } = await getI18n();
  return { message: t("vendors.form.notFound") };
}

const toPayload = (v: VendorFormValues) => ({
  name: v.name.trim(),
  tax_id: v.tax_id.trim() || null,
  address: v.address.trim(),
  contact_name: v.contact_name.trim(),
  contact_phone: v.contact_phone.trim(),
  vendor_type: v.vendor_type,
  is_active: v.is_active,
});

const toResult = (e: unknown) => toActionResult<keyof VendorFormValues | "vendor">(e, "vendors.form.notFound");

function done(saved: "created" | "updated" | "deleted"): never {
  revalidatePath("/vendors");
  redirect(`/vendors?saved=${saved}`);
}

export async function createVendor(v: VendorFormValues): Promise<VendorResult> {
  try {
    await apiFetch("/vendors", { method: "POST", body: JSON.stringify(toPayload(v)) });
  } catch (e) {
    return toResult(e);
  }
  done("created");
}

export async function updateVendor(id: number, v: VendorFormValues): Promise<VendorResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/vendors/${id}`, { method: "PUT", body: JSON.stringify(toPayload(v)) });
  } catch (e) {
    return toResult(e);
  }
  done("updated");
}

export async function deleteVendor(id: number): Promise<VendorResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/vendors/${id}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  done("deleted");
}
