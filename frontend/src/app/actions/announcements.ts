"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { AnnouncementLevel, AnnouncementRepeat } from "@/lib/types";

export type AnnouncementResult = ActionResult<"title" | "body" | "level" | "starts_on" | "ends_on" | "sort_order" | "repeat_mode" | "repeat_weekday" | "repeat_day" | "repeat_month" | "cover" | "files">;

export interface AnnouncementPayload {
  title: string;
  body: string;
  level: AnnouncementLevel;
  is_active: boolean;
  starts_on: string;
  ends_on: string;
  sort_order: string;
  repeat_mode: AnnouncementRepeat;
  repeat_weekday: string;
  repeat_day: string;
  repeat_month: string;
}

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** เพิ่ม/แก้ไขประกาศ (multipart: ช่องในฟอร์ม + cover + files[] + remove_cover + remove_file_ids[]) */
export async function saveAnnouncement(id: number | null, form: FormData): Promise<AnnouncementResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(id ? `/announcements/${id}` : "/announcements", { method: id ? "PUT" : "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/announcements");
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
  return { ok: true, message: t("announcements.deleted") };
}
