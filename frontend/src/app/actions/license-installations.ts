"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { Asset, Paginated } from "@/lib/types";

export type InstallResult = ActionResult<"license_id" | "device_asset_id" | "device_name" | "user_id" | "branch_id" | "installed_at" | "notes">;

export interface InstallPayload {
  license_id: string;
  device_asset_id: string;
  device_name: string;
  user_id: number | null;
  branch_id: string;
  installed_at: string;
  notes: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

function refresh(licenseId?: string) {
  revalidatePath("/license-installations");
  if (licenseId && UUID_RE.test(licenseId)) revalidatePath(`/assets/${licenseId}`);
}

/** บันทึกการติดตั้ง license */
export async function createInstallation(v: InstallPayload): Promise<InstallResult> {
  const { t } = await getI18n();
  const body = {
    license_id: v.license_id,
    device_asset_id: v.device_asset_id || null,
    device_name: v.device_asset_id ? null : v.device_name.trim() || null,
    user_id: v.user_id,
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    installed_at: v.installed_at,
    notes: v.notes.trim() || null,
  };
  try {
    await apiFetch("/license-installations", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  refresh(v.license_id);
  return { ok: true, message: t("installations.saved") };
}

/** ถอนการติดตั้ง (คืน seat) */
export async function uninstallInstallation(id: number, licenseId: string): Promise<InstallResult> {
  if (!validId(id)) return { message: (await getI18n()).t("common.saveFailed") };
  try {
    await apiFetch(`/license-installations/${id}/uninstall`, { method: "POST", body: "{}" });
  } catch (e) {
    const r = await toActionResult<"uninstalled_at">(e);
    return { message: r.errors?.uninstalled_at ?? r.message };
  }
  refresh(licenseId);
  return { ok: true };
}

export async function deleteInstallation(id: number, licenseId: string): Promise<InstallResult> {
  if (!validId(id)) return { message: (await getI18n()).t("common.saveFailed") };
  try {
    await apiFetch(`/license-installations/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh(licenseId);
  return { ok: true };
}

/** ค้นหาเครื่องจากทะเบียนสินทรัพย์ (ไม่รวมหมวด Software) */
export async function searchDevices(q: string): Promise<{ id: string; asset_tag: string; name: string }[]> {
  const query = new URLSearchParams({ search: q.slice(0, 100), per_page: "10" });
  try {
    const res = await apiFetch<Paginated<Asset>>(`/assets?${query}`);
    return res.data.filter((a) => a.category !== "SOFTWARE").map((a) => ({ id: a.id, asset_tag: a.asset_tag, name: a.name }));
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}
