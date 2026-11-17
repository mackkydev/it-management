"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { FixedAssetAssetOption, FixedAssetAutoLink, FixedAssetConnectionTest, FixedAssetSyncSettings } from "@/lib/types";

/** การซิงค์ Fixed Assets จาก STEC SyteLine — หน้าตั้งค่าระบบ แท็บ SyteLine (express routes/fixed-assets.ts) */

export type FixedAssetSettingsInput = Omit<FixedAssetSyncSettings, "ready" | "connection" | "source_codes" | "synced">;

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

/** ลบข้อมูลที่ซิงค์แล้วเพื่อซิงค์ใหม่ — unlinked = เฉพาะที่ยังไม่ผูก / all = ทั้งหมด (DELETE /fixed-assets) */
export async function clearFixedAssets(scope: "unlinked" | "all"): Promise<ActionResult> {
  const { t, fmt } = await getI18n();
  let deleted = 0;
  try {
    ({ deleted } = (await apiFetch<{ data: { deleted: number } }>(`/fixed-assets?scope=${scope}`, { method: "DELETE" })).data);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { message: t("fixedAssetSync.running") };
    return toActionResult(e);
  }
  revalidatePath("/settings");
  revalidatePath("/fixed-assets");
  revalidatePath("/assets", "layout");
  return { ok: true, message: t("fixedAssetSync.cleared", { n: fmt.number(deleted) }) };
}

/** ปุ่ม "ผูกตามเลขที่ทรัพย์สิน" — ดูก่อน (GET) / ผูกจริง (POST /fixed-assets/auto-link) */
export async function previewFixedAssetAutoLink(): Promise<{ data?: FixedAssetAutoLink } & ActionResult> {
  try {
    const { data } = await apiFetch<{ data: FixedAssetAutoLink }>("/fixed-assets/auto-link");
    return { ok: true, data };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function applyFixedAssetAutoLink(): Promise<ActionResult> {
  const { t, fmt } = await getI18n();
  let total = 0;
  try {
    ({ total } = (await apiFetch<{ data: FixedAssetAutoLink }>("/fixed-assets/auto-link", { method: "POST" })).data);
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/fixed-assets");
  revalidatePath("/assets", "layout");
  return { ok: true, message: t("fixedAssets.autoLink.done", { n: fmt.number(total) }) };
}

/** เพิ่ม Fixed Asset ที่เลือกเข้าระบบสินทรัพย์ (สร้างใหม่ + ผูก) — POST /fixed-assets/create-assets */
export async function createAssetsFromFixedAssets(ids: number[], category: string): Promise<ActionResult> {
  const { t, fmt } = await getI18n();
  let created = 0;
  let skipped: { fanum: string; reason: "linked" | "exists" | "invalid" }[] = [];
  try {
    ({ created, skipped } = (
      await apiFetch<{ data: { created: number; skipped: typeof skipped } }>("/fixed-assets/create-assets", {
        method: "POST",
        body: JSON.stringify({ ids, category }),
      })
    ).data);
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/fixed-assets");
  revalidatePath("/assets", "layout");
  const parts = [t("fixedAssets.createAssets.done", { n: fmt.number(created) })];
  if (skipped.length) {
    const list = skipped.slice(0, 5).map((s) => `${s.fanum} (${t(`fixedAssets.createAssets.reasons.${s.reason}`)})`).join(", ");
    parts.push(t("fixedAssets.createAssets.skipped", { n: fmt.number(skipped.length), list: skipped.length > 5 ? `${list} …` : list }));
  }
  return { ok: created > 0, message: parts.join("\n") };
}

/** ยกเลิกการผูกทั้งหมด (DELETE /fixed-assets/links) — ไม่ลบข้อมูลที่ซิงค์ */
export async function unlinkAllFixedAssets(): Promise<ActionResult> {
  const { t, fmt } = await getI18n();
  let unlinked = 0;
  try {
    ({ unlinked } = (await apiFetch<{ data: { unlinked: number } }>("/fixed-assets/links", { method: "DELETE" })).data);
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/fixed-assets");
  revalidatePath("/assets", "layout");
  return { ok: true, message: t("fixedAssets.unlinkAll.done", { n: fmt.number(unlinked) }) };
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
