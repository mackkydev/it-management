"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { AssetFormValues, FieldErrors, UserOption } from "@/lib/types";

export interface SaveResult {
  errors?: FieldErrors;
  message?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** แปลงค่าจากฟอร์มเป็น payload ของ API: ช่องว่าง → null, ตัดช่องว่างหัวท้าย */
function toPayload(v: AssetFormValues) {
  const text = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    asset_tag: v.asset_tag.trim(),
    name: v.name.trim(),
    category: v.category,
    brand: text(v.brand),
    model: text(v.model),
    serial_number: text(v.serial_number),
    status: v.status,
    location_id: v.location_id ? Number(v.location_id) : null,
    custodian_id: v.custodian_id ? Number(v.custodian_id) : null,
    purchase_date: text(v.purchase_date),
    purchase_cost: text(v.purchase_cost),
    warranty_expires_at: text(v.warranty_expires_at),
    notes: text(v.notes),
  };
}

const toResult = (e: unknown) => toActionResult<keyof AssetFormValues>(e, "assets.form.notFound");

async function invalidId(): Promise<SaveResult> {
  const { t } = await getI18n();
  return { message: t("assets.form.invalidId") };
}

/** ค้นหาผู้ใช้สำหรับช่องผู้ถือครอง — เรียกผ่าน server เพื่อไม่ให้ token หลุดไป browser */
export async function searchUsers(search: string): Promise<UserOption[]> {
  const q = new URLSearchParams({ search: search.slice(0, 100), per_page: "10" });
  try {
    return (await apiFetch<{ data: UserOption[] }>(`/users?${q}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export async function createAsset(values: AssetFormValues): Promise<SaveResult> {
  try {
    await apiFetch("/assets", { method: "POST", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  redirect("/assets?saved=created");
}

export async function updateAsset(id: string, values: AssetFormValues): Promise<SaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    const movementReason = values.movement_reason.trim() || null;
    await apiFetch(`/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...toPayload(values), movement_reason: movementReason }),
    });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  revalidatePath(`/assets/${id}/edit`);
  redirect("/assets?saved=updated");
}

export async function deleteAsset(id: string): Promise<SaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/assets/${id}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  redirect("/assets?saved=deleted");
}
