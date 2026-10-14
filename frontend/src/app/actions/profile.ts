"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";

export type ProfileResult = ActionResult<"name" | "email">;
export type PasswordResult = ActionResult<"current_password" | "password" | "password_confirmation">;

export async function updateProfile(_prev: ProfileResult, formData: FormData): Promise<ProfileResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/auth/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: String(formData.get("name") ?? "").trim(),
        email: String(formData.get("email") ?? "").trim(),
      }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout"); // ให้ชื่อใน sidebar/avatar อัปเดตทันที
  return { ok: true, message: t("profile.infoSaved") };
}

export type SignatureResult = ActionResult<"signature">;

/** อัปโหลดลายเซ็น (multipart: signature) — แทนที่ของเดิม */
export async function uploadSignature(formData: FormData): Promise<SignatureResult> {
  const { t } = await getI18n();
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) return { errors: { signature: t("profile.signatureType") } };

  const body = new FormData();
  body.set("signature", file);
  body.set("source", formData.get("source") === "DRAW" ? "DRAW" : "UPLOAD");
  try {
    await apiFetch("/auth/me/signature", { method: "POST", body });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout"); // ข้อมูลผู้ใช้ (signature_url) ในทุกหน้า
  return { ok: true, message: t("profile.signatureSaved") };
}

export async function deleteSignature(): Promise<SignatureResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/auth/me/signature", { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t("profile.signatureRemoved") };
}

export async function changePassword(_prev: PasswordResult, formData: FormData): Promise<PasswordResult> {
  const { t } = await getI18n();
  const body = {
    current_password: String(formData.get("current_password") ?? ""),
    password: String(formData.get("password") ?? ""),
    password_confirmation: String(formData.get("password_confirmation") ?? ""),
  };
  if (body.password !== body.password_confirmation) {
    return { errors: { password_confirmation: t("profile.passwordMismatch") }, message: t("common.checkInput") };
  }
  try {
    await apiFetch("/auth/password", { method: "PUT", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  return { ok: true, message: t("profile.passwordChanged") };
}

/* ---------------------------------------------------------------- ยืนยันตัวตน 2 ขั้น (2FA) */

export interface TwoFactorStatus {
  available: boolean;
  enabled: boolean;
  confirmed_at: string | null;
  recovery_codes_left: number;
  required: boolean;
}

type TwoFactorResult = { ok?: boolean; error?: string; field?: "password" | "code"; secret?: string; qr_svg?: string; recovery_codes?: string[] };

/** เรียก API ของ 2FA แล้วแปลง error ของช่อง password / code เป็นข้อความ */
async function twoFactorCall(path: string, method: string, body: Record<string, string>): Promise<TwoFactorResult> {
  const { t } = await getI18n();
  try {
    const res = await apiFetch<{ data?: { secret?: string; qr_svg?: string; recovery_codes?: string[] } } | undefined>(path, { method, body: JSON.stringify(body) });
    revalidatePath("/profile");
    return { ok: true, ...(res?.data ?? {}) };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 429) return { error: t("auth.throttled") };
    const field = e.body.errors?.password ? "password" : "code";
    return { error: e.body.errors?.password?.[0] ?? e.body.errors?.code?.[0] ?? t("common.saveFailed"), field };
  }
}

export async function startTwoFactor(password: string) {
  return twoFactorCall("/auth/2fa/setup", "POST", { password: password.slice(0, 255) });
}
export async function confirmTwoFactor(code: string) {
  return twoFactorCall("/auth/2fa/confirm", "POST", { code: code.slice(0, 20) });
}
export async function regenerateRecoveryCodes(code: string) {
  return twoFactorCall("/auth/2fa/recovery-codes", "POST", { code: code.slice(0, 20) });
}
export async function disableTwoFactor(password: string, code: string) {
  return twoFactorCall("/auth/2fa", "DELETE", { password: password.slice(0, 255), code: code.slice(0, 20) });
}
