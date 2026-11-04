"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import type { PolicyDisplay, PolicySection } from "@/lib/types";

/** ยอมรับนโยบายการใช้งานระบบ (เวอร์ชันที่อ่าน) → เข้าใช้งาน */
export async function acceptPolicy(version: number): Promise<ActionResult> {
  if (!Number.isInteger(version) || version < 1) return { message: (await getI18n()).t("common.saveFailed") };
  try {
    const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;
    await apiFetch("/policy/accept", { method: "POST", body: JSON.stringify({ version, user_agent: userAgent }) });
  } catch (e) {
    return toActionResult(e);
  }
  redirect("/");
}

/** แก้เนื้อหานโยบาย (ข้อมูลหลัก → นโยบายการใช้งาน — settings.manage) */
export async function savePolicy(values: { reaccept: boolean; sections: PolicySection[] }): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/policy", { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy-manage");
  revalidatePath("/settings");
  return { ok: true, message: t("settingsPage.saved") };
}

/** แนบไฟล์ประกาศ (multipart files[]) — บันทึกทันที */
export async function uploadPolicyFiles(form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/policy/files", { method: "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy-manage");
  return { ok: true, message: t("settingsPage.policy.fileSaved") };
}

export async function deletePolicyFile(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!Number.isInteger(id) || id < 1) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/files/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy-manage");
  return { ok: true, message: t("settingsPage.policy.fileDeleted") };
}

/** เปิด-ปิด + ที่แสดงนโยบาย (หน้าตั้งค่าระบบ — settings.manage) */
export async function savePolicyOptions(values: { enabled: boolean; display: PolicyDisplay }): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/policy/options", { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/settings");
  revalidatePath("/login");
  return { ok: true, message: t("settingsPage.saved") };
}
