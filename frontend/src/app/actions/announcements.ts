"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { AnnouncementLevel } from "@/lib/types";

export type AnnouncementResult = ActionResult<"title" | "body" | "level" | "starts_on" | "ends_on" | "sort_order">;

export interface AnnouncementPayload {
  title: string;
  body: string;
  level: AnnouncementLevel;
  is_active: boolean;
  starts_on: string;
  ends_on: string;
  sort_order: string;
}

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** เพิ่ม/แก้ไขประกาศหน้า login */
export async function saveAnnouncement(id: number | null, v: AnnouncementPayload): Promise<AnnouncementResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  const body = {
    title: v.title.trim(),
    body: v.body.trim() || null,
    level: v.level,
    is_active: v.is_active,
    starts_on: v.starts_on || null,
    ends_on: v.ends_on || null,
    sort_order: v.sort_order ? Number(v.sort_order) : 0,
  };
  try {
    await apiFetch(id ? `/announcements/${id}` : "/announcements", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/announcements");
  revalidatePath("/login");
  return { ok: true, message: id ? t("announcements.updated") : t("announcements.created") };
}

export async function deleteAnnouncement(id: number): Promise<AnnouncementResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/announcements/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/announcements");
  revalidatePath("/login");
  return { ok: true, message: t("announcements.deleted") };
}
