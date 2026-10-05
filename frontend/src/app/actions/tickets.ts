"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { AppNotification, TicketDetail } from "@/lib/types";

export type TicketResult = ActionResult<string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["approve", "reject", "accept", "progress", "close", "return", "confirm_close", "cancel_confirm", "cancel_reject", "cancel_withdraw"] as const;
/** action → path ของ API (ยกเลิกใช้ /cancel/...) */
const ENDPOINT: Partial<Record<(typeof ACTIONS)[number], string>> = { confirm_close: "confirm-close", cancel_confirm: "cancel/confirm", cancel_reject: "cancel/reject", cancel_withdraw: "cancel/withdraw" };
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

/** อนุมัติ / ไม่อนุมัติ / รับงาน / อนุมัติผล / ส่งกลับ / ผู้แจ้งรับงาน (ปิดงาน) */
export async function ticketAction(
  id: string,
  action: SimpleAction,
  payload: { comment?: string; signature?: string | null } = {},
): Promise<TicketResult> {
  if (!UUID_RE.test(id) || !(ACTIONS as readonly string[]).includes(action)) return invalid();
  try {
    await apiFetch(`/tickets/${id}/${ENDPOINT[action] ?? action}`, {
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

/** ผู้แจ้งขอยกเลิก (อนุมัติแล้ว) — ต้องมีเหตุผล */
export async function requestCancel(id: string, reason: string): Promise<TicketResult> {
  if (!UUID_RE.test(id)) return invalid();
  try {
    await apiFetch(`/tickets/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/tickets/${id}`);
  redirect(`/tickets/${id}?done=cancel_request`);
}

/** ผู้แจ้งลบใบแจ้งงาน (ก่อนอนุมัติ / ไม่อนุมัติ) */
export async function deleteTicket(id: string): Promise<TicketResult> {
  if (!UUID_RE.test(id)) return invalid();
  try {
    await apiFetch(`/tickets/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/tickets");
  redirect("/tickets?done=deleted");
}

/** ผู้แจ้งแก้ไขใบแจ้งงาน (ก่อนอนุมัติ) — ไฟล์แนบไม่เปลี่ยน */
export async function updateTicket(id: string, values: Record<string, string | number | null>): Promise<TicketResult> {
  if (!UUID_RE.test(id)) return invalid();
  try {
    await apiFetch(`/tickets/${id}`, { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  redirect(`/tickets/${id}?done=edited`);
}
