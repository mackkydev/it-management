"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { ApprovalPlan } from "@/lib/types";

export type RouteResult = ActionResult<string>;

export interface RoutePayload {
  name: string;
  branch_id: string;
  department: string;
  is_active: boolean;
  steps: { name: string; approvers: { id: number; name: string }[] }[];
}

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** บันทึกสายอนุมัติ (สร้าง/แก้ไขทั้งชุด รวมขั้นและผู้อนุมัติ) */
export async function saveApprovalRoute(id: number | null, v: RoutePayload): Promise<RouteResult> {
  if (id !== null && !validId(id)) return { message: (await getI18n()).t("common.saveFailed") };
  const body = {
    name: v.name.trim(),
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    department: v.department.trim() || null,
    is_active: v.is_active,
    steps: v.steps.map((s) => ({ name: s.name.trim(), approver_ids: s.approvers.map((a) => a.id) })),
  };
  try {
    await apiFetch(id ? `/approval-routes/${id}` : "/approval-routes", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/approval-routes");
  redirect(`/approval-routes?saved=${id ? "updated" : "created"}`);
}

export async function deleteApprovalRoute(id: number): Promise<RouteResult> {
  if (!validId(id)) return { message: (await getI18n()).t("common.saveFailed") };
  try {
    await apiFetch(`/approval-routes/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/approval-routes");
  redirect("/approval-routes?saved=deleted");
}

/** แผนอนุมัติของผู้ใช้ (หน้าทดสอบสายอนุมัติ) */
export async function resolveApprovalPlan(userId: number): Promise<ApprovalPlan | null> {
  if (!validId(userId)) return null;
  try {
    return (await apiFetch<{ data: ApprovalPlan }>(`/approval-routes/resolve?user_id=${userId}`)).data;
  } catch {
    return null;
  }
}
