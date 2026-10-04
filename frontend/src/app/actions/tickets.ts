"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { AppNotification, TicketDetail } from "@/lib/types";

export type TicketResult = ActionResult<string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["approve", "reject", "accept", "close", "return"] as const;
type SimpleAction = (typeof ACTIONS)[number];

async function invalid(): Promise<TicketResult> {
  const { t } = await getI18n();
  return { message: t("common.saveFailed") };
}

/** แจ้งงาน: FormData จาก client (ฟิลด์ + photos[] + documents[] + signature) ส่งต่อ Laravel ตรงๆ */
export async function createTicket(form: FormData): Promise<TicketResult> {
  let id: string;
  try {
    const res = await apiFetch<{ data: TicketDetail }>("/tickets", { method: "POST", body: form });
    id = res.data.id;
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/tickets");
  redirect(`/tickets/${id}?done=created`);
}

/** อนุมัติ / ไม่อนุมัติ / รับงาน / ปิดงาน / ส่งกลับ */
export async function ticketAction(
  id: string,
  action: SimpleAction,
  payload: { comment?: string; signature?: string | null } = {},
): Promise<TicketResult> {
  if (!UUID_RE.test(id) || !(ACTIONS as readonly string[]).includes(action)) return invalid();
  try {
    await apiFetch(`/tickets/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ comment: payload.comment?.trim() || null, signature: payload.signature ?? undefined }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/it/tickets");
  redirect(`/tickets/${id}?done=${action}`);
}

/** บันทึกผลการดำเนินงาน (multipart: photos[], parts[i][name|quantity|photo], signature) */
export async function recordResult(id: string, form: FormData): Promise<TicketResult> {
  if (!UUID_RE.test(id)) return invalid();
  try {
    await apiFetch(`/tickets/${id}/result`, { method: "POST", body: form });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/tickets/${id}`);
  redirect(`/tickets/${id}?done=result`);
}

/* ---------------- แจ้งเตือน (กระดิ่ง) ---------------- */

export async function fetchNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
  try {
    const res = await apiFetch<{ data: AppNotification[]; unread_count: number }>("/notifications?per_page=15");
    return { items: res.data, unread: res.unread_count };
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await apiFetch(`/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch("/notifications/read-all", { method: "POST" }).catch(() => undefined);
}
