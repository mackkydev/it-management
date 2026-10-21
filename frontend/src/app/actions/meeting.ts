"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import { branchQuery, selectedBranch } from "@/lib/booking-scope";
import type { MeetingBooking, MeetingRoom, MeetingSeat } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validId = (id: number) => Number.isInteger(id) && id > 0;

const refresh = () => {
  for (const p of ["/meeting-rooms", "/meeting-rooms/mine", "/meeting-rooms/rooms"]) revalidatePath(p);
};

/* ---------------------------------------------------------------- การจอง */

/** การจองที่ยืนยันแล้วของช่วงวัน (เปลี่ยนเดือน / ตรวจเวลาว่างในฟอร์ม) — ตามสาขาที่เลือกดู */
export async function loadBookings(from: string, to: string): Promise<MeetingBooking[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  try {
    const branch = await selectedBranch("meeting");
    return (await apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings?${new URLSearchParams({ from, to, ...branchQuery(branch) })}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export interface BookingValues {
  room_id: string;
  title: string;
  attendees: string;
  purpose: string;
  equipment: string[];
  note: string;
  date: string;
  /** วันสุดท้าย (ว่าง / เท่ากับ date = วันเดียว) */
  end_date: string;
  start_time: string;
  end_time: string;
}

/** จองใหม่ (id = null) / แก้ไขการจอง */
export async function saveBooking(id: string | null, v: BookingValues): Promise<ActionResult<keyof BookingValues> & { id?: string }> {
  const { t } = await getI18n();
  if (id !== null && !UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: MeetingBooking }>(id ? `/meeting-bookings/${id}` : "/meeting-bookings", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        room_id: Number(v.room_id) || null,
        title: v.title.trim(),
        attendees: Number(v.attendees) || null,
        purpose: v.purpose,
        equipment: v.equipment,
        note: v.note.trim() || null,
        date: v.date,
        end_date: v.end_date && v.end_date >= v.date ? v.end_date : v.date,
        start_time: v.start_time,
        end_time: v.end_time,
      }),
    });
    refresh();
    return { ok: true, id: res.data.id, message: t(id ? "meeting.booking.updated" : "meeting.booking.created") };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function cancelBooking(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/meeting-bookings/${id}/cancel`, { method: "POST" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true, message: t("meeting.booking.cancelled") };
}

export async function deleteBooking(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/meeting-bookings/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true, message: t("meeting.booking.deleted") };
}

/* ---------------------------------------------------------------- ห้องประชุม */

export interface RoomValues {
  name: string;
  branch_id: string;
  location: string;
  room_no: string;
  description: string;
  seats: MeetingSeat[];
  is_active: boolean;
  sort_order: string;
}

/** เพิ่ม (id = null) / แก้ไขห้อง — คืนห้องล่าสุด (ใช้ id ตอนอัปโหลดรูปต่อ) */
export async function saveRoom(id: number | null, v: RoomValues): Promise<ActionResult<keyof RoomValues> & { room?: MeetingRoom }> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: MeetingRoom }>(id ? `/meeting-rooms/${id}` : "/meeting-rooms", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        name: v.name.trim(),
        branch_id: Number(v.branch_id) || null,
        location: v.location.trim() || null,
        room_no: v.room_no.trim() || null,
        description: v.description.trim() || null,
        seats: v.seats.map((s) => ({ label: s.label.trim(), count: Number(s.count) })),
        is_active: v.is_active,
        sort_order: Number(v.sort_order) || 0,
      }),
    });
    refresh();
    return { ok: true, room: res.data, message: t("meeting.rooms.saved") };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function deleteRoom(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/meeting-rooms/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  refresh();
  return { ok: true, message: t("meeting.rooms.deleted") };
}

/** อัปโหลดรูปห้อง (multipart images[]) */
export async function uploadRoomImages(id: number, form: FormData): Promise<ActionResult & { room?: MeetingRoom }> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  const body = new FormData();
  form.getAll("images").forEach((f, i) => {
    if (f instanceof File && f.size > 0) body.set(`images[${i}]`, f, f.name);
  });
  try {
    const res = await apiFetch<{ data: MeetingRoom }>(`/meeting-rooms/${id}/images`, { method: "POST", body });
    refresh();
    return { ok: true, room: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/** ตั้งรูปหลัก (primary = true) / ลบรูป */
export async function updateRoomImage(id: number, imageId: number, action: "primary" | "delete"): Promise<ActionResult & { room?: MeetingRoom }> {
  const { t } = await getI18n();
  if (!validId(id) || !validId(imageId)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: MeetingRoom }>(`/meeting-rooms/${id}/images/${imageId}`, { method: action === "primary" ? "PUT" : "DELETE" });
    refresh();
    return { ok: true, room: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}
