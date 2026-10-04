"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

/** แผนก / ฝ่าย (ข้อมูลหลัก) — สิทธิ์ org.manage (API ตรวจซ้ำ) */
export type OrgTable = "departments" | "divisions";
export type OrgResult = ActionResult<"name" | "sort_order">;

const TABLES: OrgTable[] = ["departments", "divisions"];
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

export async function saveOrgUnit(table: OrgTable, id: number | null, v: { name: string; is_active: boolean; sort_order: number }): Promise<OrgResult> {
  const { t } = await getI18n();
  if (!TABLES.includes(table) || (id !== null && !validId(id))) return { message: t("common.saveFailed") };
  try {
    await apiFetch(id ? `/${table}/${id}` : `/${table}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ name: v.name.trim(), is_active: v.is_active, sort_order: v.sort_order }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/${table}`);
  return { ok: true, message: t("orgUnits.saved") };
}

export async function deleteOrgUnit(table: OrgTable, id: number): Promise<OrgResult> {
  const { t } = await getI18n();
  if (!TABLES.includes(table) || !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/${table}/${id}`, { method: "DELETE" });
  } catch (e) {
    const r = await toActionResult<"name" | "sort_order">(e);
    return { ...r, message: r.errors?.name ?? r.message };
  }
  revalidatePath(`/${table}`);
  return { ok: true, message: t("orgUnits.deleted") };
}
