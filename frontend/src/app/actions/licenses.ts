"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult } from "@/lib/action-result";
import { ApiError, apiFetch, reauthChallenge } from "@/lib/api";
import type { LicenseFieldErrors, LicenseRecordValues } from "@/lib/types";

export interface LicenseSaveResult {
  errors?: LicenseFieldErrors;
  message?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toResult = (e: unknown) => toActionResult<keyof LicenseFieldErrors>(e, "assets.form.notFound");

async function invalidId(): Promise<LicenseSaveResult> {
  const { t } = await getI18n();
  return { message: t("assets.form.invalidId") };
}

/** ค่าจากฟอร์ม → payload: ช่องว่าง = null */
function toPayload(v: LicenseRecordValues) {
  const text = (s: string) => (s.trim() === "" ? null : s.trim());
  const l = v.license;
  return {
    license_no: text(v.license_no),
    name: v.name.trim(),
    brand: text(v.brand),
    model: text(v.model),
    serial_number: text(v.serial_number),
    status: v.status,
    location_id: v.location_id ? Number(v.location_id) : null,
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    purchase_date: text(v.purchase_date),
    purchase_cost: text(v.purchase_cost),
    notes: text(v.notes),
    license: {
      billing: l.billing,
      start_date: text(l.start_date),
      expires_at: l.billing === "perpetual" ? null : text(l.expires_at),
      seats: l.seats ? Number(l.seats) : null,
      vendor: text(l.vendor),
      license_key: text(l.license_key), // ว่าง = คงค่าเดิม
      clear_license_key: l.clear_license_key,
      notify_days_before: l.notify_days_before ? Number(l.notify_days_before) : null,
      software_type: l.software_type,
    },
  };
}

export async function createLicense(values: LicenseRecordValues): Promise<LicenseSaveResult> {
  try {
    await apiFetch("/licenses", { method: "POST", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  redirect("/licenses?saved=created");
}

export async function updateLicense(id: string, values: LicenseRecordValues): Promise<LicenseSaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}`, { method: "PATCH", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  revalidatePath(`/licenses/${id}`);
  redirect("/licenses?saved=updated");
}

export async function deleteLicense(id: string): Promise<LicenseSaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  redirect("/licenses?saved=deleted");
}

/** ดู license key (ถอดรหัส) — API ตรวจสิทธิ์ (ผู้จัดการ/IT) และจำกัดจำนวนครั้ง */
/** reauth = ต้องยืนยันรหัสผ่านซ้ำก่อน (API ตอบ 428) */
export async function revealLicenseKey(id: string): Promise<{ key?: string | null; message?: string; reauth?: import("@/lib/types").ReauthChallenge }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    return { key: (await apiFetch<{ data: { license_key: string | null } }>(`/licenses/${id}/license-key`, { method: "POST" })).data.license_key };
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) return { message: e.message, reauth: reauthChallenge(e) };
    return toResult(e);
  }
}

/** อัปโหลดไฟล์ license (multipart files[]) */
export async function uploadLicenseFiles(id: string, form: FormData): Promise<LicenseSaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/files`, { method: "POST", body: form });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}

/** ไอคอน License ซอฟต์แวร์ (multipart icon — แทนอันเดิม) */
export async function uploadLicenseIcon(id: string, form: FormData): Promise<LicenseSaveResult & { ok?: boolean; errors?: Record<string, string> }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/icon`, { method: "PUT", body: form });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}

export async function deleteLicenseIcon(id: string): Promise<LicenseSaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/icon`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}

export async function deleteLicenseFile(id: string, fileId: number): Promise<LicenseSaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id) || !Number.isInteger(fileId) || fileId <= 0) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/files/${fileId}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}

/** จัดการสัญญา: ต่อสัญญาแล้ว (วันหมดอายุใหม่) */
export async function renewLicense(id: string, expiresAt: string): Promise<LicenseSaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/renew`, { method: "POST", body: JSON.stringify({ expires_at: expiresAt }) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}

/** จัดการสัญญา: ยกเลิกสัญญา */
export async function cancelLicense(id: string, reason: string): Promise<LicenseSaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/licenses/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason || null }) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/licenses");
  revalidatePath(`/licenses/${id}`);
  return { ok: true };
}
