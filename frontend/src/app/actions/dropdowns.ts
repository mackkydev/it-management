"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

/** รายการข้อมูล Drop Down ที่แก้ได้ (ตาราง dropdown_options) */
export type DropdownList = "computer_type" | "brand" | "vault_category";
const LISTS: DropdownList[] = ["computer_type", "brand", "vault_category"];

type QuickAdd = { option?: { value: string; label: string }; message?: string };

/** "+ เพิ่ม …" จากช่องเลือกในฟอร์ม — สร้างเป็นข้อมูล Drop Down ใหม่ (แก้/ลบได้ที่ ข้อมูลหลัก → ข้อมูล Drop Down) */
export async function quickAddOption(list: DropdownList, name: string): Promise<QuickAdd> {
  const { t } = await getI18n();
  if (!LISTS.includes(list) || !name.trim()) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: { name: string } }>(`/dropdown-options/${list}`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    revalidatePath("/dropdowns");
    return { option: { value: res.data.name, label: res.data.name } };
  } catch (e) {
    const r = await toActionResult<"name">(e);
    return { message: r.errors?.name ?? r.message ?? t("common.saveFailed") };
  }
}

/** "+ เพิ่ม …" หมวดหมู่สัญญาจากฟอร์มสัญญา (ค่าที่บันทึก = id) */
export async function quickAddContractCategory(name: string): Promise<QuickAdd> {
  const { t } = await getI18n();
  if (!name.trim()) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: { id: number; name: string } }>("/contract-categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    revalidatePath("/dropdowns");
    return { option: { value: String(res.data.id), label: res.data.name } };
  } catch (e) {
    const r = await toActionResult<"name">(e);
    return { message: r.errors?.name ?? r.message ?? t("common.saveFailed") };
  }
}
