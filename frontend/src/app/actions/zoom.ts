"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { ZoomBooking } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const refresh = (id?: string) => {
  for (const p of ["/zoom", "/zoom/mine", "/zoom/manage"]) revalidatePath(p);
  if (id) revalidatePath(`/zoom/bookings/${id}`);
};

/** การจอง ZOOM ที่ยังมีผลที่คาบเกี่ยวช่วงวัน (เปลี่ยนเดือน / ดูช่วงเวลาที่มีการใช้งานในฟอร์ม) — ช่วงไม่เกิน 62 วัน */
export async function loadZoomBookings(from: string, to: string): Promise<ZoomBooking[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  try {
    return (await apiFetch<{ data: ZoomBooking[] }>(`/zoom-bookings?${new URLSearchParams({ from, to })}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export interface ZoomBookingValues {
  title: string;
  details: string;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
}

/** จองใหม่ (id = null) / แก้ไข (ก่อนฝ่าย IT รับงาน หรือเมื่อฝ่าย IT ส่งกลับให้แก้วันเวลา) */
export async function saveZoomBooking(id: string | null, v: ZoomBookingValues): Promise<ActionResult<keyof ZoomBookingValues | "status"> & { id?: string }> {
  const { t } = await getI18n();
  if (id !== null && !UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: ZoomBooking }>(id ? `/zoom-bookings/${id}` : "/zoom-bookings", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ title: v.title.trim(), details: v.details.trim() || null, start_on: v.start_on, start_time: v.start_time, end_on: v.end_on, end_time: v.end_time }),
    });
    refresh(res.data.id);
    return { ok: true, id: res.data.id };
  } catch (e) {
    return toActionResult(e);
  }
}

type Result = ActionResult<"status" | "zoom_account" | "meeting_link" | "meeting_topic" | "meeting_id" | "passcode" | "link_note" | "reason" | "signature">;

async function post(id: string, path: string, body: Record<string, unknown> | null, done: string): Promise<Result> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/zoom-bookings/${id}/${path}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
    refresh(id);
    return { ok: true, message: done };
  } catch (e) {
    return toActionResult(e);
  }
}

/** ผู้จองยกเลิก */
export async function cancelZoomBooking(id: string): Promise<Result> {
  const { t } = await getI18n();
  return post(id, "cancel", null, t("zoom.done.cancelled"));
}

/** ฝ่าย IT รับงาน */
export async function acceptZoomBooking(id: string): Promise<Result> {
  const { t } = await getI18n();
  return post(id, "accept", null, t("zoom.done.accepted"));
}

export interface ZoomLinkValues {
  /** บัญชี ZOOM จากข้อมูล Drop Down */
  account: string;
  link: string;
  topic: string;
  meeting_id: string;
  passcode: string;
  /** ข้อความเชิญเต็มจาก ZOOM */
  invitation: string;
}

/** ผู้จองกดรับ = ปิดใบงาน */
export async function acknowledgeZoomBooking(id: string): Promise<Result> {
  const { t } = await getI18n();
  return post(id, "acknowledge", null, t("zoom.done.acknowledged"));
}

/** ผู้จัดการ IT อนุมัติ = ประทับชื่อ + ลายเซ็นในโปรไฟล์ลงใบงาน */
export async function approveZoomBooking(id: string): Promise<Result> {
  const { t } = await getI18n();
  return post(id, "approve", null, t("zoom.done.approved"));
}

/** ฝ่าย IT ส่งลิงก์ประชุม + Topic / Meeting ID / Passcode (ครั้งแรก = รอผู้จัดการ IT อนุมัติ / ครั้งถัดไป = แก้ลิงก์) */
export async function sendZoomLink(id: string, v: ZoomLinkValues): Promise<Result> {
  const { t } = await getI18n();
  if (!/^https?:\/\/\S+$/i.test(v.link.trim())) return { errors: { meeting_link: t("zoom.validate.link") }, message: t("common.checkInput") };
  const opt = (s: string) => s.trim() || null;
  return post(
    id,
    "link",
    { zoom_account: v.account, meeting_link: v.link.trim(), meeting_topic: opt(v.topic), meeting_id: opt(v.meeting_id), passcode: opt(v.passcode), link_note: opt(v.invitation) },
    t("zoom.done.linked"),
  );
}

/** ฝ่าย IT แจ้งกลับผู้จองให้แก้วันเวลา: ช่วงเวลานี้มีการใช้งาน ZOOM แล้ว (ไม่ระบุเหตุผล = ข้อความตั้งต้นของระบบ) */
export async function zoomBusy(id: string, reason: string): Promise<Result> {
  const { t } = await getI18n();
  return post(id, "busy", { reason: reason.trim() || null }, t("zoom.done.busy"));
}
