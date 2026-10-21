"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";

/** หน้าตรวจสอบสิทธิ์ (/access-review): สมาชิกกลุ่ม + ยกเลิกการมอบรายคน — API ตรวจกติกาการมอบ / audit ให้ */

export type AccessReviewResult = ActionResult<"user_ids" | "expires_on" | "user">;

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;
const validKey = (key: unknown): key is string => typeof key === "string" && /^[a-z0-9_.]{1,60}$/.test(key);
const validDate = (d: unknown): d is string | null => d === null || (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));

async function invalid(): Promise<AccessReviewResult> {
  const { t } = await getI18n();
  return { message: t("common.saveFailed") };
}

async function done(key: "added" | "saved" | "removed" | "revoked"): Promise<AccessReviewResult> {
  const { t } = await getI18n();
  revalidatePath("/access-review");
  return { ok: true, message: t(`accessReview.done.${key}`) };
}

export async function addGroupMembers(group: string, userIds: number[], expiresOn: string | null): Promise<AccessReviewResult> {
  if (!validKey(group) || !Array.isArray(userIds) || !userIds.length || !userIds.every(validId) || !validDate(expiresOn)) return invalid();
  try {
    await apiFetch(`/permission-groups/${group}/members`, { method: "POST", body: JSON.stringify({ user_ids: userIds, expires_on: expiresOn }) });
  } catch (e) {
    return toActionResult(e);
  }
  return done("added");
}

export async function setMemberExpiry(group: string, userId: number, expiresOn: string | null): Promise<AccessReviewResult> {
  if (!validKey(group) || !validId(userId) || !validDate(expiresOn)) return invalid();
  try {
    await apiFetch(`/permission-groups/${group}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ expires_on: expiresOn }) });
  } catch (e) {
    return toActionResult(e);
  }
  return done("saved");
}

export async function removeGroupMember(group: string, userId: number): Promise<AccessReviewResult> {
  if (!validKey(group) || !validId(userId)) return invalid();
  try {
    await apiFetch(`/permission-groups/${group}/members/${userId}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  return done("removed");
}

/** ยกเลิกสิทธิ์อนุญาต/ไม่อนุญาตรายข้อ = กลับไปใช้ตามกลุ่ม (inherit) */
export async function revokeOverride(userId: number, key: string): Promise<AccessReviewResult> {
  if (!validId(userId) || !validKey(key)) return invalid();
  try {
    await apiFetch(`/users/${userId}/permissions`, { method: "PUT", body: JSON.stringify({ overrides: { [key]: "inherit" } }) });
  } catch (e) {
    return toActionResult(e);
  }
  return done("revoked");
}
