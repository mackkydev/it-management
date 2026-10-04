"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

export type KpiResult = ActionResult<"work_date" | "details">;

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** เพิ่ม (id = null) หรือแก้ไขบันทึก KPI */
export async function saveKpi(id: number | null, values: { work_date: string; details: string }): Promise<KpiResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(id ? `/kpi/${id}` : "/kpi", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ work_date: values.work_date, details: values.details.trim() }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/kpi");
  return { ok: true, message: t("kpi.saved") };
}

export async function deleteKpi(id: number): Promise<KpiResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/kpi/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/kpi");
  return { ok: true, message: t("kpi.deleted") };
}
