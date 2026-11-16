"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { FixedAssetAssetOption, FixedAssetConnectionTest, FixedAssetSyncSettings } from "@/lib/types";

/** การซิงค์ Fixed Assets จาก STEC SyteLine — หน้าตั้งค่าระบบ แท็บ SyteLine (express routes/fixed-assets.ts) */

export type FixedAssetSettingsInput = Omit<FixedAssetSyncSettings, "ready" | "connection">;

export async function saveFixedAssetSettings(values: FixedAssetSettingsInput): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/fixed-assets/settings", { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/settings");
  return { ok: true, message: t("settingsPage.saved") };
}

export async function testFixedAssetConnection(): Promise<{ data?: FixedAssetConnectionTest } & ActionResult> {
  try {
    const { data } = await apiFetch<{ data: FixedAssetConnectionTest }>("/fixed-assets/test", { method: "POST" });
    return { ok: true, data };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function startFixedAssetSync(): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/fixed-assets/sync", { method: "POST" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { message: t("fixedAssetSync.running") };
    const r = await toActionResult(e);
    return r.errors?.sync ? { message: r.errors.sync } : r;
  }
  revalidatePath("/settings");
  return { ok: true, message: t("fixedAssetSync.started") };
}

/** ผูก / ยกเลิกการผูก (assetId = null) / กลับไปผูกอัตโนมัติ (reset) — PUT /fixed-assets/:id/link */
export async function linkFixedAsset(id: number, input: { asset_id: string | null } | { reset: true }): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch(`/fixed-assets/${id}/link`, { method: "PUT", body: JSON.stringify(input) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/fixed-assets");
  revalidatePath("/assets", "layout");
  return { ok: true, message: t("fixedAssets.linkSaved") };
}

/** ค้นสินทรัพย์ตอนผูก (≥ 2 ตัวอักษร) */
export async function searchAssetsForLink(q: string): Promise<FixedAssetAssetOption[]> {
  if (q.trim().length < 2) return [];
  try {
    const { data } = await apiFetch<{ data: FixedAssetAssetOption[] }>(`/fixed-assets/asset-options?${new URLSearchParams({ q: q.trim().slice(0, 50) })}`);
    return data;
  } catch {
    return [];
  }
}
