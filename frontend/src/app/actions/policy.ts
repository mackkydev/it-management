"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import type { PolicyDisplay, PolicySection, PolicyVersion } from "@/lib/types";

const validId = (n: number) => Number.isInteger(n) && n > 0;

/** ยอมรับนโยบายการใช้งานระบบ (ฉบับที่อ่าน) → เข้าใช้งาน */
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

const revalidateVersion = (version: number) => {
  revalidatePath("/policy");
  revalidatePath(`/policy/versions/${version}/edit`);
  revalidatePath("/settings");
};

/** เพิ่มนโยบายฉบับใหม่ → เปิดหน้าแก้ไขเพื่อแนบไฟล์ต่อ */
export async function createPolicyVersion(values: { title: string; sections: PolicySection[] }): Promise<ActionResult> {
  let version: number;
  try {
    version = (await apiFetch<{ data: PolicyVersion }>("/policy/versions", { method: "POST", body: JSON.stringify(values) })).data.version;
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy");
  redirect(`/policy/versions/${version}/edit`);
}

export async function updatePolicyVersion(version: number, values: { title: string; sections: PolicySection[] }): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(version)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/versions/${version}`, { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidateVersion(version);
  return { ok: true, message: t("settingsPage.saved") };
}

/** คัดลอกเป็นฉบับใหม่ → เปิดหน้าแก้ไขฉบับใหม่ */
export async function duplicatePolicyVersion(version: number): Promise<ActionResult> {
  if (!validId(version)) return { message: (await getI18n()).t("common.saveFailed") };
  let created: number;
  try {
    created = (await apiFetch<{ data: PolicyVersion }>(`/policy/versions/${version}/duplicate`, { method: "POST" })).data.version;
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy");
  redirect(`/policy/versions/${created}/edit`);
}

/** ตั้งเป็นฉบับที่แสดงให้ผู้ใช้ */
export async function setDefaultPolicyVersion(version: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(version)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/versions/${version}/default`, { method: "PUT" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidateVersion(version);
  revalidatePath("/login");
  // ผู้ตั้งก็ต้องยอมรับฉบับใหม่เหมือนทุกคน — หน้าเว็บพาไปหน้ายอมรับเองเมื่อโหลดหน้าถัดไป
  revalidatePath("/", "layout");
  return { ok: true, message: t("policyPage.defaultSet", { version }) };
}

export async function deletePolicyVersion(version: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(version)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/versions/${version}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy");
  return { ok: true, message: t("policyPage.deleted") };
}

/** แนบไฟล์ให้ฉบับนี้ (multipart files[]) — บันทึกทันที */
export async function uploadPolicyVersionFiles(version: number, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(version)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/versions/${version}/files`, { method: "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidateVersion(version);
  return { ok: true, message: t("settingsPage.policy.fileSaved") };
}

export async function deletePolicyVersionFile(version: number, id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(version) || !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/versions/${version}/files/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidateVersion(version);
  return { ok: true, message: t("settingsPage.policy.fileDeleted") };
}

/** เพิ่ม/แก้นโยบายอื่นๆ (multipart: title, description, sort_order, is_active, files[], remove_file_ids[]) */
export async function saveOtherPolicy(id: number | null, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(id === null ? "/policy/others" : `/policy/others/${id}`, { method: id === null ? "POST" : "PUT", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy");
  return { ok: true, message: t("policyPage.others.saved") };
}

export async function deleteOtherPolicy(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/policy/others/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/policy");
  return { ok: true, message: t("policyPage.others.deleted") };
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
