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
import { createZoomTicket, zoomTicketAccepted, zoomTicketApprove, zoomTicketCancel, zoomTicketClosers, zoomTicketConfirm, zoomTicketDetails, zoomTicketLog, zoomTicketResulted, zoomTicketSolution } from "./tickets.js";

/**
 * จอง ZOOM — ทุกคนดูปฏิทินการใช้ ZOOM / จอง (หัวข้อ + ช่วงวันเวลา + รายละเอียด) / แก้ (ก่อน IT รับงาน) / ยกเลิกของตัวเอง
 *   GET /zoom-bookings?from=&to= (ปฏิทิน: ผู้ใช้ทั่วไป = ส่งลิงก์แล้ว / zoom.manage = รอรับงาน + รับงานแล้ว + ส่งลิงก์แล้ว ของทุกคน), GET /zoom-bookings/mine?status=upcoming|past|cancelled,
 *   GET /zoom-bookings/manage?status=pending|accepted|confirmed (zoom.manage), GET|PUT /zoom-bookings/:uuid, POST /zoom-bookings, POST .../cancel
 * ทุกการจองมีใบแจ้งงาน (เรื่องอื่นๆ, it_tickets.source = 'zoom') ตั้งแต่ตอนจอง — เดินสถานะจากหน้านี้เท่านั้น ผู้ใช้กับฝ่าย IT ไม่ต้องเปิดหน้าใบงาน:
 *   จอง = pending (ใบงาน approved) → แจ้งผู้มี zoom.manage → POST .../accept รับงาน = accepted (in_progress)
 *   POST .../link { zoom_account (บัญชี ZOOM จากข้อมูล Drop Down — บังคับครั้งแรก), meeting_link, meeting_topic, meeting_id, passcode, link_note } = confirmed + ผู้จองเห็นลิงก์ทันที (ใบงาน pending_it_head) + แจ้งผู้จัดการ IT — ส่งซ้ำ = แก้ลิงก์
 *   POST .../approve ผู้จัดการ IT (it_tickets.close) กดอนุมัติจากหน้าใบแจ้งงาน (action zoom_approve) = ประทับชื่อ + ลายเซ็นในโปรไฟล์ (pending_requester → ขึ้นชีต KPI ของผู้รับงาน)
 *   POST .../acknowledge ผู้จองกดรับ = ปิดงาน (completed) — ไม่กด = ปิดเองตาม ticket_auto_close_days
 *   POST .../busy { reason? } (รอรับงาน / รับงานแล้ว) = needs_change → ผู้จองแก้วันเวลา (PUT) = ส่งกลับผู้รับงานเดิม (accepted) หรือรอรับงาน (pending) — ใบงานใบเดิม
 *   ยกเลิก / เลยเวลาโดยยังไม่ส่งลิงก์ (expireZoomBookings) = ใบงานยกเลิก ไม่นับ KPI
 * จองพร้อมห้องประชุมได้ (meeting_booking_id — routes/meeting-rooms.ts): ยกเลิกห้อง = ยกเลิก ZOOM, เปลี่ยนเวลาห้อง = เวลา ZOOM เปลี่ยนตาม + แจ้งผู้รับงาน
 * ไม่ตรวจเวลาชนอัตโนมัติ (มีบัญชี ZOOM หลายบัญชีได้) — ฝ่าย IT ตรวจเองแล้วกดแจ้งกลับ; ลิงก์ประชุมเห็นเฉพาะผู้จอง + zoom.manage
 */
export const zoomRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d)$/;
const LINK = /^https?:\/\/\S+$/i;
const MAX_DAYS = 31;
/** เรื่องของใบแจ้งงานที่สร้างตอนจอง (เรื่องอื่นๆ) */
export const ZOOM_TICKET_TYPE = "จองใช้งาน ZOOM";
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);
const manages = (u: UserRow) => can(u, "zoom.manage");
const closes = (u: UserRow) => can(u, "it_tickets.close");

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
  status: "pending" | "accepted" | "needs_change" | "confirmed" | "rejected" | "cancelled";
  assignee_id: number | null;
  assignee_name: string | null;
  accepted_at: string | null;
  meeting_link: string | null;
  link_note: string | null;
  meeting_topic: string | null;
  meeting_id: string | null;
  passcode: string | null;
  zoom_account: string | null;
  confirmed_name: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
  rejected_name: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  ticket_id: number | null;
  ticket_uuid: string | null;
  ticket_no: string | null;
  ticket_status: string | null;
  head_name: string | null;
  head_at: string | null;
  head_signature: string | null;
  meeting_booking_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT = `SELECT z.*, u.name AS user_name, a.name AS assignee_name, c.name AS confirmed_name, r.name AS rejected_name, tk.uuid AS ticket_uuid, tk.ticket_no, tk.status AS ticket_status,
    tk.it_head_signature AS head_signature, h.name AS head_name, (SELECT MAX(e.created_at) FROM it_ticket_events e WHERE e.it_ticket_id = tk.id AND e.action = 'head_approved') AS head_at
  FROM zoom_bookings z LEFT JOIN users u ON u.id = z.user_id LEFT JOIN users a ON a.id = z.assignee_id
  LEFT JOIN users c ON c.id = z.confirmed_by LEFT JOIN users r ON r.id = z.rejected_by LEFT JOIN it_tickets tk ON tk.id = z.ticket_id LEFT JOIN users h ON h.id = tk.it_head_id`;

/** ยังมีผล (ขึ้นปฏิทิน): รอรับงาน / รับงานแล้ว / ส่งลิงก์แล้ว */
const ACTIVE = ["pending", "accepted", "confirmed"];
/** ยังไม่จบ: + รอผู้จองแก้วันเวลา (ไม่ขึ้นปฏิทิน เพราะเวลาเดิมใช้ไม่ได้) */
const OPEN = [...ACTIVE, "needs_change"];
const startAt = (z: { start_on: string; start_time: string }) => `${dateOnly(z.start_on)} ${z.start_time}`;
const endAt = (z: { end_on: string; end_time: string }) => `${dateOnly(z.end_on)} ${z.end_time}`;
const isOver = (z: { end_on: string; end_time: string }) => endAt(z) <= localNow();
/** ยังไม่จบ = เวลาสิ้นสุดยังไม่ถึง (เวลาไทย) */
const UPCOMING = "(z.end_on > ? OR (z.end_on = ? AND z.end_time > ?))";
const upcomingParams = () => {
  const now = localNow();
  return [now.slice(0, 10), now.slice(0, 10), now.slice(11)];
};
/** รอฉันจัดการ (ผู้จอง): แก้วันเวลาที่ IT แจ้งกลับ / กดรับหลังผู้จัดการ IT อนุมัติ — เงื่อนไขเดียวกับตัวเลขเมนู + แท็บ */
const TODO = `((z.status = 'needs_change' AND ${UPCOMING}) OR (z.status = 'confirmed' AND tk.status = 'pending_requester'))`;
const periodText = (z: Pick<ZoomRow, "start_on" | "start_time" | "end_on" | "end_time">) => (dateOnly(z.start_on) === dateOnly(z.end_on) ? `${dateOnly(z.start_on)} ${z.start_time}–${z.end_time}` : `${startAt(z)} – ${endAt(z)}`);

function json(z: ZoomRow, u: UserRow) {
  const mine = Number(z.user_id) === u.id;
  const manager = manages(u);
  const over = isOver(z);
  const sees = mine || manager || closes(u);
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
    // ลิงก์ประชุมเห็นเฉพาะผู้จอง + ฝ่าย IT ที่จัดการคำขอ ZOOM + ผู้จัดการ IT ที่อนุมัติผล
    meeting_link: sees ? z.meeting_link : null,
    link_note: sees ? z.link_note : null,
    meeting_topic: sees ? z.meeting_topic : null,
    meeting_id: sees ? z.meeting_id : null,
    passcode: sees ? z.passcode : null,
    // บัญชี ZOOM ที่ใช้ (ชื่อบัญชี ไม่ใช่รหัสผ่าน) — ปฏิทินแสดงสีตามบัญชีให้ทุกคน
    zoom_account: z.zoom_account,
    confirmed_by: z.confirmed_name,
    confirmed_at: iso(z.confirmed_at),
    reject_reason: z.reject_reason,
    rejected_by: z.rejected_name,
    rejected_at: iso(z.rejected_at),
    cancelled_at: iso(z.cancelled_at),
    ticket: z.ticket_uuid && sees ? { id: z.ticket_uuid, ticket_no: z.ticket_no ?? "", status: z.ticket_status ?? "" } : null,
    // ผู้จัดการ IT อนุมัติแล้ว = ชื่อ + ลายเซ็นที่ประทับลงใบงาน
    head_approval: z.head_name && sees ? { name: z.head_name, at: iso(z.head_at), signature_url: z.head_signature && z.ticket_uuid ? `/files/tickets/${z.ticket_uuid}/files/it-head-signature` : null } : null,
    from_meeting: z.meeting_booking_id !== null,
    created_at: iso(z.created_at),
    updated_at: iso(z.updated_at),
    // ผู้จอง: แก้ได้ก่อน IT รับงาน + เมื่อ IT ส่งกลับให้แก้วันเวลา / ยกเลิกได้จนกว่าจะจบเวลา / กดรับหลังผู้จัดการ IT อนุมัติ
    can_edit: mine && (z.status === "pending" || z.status === "needs_change") && !over,
    can_cancel: mine && OPEN.includes(z.status) && !over,
    can_acknowledge: mine && z.status === "confirmed" && z.ticket_status === "pending_requester",
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

type ZoomNoticeTarget = Pick<ZoomRow, "uuid" | "title" | "start_on" | "start_time" | "end_on" | "end_time">;
const noticeData = (u: { name: string }, z: ZoomNoticeTarget, event: string) => ({
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
async function notifyOwner(u: UserRow, z: ZoomRow, event: "accepted" | "confirmed" | "link_updated" | "needs_change" | "head_approved" | "cancelled") {
  if (Number(z.user_id) !== u.id) await notifyUsers([Number(z.user_id)], `zoom.${event}`, noticeData(u, z, event));
}
/** รับงาน / แจ้งกลับ / ยกเลิก → แจ้งเตือน "คำขอใหม่" ของฝ่าย IT หมดหน้าที่ */
const resolveRequested = (z: ZoomRow) => markNoticesRead("zoom_booking_id", z.uuid, { events: ["requested"] });
/** ส่งกลับ IT แล้ว → "แก้วันเวลา" ของผู้จองจบ / ยกเลิก → งานรอของทุกคนจบ */
const resolveNeedsChange = (z: ZoomRow) => markNoticesRead("zoom_booking_id", z.uuid, { events: ["needs_change"] });
const resolveAll = (z: ZoomRow) => markNoticesRead("zoom_booking_id", z.uuid, { events: ["requested", "needs_change", "head_requested", "head_approved"] });

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
  const f = await validate(req.input, { status: ["nullable", "in:upcoming,todo,past,cancelled"] }, { locale: req.locale });
  const status = (f.status as string) ?? "upcoming";
  const where = ["z.user_id = ?"];
  const params: unknown[] = [u.id];
  // ยกเลิก = ยกเลิกเอง + ฝ่าย IT แจ้งว่ามีการใช้งานแล้ว; ที่จะถึง / ผ่านมาแล้ว = ที่ยังมีผล
  if (status === "cancelled") where.push("z.status IN ('cancelled', 'rejected')");
  else if (status === "todo") (where.push(TODO), params.push(...upcomingParams()));
  else {
    where.push("z.status IN (?)", status === "upcoming" ? UPCOMING : `NOT ${UPCOMING}`);
    params.push(OPEN, ...upcomingParams());
  }
  const order = status === "upcoming" ? "z.start_on, z.start_time" : "z.start_on DESC, z.start_time DESC";
  const todo = await myTodoCount(u.id);
  res.json({ data: (await select<ZoomRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, params)).map((z) => json(z, u)), meta: { counts: { todo } } });
});

/** เรื่องที่รอผู้จองจัดการ (ตัวเลขเมนู /zoom/mine + แท็บ) */
const myTodoCount = async (userId: number) =>
  Number(await scalar(`SELECT COUNT(*) FROM zoom_bookings z LEFT JOIN it_tickets tk ON tk.id = z.ticket_id WHERE z.user_id = ? AND ${TODO}`, [userId, ...upcomingParams()]));

/** ฝ่าย IT: pending = รอรับงาน / accepted = รับงานแล้ว รอส่งลิงก์ / needs_change = รอผู้จองแก้วันเวลา / confirmed = ส่งลิงก์แล้ว (ยังไม่จบเวลา) */
zoomRoutes.get("/zoom-bookings/manage", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const f = await validate(req.input, { status: ["nullable", "in:pending,accepted,needs_change,confirmed"] }, { locale: req.locale });
  const status = (f.status as string) ?? "pending";
  const rows = await select<ZoomRow>(`${SELECT} WHERE z.status = ? AND ${UPCOMING} ORDER BY z.start_on, z.start_time LIMIT 500`, [status, ...upcomingParams()]);
  // ตัวเลขบนแท็บ = รายการค้างของแต่ละขั้น (ยังไม่จบเวลา)
  const counts = await select<{ status: string; n: number }>(`SELECT z.status, COUNT(*) AS n FROM zoom_bookings z WHERE z.status IN (?) AND ${UPCOMING} GROUP BY z.status`, [OPEN, ...upcomingParams()]);
  const count = (k: string) => Number(counts.find((c) => c.status === k)?.n ?? 0);
  res.json({ data: rows.map((z) => json(z, u)), meta: { counts: { pending: count("pending"), accepted: count("accepted"), needs_change: count("needs_change"), confirmed: count("confirmed") } } });
});

zoomRoutes.get("/zoom-bookings/:uuid", async (req, res) => {
  const z = await findZoom(req);
  // เปิดดูแล้ว = แจ้งเตือนของรายการนี้ของผู้ดูอ่านแล้ว
  await markNoticesRead("zoom_booking_id", z.uuid, { userId: me(req).id });
  res.json({ data: json(z, me(req)) });
});

/* ---------------------------------------------------------------- จอง / แก้ / ยกเลิก */

export async function bookingInput(req: Request, raw: Record<string, unknown> = req.input) {
  const data = await validate(
    raw,
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

type ZoomInput = Awaited<ReturnType<typeof bookingInput>>;
const ticketDetails = (req: Request, z: Pick<ZoomRow, "title" | "details" | "start_on" | "start_time" | "end_on" | "end_time">) =>
  [z.title, t(req, "eam.zoom.ticket_period", { period: periodText(z) }), z.details].filter(Boolean).join("\n");

/** สร้างการจอง + ใบแจ้งงาน (เจ้าของ = ownerId) แล้วแจ้งฝ่าย IT — ใช้ทั้งจอง ZOOM ตรงๆ และจองพร้อมห้องประชุม */
export async function createZoomBooking(req: Request, actor: UserRow, ownerId: number, v: ZoomInput, meetingBookingId: number | null = null): Promise<number> {
  const owner = ownerId === actor.id ? actor : await first<Pick<UserRow, "department" | "branch_id">>("SELECT department, branch_id FROM users WHERE id = ?", [ownerId]);
  const now = nowDb();
  const id = await transaction(async () => {
    const ticketId = await createZoomTicket(req, ownerId, { typeOther: ZOOM_TICKET_TYPE, details: ticketDetails(req, v), requestedAt: now });
    return insert("zoom_bookings", { uuid: randomUUID(), ...v, user_id: ownerId, department: owner?.department ?? null, branch_id: owner?.branch_id ?? null, status: "pending", ticket_id: ticketId, meeting_booking_id: meetingBookingId, created_at: now, updated_at: now });
  });
  const z = await reload(id);
  await audit(req, { action: "zoom_booking.created", subjectType: "zoom_booking", subjectId: id, after: v });
  await notifyHandlers(actor, z);
  return id;
}

zoomRoutes.post("/zoom-bookings", async (req, res) => {
  const u = me(req);
  const id = await createZoomBooking(req, u, u.id, await bookingInput(req));
  res.status(201).json({ data: json(await reload(id), u) });
});

const sameTime = (z: ZoomRow, v: Pick<ZoomInput, "start_on" | "start_time" | "end_on" | "end_time">) => startAt(z) === startAt(v) && endAt(z) === endAt(v);

/** รอแก้วันเวลา → บันทึกเวลาใหม่แล้วส่งกลับผู้รับงานเดิม (ยังไม่มีผู้รับ = รอรับงาน) + แจ้งฝ่าย IT */
async function resubmit(req: Request, actor: UserRow, z: ZoomRow, v: Partial<ZoomInput> & Pick<ZoomInput, "start_on" | "start_time" | "end_on" | "end_time">): Promise<ZoomRow> {
  const next = { ...z, ...v };
  await transaction(async () => {
    await update("zoom_bookings", { ...v, status: z.assignee_id ? "accepted" : "pending", reject_reason: null, rejected_by: null, rejected_at: null, updated_at: nowDb() }, "id = ? AND status = 'needs_change'", [z.id]);
    if (z.ticket_id) await zoomTicketDetails(Number(z.ticket_id), actor.id, ticketDetails(req, next), t(req, "eam.zoom.resubmit_log", { period: periodText(next) }));
  });
  const after = await reload(Number(z.id));
  await resolveNeedsChange(after);
  if (after.assignee_id) {
    if (Number(after.assignee_id) !== actor.id) await notifyUsers([Number(after.assignee_id)], "zoom.resubmitted", noticeData(actor, after, "resubmitted"));
  } else await notifyHandlers(actor, after);
  return after;
}

/** ผู้จองแก้ได้ก่อนฝ่าย IT รับงาน + เมื่อฝ่าย IT ส่งกลับให้แก้วันเวลา (ต้องเปลี่ยนวันหรือเวลา) */
zoomRoutes.put("/zoom-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  authorize(Number(z.user_id) === u.id);
  if ((z.status !== "pending" && z.status !== "needs_change") || isOver(z)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.not_editable") });
  const v = await bookingInput(req);
  let after: ZoomRow;
  if (z.status === "needs_change") {
    if (sameTime(z, v)) throw ValidationError.withMessages({ start_on: t(req, "eam.zoom.time_unchanged") });
    after = await resubmit(req, u, z, v);
  } else {
    await transaction(async () => {
      await update("zoom_bookings", { ...v, updated_at: nowDb() }, "id = ? AND status = 'pending'", [z.id]);
      if (z.ticket_id) await zoomTicketDetails(Number(z.ticket_id), u.id, ticketDetails(req, v), null);
    });
    after = await reload(Number(z.id));
  }
  await audit(req, { action: "zoom_booking.updated", subjectType: "zoom_booking", subjectId: z.id, before: snapshot(z), after: { ...v, status: after.status } });
  res.json({ data: json(after, u) });
});

/** ยกเลิกการจอง + ใบงาน (ไม่นับ KPI) — แจ้งผู้รับงาน (และเจ้าของ เมื่อยกเลิกตามห้องประชุมโดยคนอื่น) */
async function cancelBooking(req: Request, u: UserRow, z: ZoomRow): Promise<ZoomRow> {
  const now = nowDb();
  await transaction(async () => {
    await update("zoom_bookings", { status: "cancelled", cancelled_by: u.id, cancelled_at: now, updated_at: now }, "id = ?", [z.id]);
    if (z.ticket_id) await zoomTicketCancel(Number(z.ticket_id), u.id, null);
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.cancelled", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status } });
  await resolveAll(z);
  // รับงานแล้ว / ส่งลิงก์แล้ว → แจ้งผู้รับงาน
  if (z.assignee_id && Number(z.assignee_id) !== u.id) await notifyUsers([Number(z.assignee_id)], "zoom.cancelled", noticeData(u, z, "cancelled"));
  await notifyOwner(u, after, "cancelled");
  return after;
}

zoomRoutes.post("/zoom-bookings/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  authorize(Number(z.user_id) === u.id);
  if (!OPEN.includes(z.status) || isOver(z)) throw ValidationError.withMessages({ status: t(req, "eam.zoom.not_editable") });
  res.json({ data: json(await cancelBooking(req, u, z), u) });
});

/* ---------------------------------------------------------------- จองพร้อมห้องประชุม (routes/meeting-rooms.ts) */

/** การจอง ZOOM ที่ยังไม่จบของการจองห้องนี้ */
const linkedOpen = (meetingBookingId: number) => first<ZoomRow>(`${SELECT} WHERE z.meeting_booking_id = ? AND z.status IN (?) ORDER BY z.id DESC`, [meetingBookingId, OPEN]);

/**
 * ห้องประชุมเปลี่ยนเวลา → เวลา ZOOM ตามเฉพาะเมื่อเดิมตรงกับห้อง (ตั้งเวลา ZOOM แยกไว้ = ไม่ทับ)
 * รอแก้วันเวลา = ส่งกลับ IT, รับงานแล้ว / ส่งลิงก์แล้ว = แจ้งผู้รับงานให้ตรวจลิงก์
 */
export async function syncMeetingZoom(req: Request, actor: UserRow, meetingBookingId: number, v: Pick<ZoomInput, "start_on" | "start_time" | "end_on" | "end_time">, before: Pick<ZoomInput, "start_on" | "start_time" | "end_on" | "end_time">) {
  const z = await linkedOpen(meetingBookingId);
  if (!z || sameTime(z, v) || !sameTime(z, before)) return;
  if (z.status === "needs_change") await resubmit(req, actor, z, v);
  else {
    const next = { ...z, ...v };
    await transaction(async () => {
      await update("zoom_bookings", { ...v, updated_at: nowDb() }, "id = ?", [z.id]);
      if (z.ticket_id) await zoomTicketDetails(Number(z.ticket_id), actor.id, ticketDetails(req, next), t(req, "eam.zoom.time_log", { period: periodText(next) }));
    });
    if (z.assignee_id && Number(z.assignee_id) !== actor.id) await notifyUsers([Number(z.assignee_id)], "zoom.time_changed", noticeData(actor, await reload(Number(z.id)), "time_changed"));
  }
  await audit(req, { action: "zoom_booking.updated", subjectType: "zoom_booking", subjectId: z.id, before: snapshot(z), after: v });
}

/** ยกเลิก / ลบการจองห้อง → ZOOM ที่จองพร้อมกันถูกยกเลิกตาม */
export async function cancelMeetingZoom(req: Request, actor: UserRow, meetingBookingId: number) {
  const z = await linkedOpen(meetingBookingId);
  if (z) await cancelBooking(req, actor, z);
}

/**
 * scheduler: การจองที่เลยเวลาสิ้นสุดโดยยังไม่ได้ส่งลิงก์ (รอรับงาน / รับงานแล้ว / รอแก้วันเวลา) → ยกเลิก + ใบงานยกเลิก (ไม่นับ KPI) + แจ้งผู้จอง — คืนจำนวนรายการ
 */
export async function expireZoomBookings(): Promise<number> {
  const rows = await select<ZoomRow>(`${SELECT} WHERE z.status IN ('pending', 'accepted', 'needs_change') AND NOT ${UPCOMING}`, upcomingParams());
  for (const z of rows) {
    const now = nowDb();
    await transaction(async () => {
      await update("zoom_bookings", { status: "cancelled", cancelled_at: now, updated_at: now }, "id = ?", [z.id]);
      if (z.ticket_id) await zoomTicketCancel(Number(z.ticket_id), null, trans("th", "eam.zoom.expired_log"));
    });
    await resolveAll(z);
    await notifyUsers([Number(z.user_id)], "zoom.expired", noticeData({ name: "" }, z, "expired"));
  }
  return rows.length;
}

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

/** การจองเดิมก่อนมีการผูกใบงานตอนจอง (ยังไม่มีใบ) → สร้างใบตอนนี้ — เรียกใน transaction */
async function ensureTicket(req: Request, z: ZoomRow): Promise<number> {
  if (z.ticket_id) return Number(z.ticket_id);
  const id = await createZoomTicket(req, Number(z.user_id), { typeOther: ZOOM_TICKET_TYPE, details: ticketDetails(req, z), requestedAt: z.created_at ?? nowDb() });
  await update("zoom_bookings", { ticket_id: id }, "id = ?", [z.id]);
  if (z.assignee_id && z.accepted_at) await zoomTicketAccepted(id, Number(z.assignee_id), z.accepted_at);
  return id;
}

/** รับงาน → ผู้รับงาน = ผู้กด + แจ้งผู้จอง */
zoomRoutes.post("/zoom-bookings/:uuid/accept", async (req, res) => {
  const { u, z } = await forHandler(req, ["pending"]);
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, ["pending"]);
    await update("zoom_bookings", { status: "accepted", assignee_id: u.id, accepted_at: now, updated_at: now }, "id = ?", [z.id]);
    await zoomTicketAccepted(await ensureTicket(req, z), u.id, now);
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.accepted", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status }, after: { status: "accepted", assignee_id: u.id } });
  await resolveRequested(after);
  await notifyOwner(u, after, "accepted");
  res.json({ data: json(after, u) });
});

/**
 * ส่งลิงก์ประชุม — ครั้งแรก (รับงานแล้ว) = confirmed + ผู้จองเห็นลิงก์ทันที + ใบงานบันทึกผล รอผู้จัดการ IT อนุมัติ
 * ส่งลิงก์แล้ว = แก้ลิงก์ / หมายเหตุ แจ้งผู้จองอีกครั้ง
 */
zoomRoutes.post("/zoom-bookings/:uuid/link", async (req, res) => {
  const { u, z } = await forHandler(req, ["accepted", "confirmed"]);
  const data = await validate(
    req.input,
    {
      zoom_account: ["nullable", "string", "max:100"],
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
  // บัญชี ZOOM: บังคับเลือกครั้งแรก (แก้ลิงก์ไม่ส่ง = คงเดิม) — ต้องเป็นตัวเลือกที่เปิดใช้งาน หรือค่าเดิมของรายการนี้
  const account = text(data.zoom_account) ?? z.zoom_account;
  if (!account) throw ValidationError.withMessages({ zoom_account: t(req, "eam.zoom.account_required") });
  const accountOption = await first<{ name: string }>("SELECT name FROM dropdown_options WHERE list = 'zoom_account' AND is_active = true AND LOWER(name) = LOWER(?)", [account]);
  if (!accountOption && account.toLowerCase() !== (z.zoom_account ?? "").toLowerCase()) throw ValidationError.withMessages({ zoom_account: t(req, "eam.zoom.account_invalid") });
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, [z.status]);
    const ticketId = await ensureTicket(req, z);
    if (firstLink) await zoomTicketResulted(req, ticketId, Number(z.assignee_id ?? u.id), t(req, "eam.zoom.ticket_solution", { link }), t(req, "eam.zoom.ticket_comment"));
    else await zoomTicketSolution(ticketId, t(req, "eam.zoom.ticket_solution", { link }));
    await update(
      "zoom_bookings",
      {
        meeting_link: link,
        link_note: note,
        meeting_topic: text(data.meeting_topic),
        meeting_id: text(data.meeting_id),
        passcode: text(data.passcode),
        zoom_account: accountOption?.name ?? account,
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
  if (firstLink && after.ticket_id) {
    const heads = (await zoomTicketClosers(Number(after.ticket_id))).map((p) => Number(p.id)).filter((id) => id !== u.id);
    // เปิดที่หน้าใบแจ้งงาน (open_ticket ไม่ใช่รหัสเรื่องของแจ้งเตือน — เรื่อง = zoom_booking_id)
    if (heads.length) await notifyUsers(heads, "zoom.head_requested", { ...noticeData(u, after, "head_requested"), open_ticket: after.ticket_uuid });
  }
  res.json({ data: json(after, u) });
});

/** แจ้งกลับผู้จอง: ช่วงวันเวลานี้มีการใช้งาน ZOOM แล้ว (ไม่ระบุเหตุผล = ข้อความตั้งต้น) → รอผู้จองแก้วันเวลา ใบงานยังเปิดอยู่ */
zoomRoutes.post("/zoom-bookings/:uuid/busy", async (req, res) => {
  const { u, z } = await forHandler(req, ["pending", "accepted"]);
  const data = await validate(req.input, { reason: ["nullable", "string", "max:1000"] }, { locale: req.locale });
  const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : t(req, "eam.zoom.busy_default");
  const now = nowDb();
  await transaction(async () => {
    await lockStatus(req, z, ["pending", "accepted"]);
    await update("zoom_bookings", { status: "needs_change", reject_reason: reason, rejected_by: u.id, rejected_at: now, updated_at: now }, "id = ?", [z.id]);
    if (z.ticket_id) await zoomTicketLog(Number(z.ticket_id), u.id, t(req, "eam.zoom.busy_log", { reason }));
  });
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.needs_change", subjectType: "zoom_booking", subjectId: z.id, before: { status: z.status }, after: { status: "needs_change", reason } });
  await resolveRequested(after);
  await notifyOwner(u, after, "needs_change");
  res.json({ data: json(after, u) });
});

/** ผู้จัดการ IT กดอนุมัติที่หน้าใบแจ้งงาน = ประทับชื่อ + ลายเซ็นในโปรไฟล์ลงใบงาน (ไม่มีฟอร์ม) → ขึ้น KPI ของผู้รับงาน + รอผู้จองกดรับ */
zoomRoutes.post("/zoom-bookings/:uuid/approve", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  if (z.status !== "confirmed" || z.ticket_status !== "pending_it_head" || !z.ticket_id) throw ValidationError.withMessages({ status: t(req, "eam.zoom.status_changed") });
  await zoomTicketApprove(req, Number(z.ticket_id), u);
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.head_approved", subjectType: "zoom_booking", subjectId: z.id, after: { ticket_id: Number(z.ticket_id) } });
  await markNoticesRead("zoom_booking_id", z.uuid, { events: ["head_requested"] });
  await notifyOwner(u, after, "head_approved");
  res.json({ data: json(after, u) });
});

/** ผู้จองกดรับ = ปิดใบงาน */
zoomRoutes.post("/zoom-bookings/:uuid/acknowledge", async (req, res) => {
  const u = me(req);
  const z = await findZoom(req);
  authorize(Number(z.user_id) === u.id);
  if (z.status !== "confirmed" || z.ticket_status !== "pending_requester" || !z.ticket_id) throw ValidationError.withMessages({ status: t(req, "eam.zoom.status_changed") });
  await zoomTicketConfirm(Number(z.ticket_id), u.id);
  const after = await reload(Number(z.id));
  await audit(req, { action: "zoom_booking.acknowledged", subjectType: "zoom_booking", subjectId: z.id, after: { ticket_id: Number(z.ticket_id) } });
  await markNoticesRead("zoom_booking_id", z.uuid, { events: ["head_approved"] });
  res.json({ data: json(after, u) });
});

/**
 * ตัวเลขเมนู /zoom/manage = คำขอรอรับงาน + งานที่ฉันรับแล้วยังไม่ส่งลิงก์ (ยังไม่จบเวลา) — รออนุมัติอยู่ที่ตัวเลข /it/queue
 * /zoom/mine = รอฉันแก้วันเวลา + รอฉันกดรับ
 */
export async function zoomBadges(u: UserRow): Promise<Record<string, number>> {
  const out: Record<string, number> = { "/zoom/mine": await myTodoCount(u.id) };
  if (manages(u)) {
    out["/zoom/manage"] = Number(await scalar(`SELECT COUNT(*) FROM zoom_bookings z WHERE (z.status = 'pending' OR (z.status = 'accepted' AND z.assignee_id = ?)) AND ${UPCOMING}`, [u.id, ...upcomingParams()]));
  }
  return out;
}
