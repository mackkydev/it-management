import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { first, insert, isUuid, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, nowDb } from "../lib/time.js";
import { regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audit } from "../services/audit.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { usersWithPermissions } from "../services/permissions.js";
import { createCompletedTicket } from "./tickets.js";

/**
 * จอง ZOOM — ทุกคนดูปฏิทินการใช้ ZOOM / จอง (หัวข้อ + ช่วงวันเวลา + รายละเอียด) / แก้ (ก่อน IT รับงาน) / ยกเลิกของตัวเอง
 *   GET /zoom-bookings?from=&to= (ปฏิทิน: ผู้ใช้ทั่วไป = ส่งลิงก์แล้ว / zoom.manage = รอรับงาน + รับงานแล้ว + ส่งลิงก์แล้ว ของทุกคน), GET /zoom-bookings/mine?status=upcoming|past|cancelled,
 *   GET /zoom-bookings/manage?status=pending|accepted|confirmed (zoom.manage), GET|PUT /zoom-bookings/:uuid, POST /zoom-bookings, POST .../cancel
 * ฝ่าย IT (zoom.manage): จองใหม่ = pending → แจ้งผู้มีสิทธิ์ → POST .../accept (รับงาน = ผู้รับงาน) →
 *   POST .../link { meeting_link, meeting_topic, meeting_id, passcode, link_note (ข้อความเชิญเต็มจาก ZOOM) } = confirmed + แจ้งผู้จอง + สร้างใบแจ้งงานที่ปิดแล้ว (ticket_id) → แถวใบงานในชีต KPI ของผู้รับงาน
 *   (ส่งซ้ำหลัง confirmed = แก้ลิงก์ แจ้งผู้จองอีกครั้ง ไม่สร้างใบงานใหม่)
 *   POST .../busy { reason? } (รอรับงาน / รับงานแล้ว) = rejected "ช่วงเวลานี้มีการใช้งาน ZOOM แล้ว" + แจ้งผู้จอง
 * ไม่ตรวจเวลาชนอัตโนมัติ (มีบัญชี ZOOM หลายบัญชีได้) — ฝ่าย IT ตรวจเองแล้วกดแจ้งกลับ; ลิงก์ประชุมเห็นเฉพาะผู้จอง + zoom.manage
 */
export const zoomRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d)$/;
const LINK = /^https?:\/\/\S+$/i;
const MAX_DAYS = 31;
/** เรื่องของใบแจ้งงานที่สร้างตอนส่งลิงก์ (เรื่องอื่นๆ) */
export const ZOOM_TICKET_TYPE = "จองใช้งาน ZOOM";
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);
const manages = (u: UserRow) => can(u, "zoom.manage");

/** วันเวลาปัจจุบัน "YYYY-MM-DD HH:MM" ตามเขตเวลาของผู้ใช้ */
function localNow(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: config.localTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

interface ZoomRow {
  id: number;
  uuid: string;
  user_id: number;
  user_name: string | null;
  department: string | null;
  title: string;
  details: string | null;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
  status: "pending" | "accepted" | "confirmed" | "rejected" | "cancelled";
  assignee_id: number | null;
  assignee_name: string | null;
  accepted_at: string | null;
  meeting_link: string | null;
  link_note: string | null;
  meeting_topic: string | null;
  meeting_id: string | null;
  passcode: string | null;
  confirmed_name: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
  rejected_name: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  ticket_id: number | null;
  ticket_uuid: string | null;
  ticket_no: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT = `SELECT z.*, u.name AS user_name, a.name AS assignee_name, c.name AS confirmed_name, r.name AS rejected_name, tk.uuid AS ticket_uuid, tk.ticket_no
  FROM zoom_bookings z LEFT JOIN users u ON u.id = z.user_id LEFT JOIN users a ON a.id = z.assignee_id
  LEFT JOIN users c ON c.id = z.confirmed_by LEFT JOIN users r ON r.id = z.rejected_by LEFT JOIN it_tickets tk ON tk.id = z.ticket_id`;

/** ยังมีผล (ขึ้นปฏิทิน): รอรับงาน / รับงานแล้ว / ส่งลิงก์แล้ว */
const ACTIVE = ["pending", "accepted", "confirmed"];
const isActive = (z: { status: string }) => ACTIVE.includes(z.status);
const startAt = (z: { start_on: string; start_time: string }) => `${dateOnly(z.start_on)} ${z.start_time}`;
const endAt = (z: { end_on: string; end_time: string }) => `${dateOnly(z.end_on)} ${z.end_time}`;
const isOver = (z: { end_on: string; end_time: string }) => endAt(z) <= localNow();
/** ยังไม่จบ = เวลาสิ้นสุดยังไม่ถึง (เวลาไทย) */
const UPCOMING = "(z.end_on > ? OR (z.end_on = ? AND z.end_time > ?))";
const upcomingParams = () => {
  const now = localNow();
  return [now.slice(0, 10), now.slice(0, 10), now.slice(11)];
};
const periodText = (z: ZoomRow) => (dateOnly(z.start_on) === dateOnly(z.end_on) ? `${dateOnly(z.start_on)} ${z.start_time}–${z.end_time}` : `${startAt(z)} – ${endAt(z)}`);

function json(z: ZoomRow, u: UserRow) {
  const mine = Number(z.user_id) === u.id;
  const manager = manages(u);
  const over = isOver(z);
  return {
    id: z.uuid,
    title: z.title,
    details: z.details,
    user: { id: Number(z.user_id), name: z.user_name ?? "" },
    department: z.department,
    start_on: dateOnly(z.start_on)!,
    start_time: z.start_time,
    end_on: dateOnly(z.end_on)!,
    end_time: z.end_time,
    status: z.status,
    is_over: over,
    assignee: z.assignee_id ? { id: Number(z.assignee_id), name: z.assignee_name ?? "" } : null,
    accepted_at: iso(z.accepted_at),
    // ลิงก์ประชุมเห็นเฉพาะผู้จอง + ฝ่าย IT ที่จัดการคำขอ ZOOM
    meeting_link: mine || manager ? z.meeting_link : null,
    link_note: mine || manager ? z.link_note : null,
    meeting_topic: mine || manager ? z.meeting_topic : null,
    meeting_id: mine || manager ? z.meeting_id : null,
    passcode: mine || manager ? z.passcode : null,
    confirmed_by: z.confirmed_name,
    confirmed_at: iso(z.confirmed_at),
    reject_reason: z.reject_reason,
    rejected_by: z.rejected_name,
    rejected_at: iso(z.rejected_at),
    cancelled_at: iso(z.cancelled_at),
    ticket: z.ticket_uuid && (mine || manager) ? { id: z.ticket_uuid, ticket_no: z.ticket_no ?? "" } : null,
    created_at: iso(z.created_at),
    updated_at: iso(z.updated_at),
    // ผู้จอง: แก้ได้ก่อน IT รับงาน / ยกเลิกได้จนกว่าจะจบเวลา
    can_edit: mine && z.status === "pending" && !over,
    can_cancel: mine && isActive(z) && !over,
    can_accept: manager && z.status === "pending" && !over,
    can_link: manager && (z.status === "accepted" || z.status === "confirmed") && !over,
    can_busy: manager && (z.status === "pending" || z.status === "accepted") && !over,
  };
}

async function findZoom(req: Request): Promise<ZoomRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await first<ZoomRow>(`${SELECT} WHERE z.uuid = ?`, [uuid]) : null;
  if (!row) throw notFound();
  // ผู้ใช้ทั่วไปเห็นการจองของคนอื่นเฉพาะที่ฝ่าย IT ส่งลิงก์แล้ว — ขั้นตอนอื่น (รอรับงาน / รับงานแล้ว / ยกเลิก / แจ้งกลับ) เห็นเฉพาะผู้จอง + ฝ่าย IT
  const u = me(req);
  if (Number(row.user_id) !== u.id && !manages(u) && row.status !== "confirmed") throw notFound();
  return row;
}
const reload = async (id: number) => (await first<ZoomRow>(`${SELECT} WHERE z.id = ?`, [id]))!;

/* ---------------------------------------------------------------- แจ้งเตือน */

const noticeData = (u: UserRow, z: ZoomRow, event: string) => ({
  kind: "zoom",
  event,
  zoom_booking_id: z.uuid,
  actor: u.name,
  title: z.title,
  start_on: dateOnly(z.start_on),
  start_time: z.start_time,
  end_on: dateOnly(z.end_on),
  end_time: z.end_time,
});
/** ฝ่าย IT ที่รับงานจอง ZOOM ได้ (zoom.manage) — เงื่อนไขเดียวกับตัวเลขเมนู /zoom/manage */
const handlers = async () => (await usersWithPermissions(["zoom.manage"])).map((x) => Number(x.id));
async function notifyHandlers(u: UserRow, z: ZoomRow) {
  const ids = (await handlers()).filter((id) => id !== u.id);
  if (ids.length) await notifyUsers(ids, "zoom.requested", noticeData(u, z, "requested"));
}
async function notifyOwner(u: UserRow, z: ZoomRow, event: "accepted" | "confirmed" | "link_updated" | "rejected") {
  if (Number(z.user_id) !== u.id) await notifyUsers([Number(z.user_id)], `zoom.${event}`, noticeData(u, z, event));
}
/** รับงาน / แจ้งกลับ / ยกเลิก → แจ้งเตือน "คำขอใหม่" ของฝ่าย IT หมดหน้าที่ */
const resolveRequested = (z: ZoomRow) => markNoticesRead("zoom_booking_id", z.uuid, { events: ["requested"] });

/* ---------------------------------------------------------------- รายการ */

zoomRoutes.get("/zoom-bookings", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { from: ["required", regex(DATE)], to: ["required", regex(DATE)] }, { locale: req.locale });
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  // ฝ่าย IT (zoom.manage) เห็นทุกขั้นตอน (รอรับงาน / รับงานแล้ว / ส่งลิงก์แล้ว) — ผู้ใช้ทั่วไปเห็นเฉพาะที่ส่งลิงก์แล้ว
  const statuses = manages(u) ? ACTIVE : ["confirmed"];
  const rows = await select<ZoomRow>(`${SELECT} WHERE z.status IN (?) AND z.start_on <= ? AND z.end_on >= ? ORDER BY z.start_on, z.start_time, z.id`, [statuses, to, from]);
  res.json({ data: rows.map((z) => json(z, u)) });
});

zoomRoutes.get("/zoom-bookings/mine", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { status: ["nullable", "in:upcoming,past,cancelled"] }, { locale: req.locale });
  const status = (f.status as string) ?? "upcoming";
  const where = ["z.user_id = ?"];
  const params: unknown[] = [u.id];
  // ยกเลิก = ยกเลิกเอง + ฝ่าย IT แจ้งว่ามีการใช้งานแล้ว; ที่จะถึง / ผ่านมาแล้ว = ที่ยังมีผล
  if (status === "cancelled") where.push("z.status IN ('cancelled', 'rejected')");
  else {
    where.push("z.status IN (?)", status === "upcoming" ? UPCOMING : `NOT ${UPCOMING}`);
    params.push(ACTIVE, ...upcomingParams());
  }
  const order = status === "upcoming" ? "z.start_on, z.start_time" : "z.start_on DESC, z.start_time DESC";
  res.json({ data: (await select<ZoomRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, params)).map((z) => json(z, u)) });
});

/** ฝ่าย IT: pending = รอรับงาน / accepted = รับงานแล้ว รอส่งลิงก์ / confirmed = ส่งลิงก์แล้ว (ยังไม่จบเวลา) */
zoomRoutes.get("/zoom-bookings/manage", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const f = await validate(req.input, { status: ["nullable", "in:pending,accepted,confirmed"] }, { locale: req.locale });
  const status = (f.status as string) ?? "pending";
  const rows = await select<ZoomRow>(`${SELECT} WHERE z.status = ? AND ${UPCOMING} ORDER BY z.start_on, z.start_time LIMIT 500`, [status, ...upcomingParams()]);
  // ตัวเลขบนแท็บ = รายการค้างของแต่ละขั้น (ยังไม่จบเวลา)
  const counts = await select<{ status: string; n: number }>(`SELECT z.status, COUNT(*) AS n FROM zoom_bookings z WHERE z.status IN (?) AND ${UPCOMING} GROUP BY z.status`, [ACTIVE, ...upcomingParams()]);
  const count = (k: string) => Number(counts.find((c) => c.status === k)?.n ?? 0);
  res.json({ data: rows.map((z) => json(z, u)), meta: { counts: { pending: count("pending"), accepted: count("accepted"), confirmed: count("confirmed") } } });
});

zoomRoutes.get("/zoom-bookings/:uuid", async (req, res) => {
  const z = await findZoom(req);
  // เปิดดูแล้ว = แจ้งเตือนของรายการนี้ของผู้ดูอ่านแล้ว
  await markNoticesRead("zoom_booking_id", z.uuid, { userId: me(req).id });
  res.json({ data: json(z, me(req)) });
});

/* ---------------------------------------------------------------- จอง / แก้ / ยกเลิก */

async function bookingInput(req: Request) {
  const data = await validate(
    req.input,
    {
      title: ["required", "string", "max:255", regex(/\S/)],
      details: ["nullable", "string", "max:5000"],
      start_on: ["required", regex(DATE)],
      start_time: ["required", regex(TIME)],
      end_on: ["required", regex(DATE)],
      end_time: ["required", regex(TIME)],
    },
    { locale: req.locale },
  );
  const v = { start_on: String(data.start_on), start_time: String(data.start_time), end_on: String(data.end_on), end_time: String(data.end_time) };
  const days = (new Date(v.end_on).getTime() - new Date(v.start_on).getTime()) / 86_400_000;
  if (endAt(v) <= startAt(v)) throw ValidationError.withMessages({ end_time: t(req, "eam.meeting.time_order") });
  if (days > MAX_DAYS) throw ValidationError.withMessages({ end_on: t(req, "eam.zoom.too_long", { days: MAX_DAYS }) });
  if (isOver(v)) throw ValidationError.withMessages({ end_on: t(req, "eam.meeting.past") });
  return { title: String(data.title).trim(), details: typeof data.details === "string" && data.details.trim() ? data.details.trim() : null, ...v };
}
const snapshot = (z: ZoomRow) => ({ title: z.title, details: z.details, start_on: dateOnly(z.start_on), start_time: z.start_time, end_on: dateOnly(z.end_on), end_time: z.end_time, status: z.status });

zoomRoutes.post("/zoom-bookings", async (req, res) => {
  const u = me(req);
  const v = await bookingInput(req);
  const now = nowDb();
  const id = await insert("zoom_bookings", { uuid: randomUUID(), ...v, user_id: u.id, department: u.department, branch_id: u.branch_id, status: "pending", created_at: now, updated_at: now });
  const z = await reload(id);
  await audit(req, { action: "zoom_booking.created", subjectType: "zoom_booking", subjectId: id, after: v });
  await notifyHandlers(u, z);
  res.status(201).json({ data: json(z, u) });
});

/** ผู้จองแก้ได้ก่อนฝ่าย IT รับงาน */
zoomRoutes.put("/zoom-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  authorize(Number(z.user_id) === u.id);
  if (z.status !== "pending" || isOver(z)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.not_editable") });
  const v = await bookingInput(req);
  await update("zoom_bookings", { ...v, updated_at: nowDb() }, "id = ? AND status = 'pending'", [z.id]);
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.updated", subjectType: "zoom_booking", subjectId: z.id, before: snapshot(z), after: v });
  res.json({ data: json(after, u) });
});

zoomRoutes.post("/zoom-bookings/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  authorize(Number(z.user_id) === u.id);
  if (!isActive(z) || isOver(z)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.not_editable") });
  const now = nowDb();
  await update("zoom_bookings", { status: "cancelled", cancelled_by: u.id, cancelled_at: now, updated_at: now }, "id = ?", [z.id]);
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.cancelled", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status } });
  await resolveRequested(z);
  // รับงานแล้ว / ส่งลิงก์แล้ว → แจ้งผู้รับงาน
  if (z.assignee_id && Number(z.assignee_id) !== u.id) await notifyUsers([Number(z.assignee_id)], "zoom.cancelled", noticeData(u, z, "cancelled"));
  res.json({ data: json(after, u) });
});

/* ---------------------------------------------------------------- ฝ่าย IT */

/** ล็อกแถวแล้วตรวจสถานะซ้ำ (กัน 2 คนกดพร้อมกัน / ผู้จองยกเลิกพอดี) */
async function lockStatus(req: Request, z: ZoomRow, allowed: string[]) {
  const locked = await first<{ status: string }>("SELECT status FROM zoom_bookings WHERE id = ? FOR UPDATE", [z.id]);
  if (!locked || !allowed.includes(locked.status)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.status_changed") });
}

async function forHandler(req: Request, allowed: string[]): Promise<{ u: UserRow; z: ZoomRow }> {
  const u = me(req);
  authorize(manages(u));
  const z = await findZoom(req);
  if (!allowed.includes(z.status) || isOver(z)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.status_changed") });
  return { u, z };
}

/** รับงาน → ผู้รับงาน = ผู้กด + แจ้งผู้จอง */
zoomRoutes.post("/zoom-bookings/:uuid/accept", async (req, res) => {
  const { u, z } = await forHandler(req, ["pending"]);
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, ["pending"]);
    await update("zoom_bookings", { status: "accepted", assignee_id: u.id, accepted_at: now, updated_at: now }, "id = ?", [z.id]);
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.accepted", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status }, after: { status: "accepted", assignee_id: u.id } });
  await resolveRequested(after);
  await notifyOwner(u, after, "accepted");
  res.json({ data: json(after, u) });
});

/**
 * ส่งลิงก์ประชุม — ครั้งแรก (รับงานแล้ว) = confirmed + สร้างใบแจ้งงานที่ปิดแล้ว (ผู้รับงาน = ผู้ที่รับงาน → แถว KPI) + แจ้งผู้จอง
 * ส่งลิงก์แล้ว = แก้ลิงก์ / หมายเหตุ แจ้งผู้จองอีกครั้ง
 */
zoomRoutes.post("/zoom-bookings/:uuid/link", async (req, res) => {
  const { u, z } = await forHandler(req, ["accepted", "confirmed"]);
  const data = await validate(
    req.input,
    {
      meeting_link: ["required", "string", "max:1000", regex(LINK)],
      meeting_topic: ["nullable", "string", "max:255"],
      meeting_id: ["nullable", "string", "max:50"],
      passcode: ["nullable", "string", "max:50"],
      link_note: ["nullable", "string", "max:5000"],
    },
    { locale: req.locale, messages: { "meeting_link.regex": t(req, "eam.zoom.link_invalid") } },
  );
  const link = String(data.meeting_link).trim();
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const note = text(data.link_note);
  const firstLink = z.status === "accepted";
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, [z.status]);
    let ticketId: number | null = z.ticket_id ? Number(z.ticket_id) : null;
    if (firstLink && !ticketId) {
      const assignee = Number(z.assignee_id ?? u.id);
      const ticket = await createCompletedTicket(Number(z.user_id), {
        typeOther: ZOOM_TICKET_TYPE,
        details: [z.title, t(req, "eam.zoom.ticket_period", { period: periodText(z) }), z.details].filter(Boolean).join("\n"),
        assigneeId: assignee,
        requestedAt: z.created_at ?? now,
        acceptedAt: z.accepted_at ?? now,
        solution: t(req, "eam.zoom.ticket_solution", { link }),
        comment: t(req, "eam.zoom.ticket_comment"),
      });
      ticketId = ticket.id;
    }
    await update(
      "zoom_bookings",
      {
        meeting_link: link,
        link_note: note,
        meeting_topic: text(data.meeting_topic),
        meeting_id: text(data.meeting_id),
        passcode: text(data.passcode),
        ...(firstLink ? { status: "confirmed", confirmed_by: u.id, confirmed_at: now, ticket_id: ticketId, assignee_id: z.assignee_id ?? u.id } : {}),
        updated_at: now,
      },
      "id = ?",
      [z.id],
    );
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: firstLink ? "zoom_booking.confirmed" : "zoom_booking.link_updated", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status }, after: { status: after.status, ticket_id: after.ticket_id } });
  await notifyOwner(u, after, firstLink ? "confirmed" : "link_updated");
  res.json({ data: json(after, u) });
});

/** แจ้งกลับผู้จอง: ช่วงวันเวลานี้มีการใช้งาน ZOOM แล้ว (ไม่ระบุเหตุผล = ข้อความตั้งต้น) */
zoomRoutes.post("/zoom-bookings/:uuid/busy", async (req, res) => {
  const { u, z } = await forHandler(req, ["pending", "accepted"]);
  const data = await validate(req.input, { reason: ["nullable", "string", "max:1000"] }, { locale: req.locale });
  const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : t(req, "eam.zoom.busy_default");
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, ["pending", "accepted"]);
    await update("zoom_bookings", { status: "rejected", reject_reason: reason, rejected_by: u.id, rejected_at: now, updated_at: now }, "id = ?", [z.id]);
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.rejected", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status }, after: { status: "rejected", reason } });
  await resolveRequested(after);
  await notifyOwner(u, after, "rejected");
  res.json({ data: json(after, u) });
});

/** ตัวเลขเมนู /zoom/manage = คำขอรอรับงาน + งานที่ฉันรับแล้วยังไม่ส่งลิงก์ (ที่ยังไม่จบเวลา) */
export async function zoomBadges(u: UserRow): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (manages(u)) {
    out["/zoom/manage"] = Number(
      await scalar(`SELECT COUNT(*) FROM zoom_bookings z WHERE (z.status = 'pending' OR (z.status = 'accepted' AND z.assignee_id = ?)) AND ${UPCOMING}`, [u.id, ...upcomingParams()]),
    );
  }
  return out;
}
