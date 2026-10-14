import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, insert, isUuid, lockNamed, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, custom, int, regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audit } from "../services/audit.js";
import { notifyUsers } from "../services/notifications.js";
import { MAX_PHOTOS, processPhoto } from "../services/photos.js";
import { deleteStored, randomString, readStored, writeStored } from "../services/ticket-files.js";

/**
 * ระบบจองห้องประชุม — ทุกคนดูปฏิทินห้อง / จอง / แก้-ยกเลิก-ลบการจองของตัวเอง
 *   ห้อง (meeting.rooms): GET /meeting-rooms (?include_inactive=1), GET|PUT|DELETE /meeting-rooms/:id, POST /meeting-rooms
 *     รูป ≤ 4 รูป/ห้อง ≤ 1MB/รูป: POST /meeting-rooms/:id/images (multipart images[]), PUT .../images/:imageId (ตั้งเป็นรูปหลัก), DELETE .../images/:imageId
 *     GET /meeting-rooms/:id/images/:imageId — ทุกคนที่ login
 *   การจอง: GET /meeting-bookings?from=&to=&room_id= (ที่ยืนยันแล้ว), GET /meeting-bookings/mine?status=upcoming|past|cancelled,
 *     GET|PUT|DELETE /meeting-bookings/:uuid, POST /meeting-bookings, POST /meeting-bookings/:uuid/cancel
 *     ห้อง + ช่วงเวลาซ้อนกัน = 422 (ตรวจใน transaction + lock ต่อห้อง/วัน) — ชนกันพอดีขอบเวลา (09:00–10:00 กับ 10:00–11:00) ได้
 *     แก้/ยกเลิก/ลบของผู้อื่น = meeting.manage_any (แจ้งเตือนเจ้าของการจอง)
 * ประเภทการใช้งาน / อุปกรณ์ = dropdown_options (meeting_purpose / meeting_equipment) — routes/dropdown-options.ts
 */
export const meetingRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_IMAGES = MAX_PHOTOS;
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);
const managesRooms = (u: UserRow) => can(u, "meeting.rooms");
const managesAny = (u: UserRow) => can(u, "meeting.manage_any");
const idParam = (v: unknown) => (/^\d+$/.test(String(v)) ? Number(v) : 0);

/** เวลาปัจจุบัน "HH:MM" ตามเขตเวลาของผู้ใช้ */
const localNowHm = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: config.localTimezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
/** การจองจบไปแล้ว (วันก่อนหน้า หรือวันนี้ที่เลยเวลาสิ้นสุด) */
const isOver = (date: string, end: string) => {
  const today = localToday();
  return date < today || (date === today && end <= localNowHm());
};

/* ---------------------------------------------------------------- ห้องประชุม */

interface Seat {
  label: string;
  count: number;
}

interface RoomRow {
  id: number;
  name: string;
  branch_id: number | null;
  branch_name: string | null;
  location: string | null;
  room_no: string | null;
  description: string | null;
  seats: unknown;
  is_active: boolean | number;
  sort_order: number;
  bookings_count?: number | string;
}

interface ImageRow {
  id: number;
  room_id: number;
  path: string;
  size: number | null;
  is_primary: boolean | number;
  sort_order: number;
}

const ROOM_SELECT = "SELECT r.*, b.name AS branch_name FROM meeting_rooms r LEFT JOIN branches b ON b.id = r.branch_id";

const seatsOf = (raw: unknown): Seat[] => {
  const v = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(v) ? v.map((s: Seat) => ({ label: String(s.label ?? ""), count: Number(s.count) || 0 })) : [];
};

async function roomJson(r: RoomRow, images?: ImageRow[]) {
  const imgs = images ?? (await select<ImageRow>("SELECT * FROM meeting_room_images WHERE room_id = ? ORDER BY sort_order, id", [r.id]));
  const seats = seatsOf(r.seats);
  return {
    id: Number(r.id),
    name: r.name,
    branch: r.branch_id ? { id: Number(r.branch_id), name: r.branch_name ?? "" } : null,
    location: r.location,
    room_no: r.room_no,
    description: r.description,
    seats,
    capacity: seats.reduce((n, s) => n + s.count, 0),
    is_active: Boolean(r.is_active),
    sort_order: Number(r.sort_order),
    images: imgs.map((i) => ({ id: Number(i.id), is_primary: Boolean(i.is_primary) })),
    ...(r.bookings_count !== undefined ? { bookings_count: Number(r.bookings_count) } : {}),
  };
}

async function findRoom(id: number): Promise<RoomRow> {
  const r = id ? await first<RoomRow>(`${ROOM_SELECT} WHERE r.id = ?`, [id]) : null;
  if (!r) throw notFound();
  return r;
}

meetingRoutes.get("/meeting-rooms", async (req, res) => {
  const all = bool(req.query.include_inactive);
  if (all) authorize(managesRooms(me(req)));
  const rows = await select<RoomRow>(
    `SELECT r.*, b.name AS branch_name, (SELECT COUNT(*) FROM meeting_bookings x WHERE x.room_id = r.id AND x.deleted_at IS NULL) AS bookings_count
       FROM meeting_rooms r LEFT JOIN branches b ON b.id = r.branch_id ${all ? "" : "WHERE r.is_active = true"} ORDER BY r.sort_order, r.name`,
  );
  const images = rows.length ? await select<ImageRow>("SELECT * FROM meeting_room_images WHERE room_id IN (?) ORDER BY sort_order, id", [rows.map((r) => r.id)]) : [];
  res.json({ data: await Promise.all(rows.map((r) => roomJson(r, images.filter((i) => Number(i.room_id) === Number(r.id))))) });
});

meetingRoutes.get("/meeting-rooms/:id", async (req, res) => {
  res.json({ data: await roomJson(await findRoom(idParam(req.params.id))) });
});

async function roomInput(req: Request, current: RoomRow | null) {
  const data = await validate(
    req.input,
    {
      name: [
        "required",
        "string",
        "max:100",
        custom(async (v) => (await scalar(`SELECT 1 FROM meeting_rooms WHERE LOWER(name) = LOWER(?)${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()])) === null, t(req, "eam.meeting.room_duplicate")),
      ],
      branch_id: ["nullable", "integer", custom(async (v) => (await scalar("SELECT 1 FROM branches WHERE id = ?", [Number(v)])) !== null, t(req, "eam.meeting.branch_invalid"))],
      location: ["nullable", "string", "max:255"],
      room_no: ["nullable", "string", "max:50"],
      description: ["nullable", "string", "max:2000"],
      seats: ["required", "array", "max:10"],
      is_active: ["sometimes", "boolean"],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
    },
    { locale: req.locale },
  );
  // แถวที่นั่ง: ชื่อแถว (เช่น ที่นั่งหลัก / ที่นั่งสำรอง) + จำนวน ≥ 1 — แถวแรกต้องมี
  const rows = Object.values(data.seats as Record<string, unknown>);
  const seats: Seat[] = [];
  for (const s of rows) {
    const o = (s ?? {}) as Record<string, unknown>;
    const label = String(o.label ?? "").trim();
    const count = Number(o.count);
    if (!label || label.length > 50 || !Number.isInteger(count) || count < 1 || count > 9999) throw ValidationError.withMessages({ seats: t(req, "eam.meeting.seats_invalid") });
    seats.push({ label, count });
  }
  if (!seats.length) throw ValidationError.withMessages({ seats: t(req, "eam.meeting.seats_invalid") });
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name: String(data.name).trim(),
    branch_id: int(data.branch_id),
    location: text(data.location),
    room_no: text(data.room_no),
    description: text(data.description),
    seats: JSON.stringify(seats),
    ...("is_active" in data ? { is_active: bool(data.is_active) } : {}),
    ...("sort_order" in data ? { sort_order: data.sort_order } : {}),
  };
}

meetingRoutes.post("/meeting-rooms", async (req, res) => {
  authorize(managesRooms(me(req)));
  const v = await roomInput(req, null);
  const now = nowDb();
  const id = await insert("meeting_rooms", { ...v, created_at: now, updated_at: now });
  const row = await findRoom(id);
  const json = await roomJson(row);
  await audit(req, { action: "meeting_room.created", subjectType: "meeting_room", subjectId: id, after: { ...json, images: undefined } });
  res.status(201).json({ data: json });
});

meetingRoutes.put("/meeting-rooms/:id", async (req, res) => {
  authorize(managesRooms(me(req)));
  const current = await findRoom(idParam(req.params.id));
  const v = await roomInput(req, current);
  await update("meeting_rooms", { ...v, updated_at: nowDb() }, "id = ?", [current.id]);
  const before = await roomJson(current);
  const after = await roomJson(await findRoom(current.id));
  await audit(req, { action: "meeting_room.updated", subjectType: "meeting_room", subjectId: current.id, before: { ...before, images: undefined }, after: { ...after, images: undefined } });
  res.json({ data: after });
});

/** ลบได้เมื่อไม่เคยมีการจอง — มีประวัติแล้วให้ปิดใช้งานแทน */
meetingRoutes.delete("/meeting-rooms/:id", async (req, res) => {
  authorize(managesRooms(me(req)));
  const current = await findRoom(idParam(req.params.id));
  const used = Number(await scalar("SELECT COUNT(*) FROM meeting_bookings WHERE room_id = ?", [current.id]));
  if (used > 0) throw ValidationError.withMessages({ name: t(req, "eam.meeting.room_in_use", { count: used }) });
  const images = await select<ImageRow>("SELECT * FROM meeting_room_images WHERE room_id = ?", [current.id]);
  await exec("DELETE FROM meeting_rooms WHERE id = ?", [current.id]);
  for (const i of images) await deleteStored(i.path);
  await audit(req, { action: "meeting_room.deleted", subjectType: "meeting_room", subjectId: current.id, before: { ...(await roomJson(current, [])), images: undefined } });
  res.status(204).end();
});

/* ---------------------------------------------------------------- รูปห้อง */

meetingRoutes.post("/meeting-rooms/:id/images", async (req, res) => {
  authorize(managesRooms(me(req)));
  const room = await findRoom(idParam(req.params.id));
  const data = await validate(
    req.input,
    { images: ["required", "array", `max:${MAX_IMAGES}`], "images.*": ["file", "image", "mimes:jpg,jpeg,png,webp", "max:1024"] },
    { locale: req.locale },
  );
  const files = Object.values(data.images as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const existing = await select<ImageRow>("SELECT * FROM meeting_room_images WHERE room_id = ? ORDER BY sort_order, id", [room.id]);
  if (existing.length + files.length > MAX_IMAGES) throw ValidationError.withMessages({ images: t(req, "eam.meeting.images_max", { max: MAX_IMAGES, left: MAX_IMAGES - existing.length }) });

  const processed: Buffer[] = [];
  for (const f of files) {
    try {
      processed.push(await processPhoto(f));
    } catch {
      throw ValidationError.withMessages({ images: t(req, "eam.meeting.image_invalid", { name: [...f.originalName].slice(0, 80).join("") }) });
    }
  }
  const now = nowDb();
  const ids: number[] = [];
  let order = existing.reduce((n, i) => Math.max(n, Number(i.sort_order)), 0);
  for (const [n, buf] of processed.entries()) {
    const path = `meeting-rooms/${room.id}/${randomString(32)}.webp`;
    await writeStored(path, buf);
    // ห้องที่ยังไม่มีรูปหลัก — รูปแรกที่อัปโหลดเป็นรูปหลัก
    const primary = n === 0 && !existing.some((i) => Boolean(i.is_primary));
    ids.push(await insert("meeting_room_images", { room_id: room.id, path, size: buf.length, is_primary: primary, sort_order: ++order, created_at: now }));
  }
  await audit(req, { action: "meeting_room.images_added", subjectType: "meeting_room", subjectId: room.id, after: { image_ids: ids } });
  res.status(201).json({ data: await roomJson(await findRoom(room.id)) });
});

async function findImage(req: Request) {
  const room = await findRoom(idParam(req.params.id));
  const img = await first<ImageRow>("SELECT * FROM meeting_room_images WHERE id = ? AND room_id = ?", [idParam(req.params.imageId), room.id]);
  if (!img) throw notFound();
  return { room, img };
}

meetingRoutes.get("/meeting-rooms/:id/images/:imageId", async (req, res) => {
  const { img } = await findImage(req);
  const file = await readStored(img.path);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.data);
});

/** ตั้งเป็นรูปหลัก */
meetingRoutes.put("/meeting-rooms/:id/images/:imageId", async (req, res) => {
  authorize(managesRooms(me(req)));
  const { room, img } = await findImage(req);
  await transaction(async () => {
    await exec("UPDATE meeting_room_images SET is_primary = false WHERE room_id = ?", [room.id]);
    await exec("UPDATE meeting_room_images SET is_primary = true WHERE id = ?", [img.id]);
  });
  await audit(req, { action: "meeting_room.primary_image", subjectType: "meeting_room", subjectId: room.id, after: { image_id: Number(img.id) } });
  res.json({ data: await roomJson(await findRoom(room.id)) });
});

meetingRoutes.delete("/meeting-rooms/:id/images/:imageId", async (req, res) => {
  authorize(managesRooms(me(req)));
  const { room, img } = await findImage(req);
  await exec("DELETE FROM meeting_room_images WHERE id = ?", [img.id]);
  // ลบรูปหลัก — รูปถัดไปเป็นรูปหลักแทน
  if (img.is_primary) await exec("UPDATE meeting_room_images SET is_primary = true WHERE room_id = ? ORDER BY sort_order, id LIMIT 1", [room.id]);
  await deleteStored(img.path);
  await audit(req, { action: "meeting_room.image_removed", subjectType: "meeting_room", subjectId: room.id, before: { image_id: Number(img.id) } });
  res.json({ data: await roomJson(await findRoom(room.id)) });
});

/* ---------------------------------------------------------------- การจอง */

interface BookingRow {
  id: number;
  uuid: string;
  room_id: number;
  room_name: string;
  user_id: number;
  user_name: string | null;
  department: string | null;
  title: string;
  attendees: number;
  purpose: string | null;
  note: string | null;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const BOOKING_SELECT = `SELECT m.*, r.name AS room_name, u.name AS user_name
  FROM meeting_bookings m JOIN meeting_rooms r ON r.id = m.room_id LEFT JOIN users u ON u.id = m.user_id`;

async function bookingsJson(rows: BookingRow[], u: UserRow) {
  const equipment = rows.length
    ? await select<{ booking_id: number; name: string }>("SELECT booking_id, name FROM meeting_booking_equipment WHERE booking_id IN (?) ORDER BY name", [rows.map((r) => r.id)])
    : [];
  return rows.map((r) => {
    const date = dateOnly(r.booking_date)!;
    const mine = Number(r.user_id) === u.id;
    const over = isOver(date, r.end_time);
    const active = r.status === "confirmed";
    const allowed = mine || managesAny(u);
    return {
      id: r.uuid,
      room: { id: Number(r.room_id), name: r.room_name },
      user: { id: Number(r.user_id), name: r.user_name ?? "" },
      department: r.department,
      title: r.title,
      attendees: Number(r.attendees),
      purpose: r.purpose,
      equipment: equipment.filter((e) => Number(e.booking_id) === Number(r.id)).map((e) => e.name),
      note: r.note,
      date,
      start_time: r.start_time,
      end_time: r.end_time,
      status: r.status as "confirmed" | "cancelled",
      is_over: over,
      cancelled_at: iso(r.cancelled_at),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      can_edit: allowed && active && !over,
      can_cancel: allowed && active && !over,
      // การจองที่ใช้ไปแล้วเก็บเป็นประวัติ — ลบได้เฉพาะที่ยกเลิกแล้ว / ยังไม่ถึงเวลา
      can_delete: allowed && (!active || !over),
    };
  });
}

async function findBooking(req: Request): Promise<BookingRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await first<BookingRow>(`${BOOKING_SELECT} WHERE m.uuid = ? AND m.deleted_at IS NULL`, [uuid]) : null;
  if (!row) throw notFound();
  return row;
}

meetingRoutes.get("/meeting-bookings", async (req, res) => {
  const f = await validate(req.input, { from: ["required", regex(DATE)], to: ["required", regex(DATE)], room_id: ["nullable", "integer"] }, { locale: req.locale });
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  const where = ["m.deleted_at IS NULL", "m.status = 'confirmed'", "m.booking_date BETWEEN ? AND ?"];
  const params: unknown[] = [from, to];
  if (int(f.room_id)) (where.push("m.room_id = ?"), params.push(int(f.room_id)));
  const rows = await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.booking_date, m.start_time, r.sort_order, r.name`, params);
  res.json({ data: await bookingsJson(rows, me(req)) });
});

/** การจองของฉัน: upcoming = ยังไม่จบ (ยืนยันแล้ว), past = จบแล้ว, cancelled = ยกเลิกแล้ว */
meetingRoutes.get("/meeting-bookings/mine", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { status: ["nullable", "in:upcoming,past,cancelled"] }, { locale: req.locale });
  const status = (f.status as string) ?? "upcoming";
  const today = localToday();
  const now = localNowHm();
  const where = ["m.user_id = ?", "m.deleted_at IS NULL"];
  const params: unknown[] = [u.id];
  if (status === "cancelled") where.push("m.status = 'cancelled'");
  else {
    where.push("m.status = 'confirmed'");
    const upcoming = "(m.booking_date > ? OR (m.booking_date = ? AND m.end_time > ?))";
    where.push(status === "upcoming" ? upcoming : `NOT ${upcoming}`);
    params.push(today, today, now);
  }
  const order = status === "upcoming" ? "m.booking_date, m.start_time" : "m.booking_date DESC, m.start_time DESC";
  const rows = await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, params);
  res.json({ data: await bookingsJson(rows, u) });
});

meetingRoutes.get("/meeting-bookings/:uuid", async (req, res) => {
  const [json] = await bookingsJson([await findBooking(req)], me(req));
  res.json({ data: json });
});

const activeOptions = async (list: string) =>
  (await select<{ name: string }>("SELECT name FROM dropdown_options WHERE list = ? AND is_active = true", [list])).map((o) => o.name);

async function bookingInput(req: Request, current: BookingRow | null, currentEquipment: string[]) {
  const data = await validate(
    req.input,
    {
      room_id: ["required", "integer"],
      title: ["required", "string", "max:255", regex(/\S/)],
      attendees: ["required", "integer", "min:1", "max:9999"],
      purpose: ["required", "string", "max:100"],
      equipment: ["nullable", "array", "max:30"],
      "equipment.*": ["string", "max:100"],
      note: ["nullable", "string", "max:2000"],
      date: ["required", regex(DATE)],
      start_time: ["required", regex(TIME)],
      end_time: ["required", regex(TIME)],
    },
    { locale: req.locale },
  );
  const errors: Record<string, string> = {};
  const roomId = int(data.room_id)!;
  const room = await first<{ id: number; is_active: boolean | number }>("SELECT id, is_active FROM meeting_rooms WHERE id = ?", [roomId]);
  // ห้องที่ปิดใช้งาน: จองใหม่ไม่ได้ (การจองเดิมของห้องนั้นแก้รายละเอียดอื่นได้)
  if (!room || (!room.is_active && Number(current?.room_id) !== roomId)) errors.room_id = t(req, "eam.meeting.room_invalid");
  const date = String(data.date);
  const start = String(data.start_time);
  const end = String(data.end_time);
  if (end <= start) errors.end_time = t(req, "eam.meeting.time_order");
  else if (isOver(date, end)) errors.date = t(req, "eam.meeting.past");

  // ประเภท / อุปกรณ์ ต้องเป็นตัวเลือกที่เปิดใช้งาน (ค่าเดิมของการจองนี้คงไว้ได้แม้ถูกปิดใช้งานภายหลัง)
  const purpose = String(data.purpose).trim();
  const purposes = await activeOptions("meeting_purpose");
  if (!purposes.some((p) => p.toLowerCase() === purpose.toLowerCase()) && purpose.toLowerCase() !== (current?.purpose ?? "").toLowerCase()) errors.purpose = t(req, "eam.meeting.option_invalid");
  const equipment = [...new Set(Object.values((data.equipment as Record<string, unknown>) ?? {}).map((e) => String(e).trim()).filter(Boolean))];
  const allowedEquipment = [...(await activeOptions("meeting_equipment")), ...currentEquipment].map((e) => e.toLowerCase());
  if (equipment.some((e) => !allowedEquipment.includes(e.toLowerCase()))) errors.equipment = t(req, "eam.meeting.option_invalid");
  if (Object.keys(errors).length) throw ValidationError.withMessages(errors);
  return {
    room_id: roomId,
    title: String(data.title).trim(),
    attendees: int(data.attendees)!,
    purpose,
    note: typeof data.note === "string" && data.note.trim() ? data.note.trim() : null,
    booking_date: date,
    start_time: start,
    end_time: end,
    equipment,
  };
}

/** ห้องเดียวกัน วันเดียวกัน ช่วงเวลาซ้อนกัน (ไม่นับที่ยกเลิก/ลบ และตัวเอง) — เรียกใน transaction หลัง lock */
async function assertFree(req: Request, v: { room_id: number; booking_date: string; start_time: string; end_time: string }, exceptId: number | null) {
  const clash = await first<{ title: string; start_time: string; end_time: string; user_name: string | null }>(
    `SELECT m.title, m.start_time, m.end_time, u.name AS user_name FROM meeting_bookings m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.booking_date = ? AND m.status = 'confirmed' AND m.deleted_at IS NULL
        AND m.start_time < ? AND m.end_time > ?${exceptId ? " AND m.id <> ?" : ""}
      ORDER BY m.start_time LIMIT 1`,
    exceptId ? [v.room_id, v.booking_date, v.end_time, v.start_time, exceptId] : [v.room_id, v.booking_date, v.end_time, v.start_time],
  );
  if (clash) {
    throw ValidationError.withMessages({
      start_time: t(req, "eam.meeting.overlap", { start: clash.start_time, end: clash.end_time, title: clash.title, name: clash.user_name ?? "-" }),
    });
  }
}

const lockKey = (roomId: number, date: string) => `meeting_room:${roomId}:${date}`;

async function saveEquipment(bookingId: number, names: string[]) {
  await exec("DELETE FROM meeting_booking_equipment WHERE booking_id = ?", [bookingId]);
  for (const name of names) await insert("meeting_booking_equipment", { booking_id: bookingId, name });
}

const auditView = (v: Awaited<ReturnType<typeof bookingInput>>) => ({ ...v });

meetingRoutes.post("/meeting-bookings", async (req, res) => {
  const u = me(req);
  const v = await bookingInput(req, null, []);
  const now = nowDb();
  const uuid = randomUUID();
  const { equipment, ...row } = v;
  const id = await transaction(async () => {
    await lockNamed(lockKey(v.room_id, v.booking_date));
    await assertFree(req, v, null);
    // ผู้จอง + แผนก = ผู้ที่ login (แผนกเก็บตามตอนจอง)
    const bookingId = await insert("meeting_bookings", { uuid, ...row, user_id: u.id, department: u.department, status: "confirmed", created_at: now, updated_at: now });
    await saveEquipment(bookingId, equipment);
    return bookingId;
  });
  await audit(req, { action: "meeting_booking.created", subjectType: "meeting_booking", subjectId: id, after: auditView(v) });
  const [json] = await bookingsJson([(await first<BookingRow>(`${BOOKING_SELECT} WHERE m.id = ?`, [id]))!], u);
  res.status(201).json({ data: json });
});

/** เจ้าของการจอง หรือผู้มีสิทธิ์จัดการการจองของผู้อื่น */
function assertOwner(u: UserRow, b: BookingRow) {
  authorize(Number(b.user_id) === u.id || managesAny(u));
}

/** ผู้จัดการแก้/ยกเลิก/ลบการจองของคนอื่น → แจ้งเจ้าของ */
async function notifyOwner(u: UserRow, b: BookingRow, event: "updated" | "cancelled" | "deleted") {
  if (Number(b.user_id) === u.id) return;
  await notifyUsers([Number(b.user_id)], `meeting.${event}`, {
    kind: "meeting",
    event,
    booking_id: b.uuid,
    actor: u.name,
    title: b.title,
    room: b.room_name,
    date: dateOnly(b.booking_date),
    start_time: b.start_time,
    end_time: b.end_time,
  });
}

meetingRoutes.put("/meeting-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  if (b.status !== "confirmed" || isOver(dateOnly(b.booking_date)!, b.end_time)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_editable") });
  const currentEquipment = (await select<{ name: string }>("SELECT name FROM meeting_booking_equipment WHERE booking_id = ?", [b.id])).map((e) => e.name);
  const v = await bookingInput(req, b, currentEquipment);
  const { equipment, ...row } = v;
  await transaction(async () => {
    await lockNamed(lockKey(v.room_id, v.booking_date));
    await assertFree(req, v, Number(b.id));
    await update("meeting_bookings", { ...row, updated_at: nowDb() }, "id = ?", [b.id]);
    await saveEquipment(Number(b.id), equipment);
  });
  await audit(req, {
    action: "meeting_booking.updated",
    subjectType: "meeting_booking",
    subjectId: b.id,
    before: { room_id: Number(b.room_id), title: b.title, attendees: Number(b.attendees), purpose: b.purpose, note: b.note, booking_date: dateOnly(b.booking_date), start_time: b.start_time, end_time: b.end_time, equipment: currentEquipment },
    after: auditView(v),
  });
  await notifyOwner(u, b, "updated");
  const [json] = await bookingsJson([(await first<BookingRow>(`${BOOKING_SELECT} WHERE m.id = ?`, [b.id]))!], u);
  res.json({ data: json });
});

meetingRoutes.post("/meeting-bookings/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  if (b.status !== "confirmed" || isOver(dateOnly(b.booking_date)!, b.end_time)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_editable") });
  const now = nowDb();
  await update("meeting_bookings", { status: "cancelled", cancelled_at: now, cancelled_by: u.id, updated_at: now }, "id = ?", [b.id]);
  await audit(req, { action: "meeting_booking.cancelled", subjectType: "meeting_booking", subjectId: b.id, before: { status: b.status } });
  await notifyOwner(u, b, "cancelled");
  const [json] = await bookingsJson([(await first<BookingRow>(`${BOOKING_SELECT} WHERE m.id = ?`, [b.id]))!], u);
  res.json({ data: json });
});

/** ลบ (soft delete) — การจองที่ใช้ไปแล้วเก็บเป็นประวัติ ลบไม่ได้ */
meetingRoutes.delete("/meeting-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  if (b.status === "confirmed" && isOver(dateOnly(b.booking_date)!, b.end_time)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_deletable") });
  await update("meeting_bookings", { deleted_at: nowDb() }, "id = ?", [b.id]);
  await audit(req, { action: "meeting_booking.deleted", subjectType: "meeting_booking", subjectId: b.id, before: { title: b.title, booking_date: dateOnly(b.booking_date), start_time: b.start_time, end_time: b.end_time, status: b.status } });
  if (b.status === "confirmed") await notifyOwner(u, b, "deleted");
  res.status(204).end();
});
