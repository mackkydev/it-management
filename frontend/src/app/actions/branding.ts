"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

/** โลโก้ระบบ (สิทธิ์ settings.manage — API ตรวจซ้ำ) */
export async function uploadLogo(formData: FormData): Promise<ActionResult<"logo">> {
  const { t } = await getI18n();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { message: t("common.checkInput") };
  if (file.size > 1024 * 1024) return { errors: { logo: t("logo.tooLarge") }, message: t("logo.tooLarge") };
  const body = new FormData();
  body.append("logo", file, file.name);
  try {
    await apiFetch("/settings/logo", { method: "POST", body });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t("logo.uploaded") };
}

export async function removeLogo(): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/settings/logo", { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t("logo.removed") };
}
