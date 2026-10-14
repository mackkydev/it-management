"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { CalendarItem, CalendarScope, LeaveRequest, LeaveSettings, LeaveType, TicketDetail } from "@/lib/types";

export type CalendarResult = ActionResult;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- ปฏิทิน */

/** รายการในปฏิทินของช่วงวัน (เปลี่ยนเดือน/ขอบเขตฝั่ง client) */
export async function loadCalendar(from: string, to: string, scope?: CalendarScope, branchId?: number | null): Promise<CalendarItem[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  const q = new URLSearchParams({ from, to });
  if (scope) q.set("scope", scope);
  if (branchId) q.set("branch_id", String(branchId));
  try {
    return (await apiFetch<{ data: CalendarItem[] }>(`/calendar?${q}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export interface EventValues {
  title: string;
  start_on: string;
  end_on: string;
  note: string;
  all_company: boolean;
  /** ไม่รวมเสาร์-อาทิตย์ (มีผลเมื่อช่วงวันคร่อมสุดสัปดาห์) */
  skip_weekends: boolean;
}

/** เพิ่ม (id = null) / แก้ไขกิจกรรมทั่วไป */
export async function saveEvent(id: number | null, v: EventValues): Promise<CalendarResult> {
  const { t } = await getI18n();
  try {
    await apiFetch(id ? `/calendar/events/${Number(id)}` : "/calendar/events", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ title: v.title.trim(), start_on: v.start_on, end_on: v.end_on || v.start_on, note: v.note.trim() || null, all_company: v.all_company, skip_weekends: v.skip_weekends }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/calendar");
  return { ok: true, message: t("calendar.eventSaved") };
}

export async function deleteEvent(id: number): Promise<CalendarResult> {
  try {
    await apiFetch(`/calendar/events/${Number(id)}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/calendar");
  return { ok: true };
}

/** ขอบเขตปฏิทินต่อกลุ่ม (ผู้ดูแลระบบสูงสุด) */
/** ขอบเขตต่อกลุ่ม — calendar = กิจกรรม/งานหน้างาน, leave = วันลาของคนอื่น (ตั้งแยกกัน) */
export async function saveCalendarScope(scopes: Record<string, CalendarScope>, kind: "calendar" | "leave" = "calendar"): Promise<CalendarResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/calendar/scope", { method: "PUT", body: JSON.stringify(kind === "leave" ? { leave_scopes: scopes } : { scopes }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/role-permissions");
  revalidatePath("/calendar");
  return { ok: true, message: kind === "leave" ? t("calendar.leaveScopeSaved") : t("calendar.scopeSaved") };
}

/** สร้าง/เปลี่ยน (renew) หรือยกเลิกลิงก์ iCal ส่วนตัว */
export async function setFeedToken(on: boolean): Promise<{ token: string | null; message?: string }> {
  try {
    if (!on) {
      await apiFetch("/calendar/token", { method: "DELETE" });
      return { token: null };
    }
    return { token: (await apiFetch<{ data: { token: string } }>("/calendar/token", { method: "POST" })).data.token };
  } catch (e) {
    return { token: null, message: (await toActionResult(e)).message };
  }
}

/* ---------------------------------------------------------------- การลา */

/** จำนวนวันลาที่คำนวณได้ (แสดงในฟอร์ม) */
export async function previewLeaveDays(unit: string, start: string, end: string, startTime: string, endTime: string): Promise<number | null> {
  if (!DATE_RE.test(start)) return null;
  const q = new URLSearchParams({ unit, start_on: start });
  if (DATE_RE.test(end)) q.set("end_on", end);
  if (startTime) q.set("start_time", startTime);
  if (endTime) q.set("end_time", endTime);
  try {
    return (await apiFetch<{ data: { days: number } }>(`/leave/preview?${q}`)).data.days;
  } catch {
    return null;
  }
}

/** ส่งใบลา (multipart — แนบใบรับรองแพทย์ได้) */
export async function submitLeave(form: FormData): Promise<CalendarResult & { id?: string }> {
  const body = new FormData();
  for (const k of ["leave_type", "unit", "start_on", "end_on", "start_time", "end_time", "reason", "approver_id"]) {
    const v = form.get(k);
    if (typeof v === "string" && v.trim() !== "") body.set(k, v.trim());
  }
  form.getAll("files").forEach((f, i) => {
    if (f instanceof File && f.size > 0) body.set(`files[${i}]`, f, f.name);
  });
  try {
    const res = await apiFetch<{ data: LeaveRequest }>("/leave", { method: "POST", body });
    revalidatePath("/leave");
    revalidatePath("/calendar");
    return { ok: true, id: res.data.id };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function decideLeave(id: string, approve: boolean, note: string): Promise<CalendarResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/leave/${id}/${approve ? "approve" : "reject"}`, { method: "POST", body: JSON.stringify({ note: note.trim() || null }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/leave/approvals");
  revalidatePath("/calendar");
  return { ok: true, message: t(approve ? "leave.approvedMsg" : "leave.rejectedMsg") };
}

export async function cancelLeave(id: string): Promise<CalendarResult> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/leave/${id}/cancel`, { method: "POST" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/leave");
  revalidatePath("/calendar");
  return { ok: true, message: t("leave.cancelledMsg") };
}

export async function saveLeaveSettings(v: LeaveSettings): Promise<CalendarResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/leave/settings", { method: "PUT", body: JSON.stringify(v) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  return { ok: true, message: t("holidays.settingsSaved") };
}

export async function saveLeaveQuota(userId: number, year: number, leaveType: LeaveType, days: string): Promise<CalendarResult> {
  try {
    await apiFetch("/leave/quotas", { method: "PUT", body: JSON.stringify({ user_id: userId, year, leave_type: leaveType, days: days.trim() === "" ? null : Number(days) }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  return { ok: true };
}

/* ---------------------------------------------------------------- วันหยุดบริษัท */

export async function saveHoliday(id: number | null, calendarId: number | null, date: string, name: string): Promise<CalendarResult> {
  try {
    await apiFetch(id ? `/holidays/${Number(id)}` : "/holidays", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ date, name: name.trim(), ...(calendarId ? { calendar_id: Number(calendarId) } : {}) }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteHoliday(id: number): Promise<CalendarResult> {
  try {
    await apiFetch(`/holidays/${Number(id)}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function copyHolidayYear(calendarId: number | null, from: number, to: number): Promise<CalendarResult & { created?: number }> {
  const { t } = await getI18n();
  try {
    const res = await apiFetch<{ data: { created: number } }>("/holidays/copy-year", {
      method: "POST",
      body: JSON.stringify({ from, to, ...(calendarId ? { calendar_id: Number(calendarId) } : {}) }),
    });
    revalidatePath("/holidays");
    return { ok: true, created: res.data.created, message: t("holidays.copied", { n: res.data.created }) };
  } catch (e) {
    return toActionResult(e);
  }
}

/** ปฏิทินวันหยุด: เพิ่ม/แก้ชื่อ + สาขาที่ใช้ + ชุดตั้งต้น */
export async function saveHolidayCalendar(id: number | null, v: { name: string; branch_ids: number[]; is_default: boolean }): Promise<CalendarResult> {
  try {
    await apiFetch(id ? `/holiday-calendars/${Number(id)}` : "/holiday-calendars", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ name: v.name.trim(), branch_ids: v.branch_ids.map(Number), is_default: v.is_default }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteHolidayCalendar(id: number): Promise<CalendarResult> {
  try {
    await apiFetch(`/holiday-calendars/${Number(id)}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}

export type HolidayImportResult = { ok: true; created: number; updated: number } | { ok: false; message: string; rows: { row: number; message: string }[] };

export async function importHolidays(form: FormData): Promise<HolidayImportResult> {
  const { t } = await getI18n();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: t("holidays.noFile"), rows: [] };
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const res = await apiFetch<{ data: { created: number; updated: number } }>("/holidays/import", { method: "POST", body });
    revalidatePath("/holidays");
    revalidatePath("/calendar");
    return { ok: true, ...res.data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      const b = e.body as { message?: string; rows?: { row: number; message: string }[] };
      return { ok: false, message: b.message ?? t("common.saveFailed"), rows: b.rows ?? [] };
    }
    return { ok: false, message: (await toActionResult(e)).message ?? t("common.saveFailed"), rows: [] };
  }
}

/* ---------------------------------------------------------------- ไปทำงานหน้างานจากใบแจ้งงาน */

export async function saveTicketOnsite(ticketId: string, v: { start_on: string; end_on: string; note: string } | null): Promise<CalendarResult & { ticket?: TicketDetail }> {
  const { t } = await getI18n();
  if (!UUID_RE.test(ticketId)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: TicketDetail }>(`/tickets/${ticketId}/calendar`, {
      method: v ? "PUT" : "DELETE",
      ...(v ? { body: JSON.stringify({ start_on: v.start_on, end_on: v.end_on || v.start_on, ...(v.note.trim() ? { note: v.note.trim() } : {}) }) } : {}),
    });
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/calendar");
    return { ok: true, ticket: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/** วันไม่ว่างของผู้ใช้ (เตือนตอนรับงาน) */
export async function loadBusy(userId: number | null, from: string, to: string): Promise<{ kind: "leave" | "onsite"; start: string; end: string; label: string }[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  try {
    const res = await apiFetch<{ data: Record<string, { kind: "leave" | "onsite"; start: string; end: string; label: string }[]> }>(
      `/calendar/busy?${new URLSearchParams({ ...(userId ? { user_ids: String(userId) } : {}), from, to })}`,
    );
    return Object.values(res.data)[0] ?? [];
  } catch {
    return [];
  }
}
