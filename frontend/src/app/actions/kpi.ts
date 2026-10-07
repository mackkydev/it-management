"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

export type KpiResult = ActionResult<
  "work_date" | "details" | "requester_name" | "branch_name" | "service_type" | "solution" | "complexity" | "completed_date"
>;

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** ค่าแถวที่กรอกเอง (entry_type = work) หรือวันหยุด (holiday: ใช้แค่ work_date + details) */
export interface KpiEntryValues {
  entry_type: "work" | "holiday";
  work_date: string;
  details: string;
  requester_name?: string;
  branch_name?: string;
  service_type?: string;
  solution?: string;
  complexity?: string;
  completed_date?: string;
  /** เพิ่มให้เจ้าหน้าที่คนอื่น (ต้องมีสิทธิ์ kpi.edit_all) */
  user_id?: number;
}

/** เพิ่ม (id = null) / แก้ไขแถวที่กรอกเองหรือวันหยุด */
export async function saveKpiEntry(id: number | null, v: KpiEntryValues): Promise<KpiResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  const body: Record<string, unknown> = { work_date: v.work_date, details: v.details.trim() };
  if (id === null) body.entry_type = v.entry_type === "holiday" ? "holiday" : "work";
  if (id === null && v.user_id !== undefined && validId(v.user_id)) body.user_id = v.user_id;
  if (v.entry_type !== "holiday") {
    for (const k of ["requester_name", "branch_name", "service_type", "solution", "completed_date"] as const) body[k] = v[k]?.trim() || null;
    body.complexity = v.complexity === "" || v.complexity === undefined ? null : Number(v.complexity);
  }
  try {
    await apiFetch(id ? `/kpi/${id}` : "/kpi", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/kpi");
  return { ok: true, message: t("kpi.saved") };
}

/** ประเภทการแจ้ง / Complexity ของแถวใบแจ้งงาน */
export async function saveKpiTicket(ticketId: string, v: { service_type?: string; complexity?: number }): Promise<KpiResult> {
  const { t } = await getI18n();
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/kpi/tickets/${ticketId}`, { method: "PUT", body: JSON.stringify(v) });
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

export interface KpiPerson {
  id: number;
  name: string;
  type: "LOCAL" | "API";
  department: string | null;
  branch: { id: number; name: string } | null;
}

/** ช่องผู้แจ้ง: ค้นหาผู้ใช้ในระบบ + ผู้ใช้จาก API ด้วยชื่อ / สาขา / แผนก (สูงสุด 10 คน) */
export async function searchKpiPeople(search: string): Promise<KpiPerson[]> {
  const q = new URLSearchParams({ search: search.slice(0, 100) });
  try {
    return (await apiFetch<{ data: KpiPerson[] }>(`/kpi/people?${q}`)).data;
  } catch {
    return [];
  }
}
