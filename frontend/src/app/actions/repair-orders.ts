"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { RepairLookupItem } from "@/lib/types";

export type RepairOrderResult = ActionResult<"item" | "symptom" | "vendor_id" | "sent_on" | "sent_time" | "sent_by_id" | "return_note" | "status" | "files" | "reason">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ค้นหาของที่จะส่งซ่อม: เลข/ชื่อสินทรัพย์ หรือเลขที่ใบแจ้งงาน */
export async function lookupRepairItem(q: string): Promise<RepairLookupItem[]> {
  const query = new URLSearchParams({ q: String(q).slice(0, 100) });
  try {
    return (await apiFetch<{ data: RepairLookupItem[] }>(`/repair-orders/lookup?${query}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

/** ส่งซ่อม (multipart: ticket | asset + symptom + vendor_id + sent_on + sent_time + sent_by_id + files[]) */
export async function createRepairOrder(form: FormData): Promise<RepairOrderResult> {
  try {
    await apiFetch("/repair-orders", { method: "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/it/repair-orders");
  redirect("/it/repair-orders?saved=sent");
}

/** แก้ไขรายการที่ส่งซ่อมอยู่ (multipart: symptom + vendor_id + sent_on + sent_time + sent_by_id + files[] + remove_file_ids[]) */
export async function updateRepairOrder(id: string, form: FormData): Promise<RepairOrderResult> {
  if (!UUID_RE.test(id)) {
    const { t } = await getI18n();
    return { message: t("common.saveFailed") };
  }
  try {
    await apiFetch(`/repair-orders/${id}`, { method: "PUT", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/it/repair-orders");
  revalidatePath(`/it/repair-orders/${id}`);
  redirect(`/it/repair-orders/${id}`);
}

/** ยกเลิกรายการที่ส่งซ่อมอยู่ (ต้องมีเหตุผล) */
export async function cancelRepairOrder(id: string, reason: string): Promise<RepairOrderResult> {
  if (!UUID_RE.test(id)) {
    const { t } = await getI18n();
    return { message: t("common.saveFailed") };
  }
  try {
    await apiFetch(`/repair-orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: String(reason).trim() }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/it/repair-orders");
  revalidatePath(`/it/repair-orders/${id}`);
  return { ok: true };
}

/** รับเครื่องคืน (multipart: return_note + files[]) */
export async function returnRepairOrder(id: string, form: FormData): Promise<RepairOrderResult> {
  if (!UUID_RE.test(id)) {
    const { t } = await getI18n();
    return { message: t("common.saveFailed") };
  }
  try {
    await apiFetch(`/repair-orders/${id}/return`, { method: "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/it/repair-orders");
  revalidatePath(`/it/repair-orders/${id}`);
  return { ok: true };
}
