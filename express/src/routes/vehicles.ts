import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, insert, isUuid, lockNamed, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, custom, int, regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audit } from "../services/audit.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { usersWithPermissions } from "../services/permissions.js";
import { MAX_PHOTOS, processPhoto } from "../services/photos.js";
import { deleteStored, randomString, readStored, writeStored } from "../services/ticket-files.js";

/**
 * ระบบจองรถ — ทุกคนดูปฏิทินรถ / จอง (ไม่ระบุรถได้ = ให้ผู้จัดคิวรถเลือกให้) / แก้-ยกเลิก-ลบ / บันทึกเลขไมล์ของการจองตัวเอง
 *   รถ (vehicle.manage): GET /vehicles (?include_inactive=1), GET|PUT|DELETE /vehicles/:id, POST /vehicles, GET /vehicles/:id/mileage (ประวัติเลขไมล์)
 *     รูป ≤ 4 รูป/คัน ≤ 1MB/รูป: POST /vehicles/:id/images, PUT .../images/:imageId (รูปหลัก), DELETE .../images/:imageId, GET (ทุกคน)
 *   การจอง: GET /vehicle-bookings?from=&to= (ที่ยืนยันแล้ว), GET /vehicle-bookings/mine?status=upcoming|past|cancelled,
 *     GET /vehicle-bookings/dispatch?status=unassigned|upcoming (vehicle.dispatch), GET|PUT|DELETE /vehicle-bookings/:uuid, POST /vehicle-bookings,
 *     PUT /vehicle-bookings/:uuid/vehicle (ผู้จัดคิวเลือกรถ), PUT /vehicle-bookings/:uuid/mileage (เลขไมล์ — บันทึกได้หลังใช้งาน), POST /vehicle-bookings/:uuid/cancel
 *   ช่วงเวลา = start_on + start_time ถึง end_on + end_time ("HH:MM" เวลาไทย, หลายวันได้) — รถคันเดียวกันช่วงเวลาซ้อนกัน = 422 (ตรวจใน transaction + lock ต่อคัน)
 *   เลขไมล์: vehicles.mileage = เลขไมล์ล่าสุด — จองแล้วไม่กรอกเลขไมล์เริ่มต้น = ใช้เลขไมล์ล่าสุดของคัน; บันทึกเลขไมล์ที่มากกว่าเดิม = อัปเดตเลขไมล์ล่าสุด
 * ประเภทการใช้งาน / รายการเพิ่มเติม = dropdown_options (vehicle_purpose / vehicle_extra) — routes/dropdown-options.ts
 */
export const vehicleRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d)$/;
const MAX_DAYS = 60;
const MAX_MILEAGE = 9_999_999;
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);
const manages = (u: UserRow) => can(u, "vehicle.manage");
const dispatches = (u: UserRow) => can(u, "vehicle.dispatch");
const idParam = (v: unknown) => (/^\d+$/.test(String(v)) ? Number(v) : 0);

/** วันเวลาปัจจุบัน "YYYY-MM-DD HH:MM" ตามเขตเวลาของผู้ใช้ */
function localNow(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: config.localTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/* ---------------------------------------------------------------- รถ */

interface VehicleRow {
  id: number;
  name: string;
  plate_no: string | null;
  branch_id: number | null;
  branch_name: string | null;
  seats: number;
  parking: string | null;
  description: string | null;
  mileage: number | null;
  is_active: boolean | number;
  sort_order: number;
  bookings_count?: number | string;
}

interface ImageRow {
  id: number;
  vehicle_id: number;
  path: string;
  is_primary: boolean | number;
  sort_order: number;
}

const VEHICLE_SELECT = "SELECT v.*, b.name AS branch_name FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id";

async function vehicleJson(v: VehicleRow, images?: ImageRow[]) {
  const imgs = images ?? (await select<ImageRow>("SELECT * FROM vehicle_images WHERE vehicle_id = ? ORDER BY sort_order, id", [v.id]));
  return {
    id: Number(v.id),
    name: v.name,
    plate_no: v.plate_no,
    branch: v.branch_id ? { id: Number(v.branch_id), name: v.branch_name ?? "" } : null,
    seats: Number(v.seats),
    parking: v.parking,
    description: v.description,
    mileage: v.mileage === null ? null : Number(v.mileage),
    is_active: Boolean(v.is_active),
    sort_order: Number(v.sort_order),
    images: imgs.map((i) => ({ id: Number(i.id), is_primary: Boolean(i.is_primary) })),
    ...(v.bookings_count !== undefined ? { bookings_count: Number(v.bookings_count) } : {}),
  };
}

async function findVehicle(id: number): Promise<VehicleRow> {
  const v = id ? await first<VehicleRow>(`${VEHICLE_SELECT} WHERE v.id = ?`, [id]) : null;
  if (!v) throw notFound();
  return v;
}

vehicleRoutes.get("/vehicles", async (req, res) => {
  const all = bool(req.query.include_inactive);
  if (all) authorize(manages(me(req)));
  const rows = await select<VehicleRow>(
    `SELECT v.*, b.name AS branch_name, (SELECT COUNT(*) FROM vehicle_bookings x WHERE x.vehicle_id = v.id AND x.deleted_at IS NULL) AS bookings_count
       FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id ${all ? "" : "WHERE v.is_active = true"} ORDER BY v.sort_order, v.name`,
  );
  const images = rows.length ? await select<ImageRow>("SELECT * FROM vehicle_images WHERE vehicle_id IN (?) ORDER BY sort_order, id", [rows.map((r) => r.id)]) : [];
  res.json({ data: await Promise.all(rows.map((r) => vehicleJson(r, images.filter((i) => Number(i.vehicle_id) === Number(r.id))))) });
});

vehicleRoutes.get("/vehicles/:id", async (req, res) => {
  res.json({ data: await vehicleJson(await findVehicle(idParam(req.params.id))) });
});

async function vehicleInput(req: Request, current: VehicleRow | null) {
  const dup = (column: "name" | "plate_no") =>
    custom(
      async (v) => (await scalar(`SELECT 1 FROM vehicles WHERE LOWER(${column}) = LOWER(?)${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()])) === null,
      t(req, column === "name" ? "eam.vehicle.name_duplicate" : "eam.vehicle.plate_duplicate"),
    );
  const data = await validate(
    req.input,
    {
      name: ["required", "string", "max:100", dup("name")],
      plate_no: ["nullable", "string", "max:30", dup("plate_no")],
      branch_id: ["nullable", "integer", custom(async (v) => (await scalar("SELECT 1 FROM branches WHERE id = ?", [Number(v)])) !== null, t(req, "eam.meeting.branch_invalid"))],
      seats: ["required", "integer", "min:1", "max:99"],
      parking: ["nullable", "string", "max:255"],
      description: ["nullable", "string", "max:2000"],
      mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`],
      is_active: ["sometimes", "boolean"],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
    },
    { locale: req.locale },
  );
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name: String(data.name).trim(),
    plate_no: text(data.plate_no),
    branch_id: int(data.branch_id),
    seats: int(data.seats)!,
    parking: text(data.parking),
    description: text(data.description),
    mileage: int(data.mileage),
    ...("is_active" in data ? { is_active: bool(data.is_active) } : {}),
    ...("sort_order" in data ? { sort_order: data.sort_order } : {}),
  };
}

const withoutImages = (j: Awaited<ReturnType<typeof vehicleJson>>) => ({ ...j, images: undefined });

vehicleRoutes.post("/vehicles", async (req, res) => {
  authorize(manages(me(req)));
  const v = await vehicleInput(req, null);
  const now = nowDb();
  const id = await insert("vehicles", { ...v, created_at: now, updated_at: now });
  const json = await vehicleJson(await findVehicle(id));
  await audit(req, { action: "vehicle.created", subjectType: "vehicle", subjectId: id, after: withoutImages(json) });
  res.status(201).json({ data: json });
});

vehicleRoutes.put("/vehicles/:id", async (req, res) => {
  authorize(manages(me(req)));
  const current = await findVehicle(idParam(req.params.id));
  const v = await vehicleInput(req, current);
  await update("vehicles", { ...v, updated_at: nowDb() }, "id = ?", [current.id]);
  const before = await vehicleJson(current, []);
  const after = await vehicleJson(await findVehicle(current.id));
  await audit(req, { action: "vehicle.updated", subjectType: "vehicle", subjectId: current.id, before: withoutImages(before), after: withoutImages(after) });
  res.json({ data: after });
});

/** ลบได้เมื่อไม่เคยมีการจอง — มีประวัติแล้วให้ปิดใช้งานแทน */
vehicleRoutes.delete("/vehicles/:id", async (req, res) => {
  authorize(manages(me(req)));
  const current = await findVehicle(idParam(req.params.id));
  const used = Number(await scalar("SELECT COUNT(*) FROM vehicle_bookings WHERE vehicle_id = ?", [current.id]));
  if (used > 0) throw ValidationError.withMessages({ name: t(req, "eam.vehicle.in_use", { count: used }) });
  const images = await select<ImageRow>("SELECT * FROM vehicle_images WHERE vehicle_id = ?", [current.id]);
  await exec("DELETE FROM vehicles WHERE id = ?", [current.id]);
  for (const i of images) await deleteStored(i.path);
  await audit(req, { action: "vehicle.deleted", subjectType: "vehicle", subjectId: current.id, before: withoutImages(await vehicleJson(current, [])) });
  res.status(204).end();
});

/** ประวัติเลขไมล์จากการจอง (ล่าสุดก่อน) */
vehicleRoutes.get("/vehicles/:id/mileage", async (req, res) => {
  authorize(manages(me(req)) || dispatches(me(req)));
  const v = await findVehicle(idParam(req.params.id));
  const rows = await select<{ uuid: string; start_on: string; start_time: string; end_on: string; end_time: string; start_mileage: number | null; end_mileage: number | null; user_name: string | null; details: string }>(
    `SELECT m.uuid, m.start_on, m.start_time, m.end_on, m.end_time, m.start_mileage, m.end_mileage, m.details, u.name AS user_name
       FROM vehicle_bookings m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.vehicle_id = ? AND m.deleted_at IS NULL AND m.status = 'confirmed' AND (m.start_mileage IS NOT NULL OR m.end_mileage IS NOT NULL)
      ORDER BY m.start_on DESC, m.start_time DESC LIMIT 200`,
    [v.id],
  );
  res.json({
    data: rows.map((r) => ({
      booking_id: r.uuid,
      start_on: dateOnly(r.start_on),
      start_time: r.start_time,
      end_on: dateOnly(r.end_on),
      end_time: r.end_time,
      start_mileage: r.start_mileage === null ? null : Number(r.start_mileage),
      end_mileage: r.end_mileage === null ? null : Number(r.end_mileage),
      distance: r.start_mileage !== null && r.end_mileage !== null ? Number(r.end_mileage) - Number(r.start_mileage) : null,
      user_name: r.user_name ?? "",
      details: r.details,
    })),
  });
});

/* ---------------------------------------------------------------- รูปรถ */

vehicleRoutes.post("/vehicles/:id/images", async (req, res) => {
  authorize(manages(me(req)));
  const vehicle = await findVehicle(idParam(req.params.id));
  const data = await validate(
    req.input,
    { images: ["required", "array", `max:${MAX_PHOTOS}`], "images.*": ["file", "image", "mimes:jpg,jpeg,png,webp", "max:1024"] },
    { locale: req.locale },
  );
  const files = Object.values(data.images as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const existing = await select<ImageRow>("SELECT * FROM vehicle_images WHERE vehicle_id = ? ORDER BY sort_order, id", [vehicle.id]);
  if (existing.length + files.length > MAX_PHOTOS) throw ValidationError.withMessages({ images: t(req, "eam.meeting.images_max", { max: MAX_PHOTOS, left: MAX_PHOTOS - existing.length }) });
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
    const path = `vehicles/${vehicle.id}/${randomString(32)}.webp`;
    await writeStored(path, buf);
    const primary = n === 0 && !existing.some((i) => Boolean(i.is_primary));
    ids.push(await insert("vehicle_images", { vehicle_id: vehicle.id, path, size: buf.length, is_primary: primary, sort_order: ++order, created_at: now }));
  }
  await audit(req, { action: "vehicle.images_added", subjectType: "vehicle", subjectId: vehicle.id, after: { image_ids: ids } });
  res.status(201).json({ data: await vehicleJson(await findVehicle(vehicle.id)) });
});

async function findImage(req: Request) {
  const vehicle = await findVehicle(idParam(req.params.id));
  const img = await first<ImageRow>("SELECT * FROM vehicle_images WHERE id = ? AND vehicle_id = ?", [idParam(req.params.imageId), vehicle.id]);
  if (!img) throw notFound();
  return { vehicle, img };
}

vehicleRoutes.get("/vehicles/:id/images/:imageId", async (req, res) => {
  const { img } = await findImage(req);
  const file = await readStored(img.path);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.data);
});

vehicleRoutes.put("/vehicles/:id/images/:imageId", async (req, res) => {
  authorize(manages(me(req)));
  const { vehicle, img } = await findImage(req);
  await transaction(async () => {
    await exec("UPDATE vehicle_images SET is_primary = false WHERE vehicle_id = ?", [vehicle.id]);
    await exec("UPDATE vehicle_images SET is_primary = true WHERE id = ?", [img.id]);
  });
  await audit(req, { action: "vehicle.primary_image", subjectType: "vehicle", subjectId: vehicle.id, after: { image_id: Number(img.id) } });
  res.json({ data: await vehicleJson(await findVehicle(vehicle.id)) });
});

vehicleRoutes.delete("/vehicles/:id/images/:imageId", async (req, res) => {
  authorize(manages(me(req)));
  const { vehicle, img } = await findImage(req);
  await exec("DELETE FROM vehicle_images WHERE id = ?", [img.id]);
  if (img.is_primary) await exec("UPDATE vehicle_images SET is_primary = true WHERE vehicle_id = ? ORDER BY sort_order, id LIMIT 1", [vehicle.id]);
  await deleteStored(img.path);
  await audit(req, { action: "vehicle.image_removed", subjectType: "vehicle", subjectId: vehicle.id, before: { image_id: Number(img.id) } });
  res.json({ data: await vehicleJson(await findVehicle(vehicle.id)) });
});

/* ---------------------------------------------------------------- การจอง */

interface BookingRow {
  id: number;
  uuid: string;
  vehicle_id: number | null;
  vehicle_name: string | null;
  plate_no: string | null;
  user_id: number;
  user_name: string | null;
  department: string | null;
  details: string;
  passengers: number;
  purpose: string | null;
  note: string | null;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
  start_mileage: number | null;
  end_mileage: number | null;
  status: string;
  assigned_name: string | null;
  assigned_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const BOOKING_SELECT = `SELECT m.*, v.name AS vehicle_name, v.plate_no, u.name AS user_name, a.name AS assigned_name
  FROM vehicle_bookings m LEFT JOIN vehicles v ON v.id = m.vehicle_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users a ON a.id = m.assigned_by`;

const startAt = (b: { start_on: string; start_time: string }) => `${dateOnly(b.start_on)} ${b.start_time}`;
const endAt = (b: { end_on: string; end_time: string }) => `${dateOnly(b.end_on)} ${b.end_time}`;
const isOver = (b: { end_on: string; end_time: string }) => endAt(b) <= localNow();
const numOrNull = (v: number | null) => (v === null ? null : Number(v));

async function bookingsJson(rows: BookingRow[], u: UserRow) {
  const extras = rows.length ? await select<{ booking_id: number; name: string }>("SELECT booking_id, name FROM vehicle_booking_extras WHERE booking_id IN (?) ORDER BY name", [rows.map((r) => r.id)]) : [];
  return rows.map((r) => {
    const mine = Number(r.user_id) === u.id;
    const over = isOver(r);
    const active = r.status === "confirmed";
    const allowed = mine || dispatches(u);
    return {
      id: r.uuid,
      vehicle: r.vehicle_id ? { id: Number(r.vehicle_id), name: r.vehicle_name ?? "", plate_no: r.plate_no } : null,
      user: { id: Number(r.user_id), name: r.user_name ?? "" },
      department: r.department,
      details: r.details,
      passengers: Number(r.passengers),
      purpose: r.purpose,
      extras: extras.filter((e) => Number(e.booking_id) === Number(r.id)).map((e) => e.name),
      note: r.note,
      start_on: dateOnly(r.start_on)!,
      start_time: r.start_time,
      end_on: dateOnly(r.end_on)!,
      end_time: r.end_time,
      start_mileage: numOrNull(r.start_mileage),
      end_mileage: numOrNull(r.end_mileage),
      status: r.status as "confirmed" | "cancelled",
      is_over: over,
      assigned_by: r.assigned_name,
      assigned_at: iso(r.assigned_at),
      cancelled_at: iso(r.cancelled_at),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      can_edit: allowed && active && !over,
      can_cancel: allowed && active && !over,
      can_delete: allowed && (!active || !over),
      // เลขไมล์บันทึกได้ทั้งระหว่างและหลังใช้งาน (เมื่อมีรถแล้ว)
      can_mileage: allowed && active && r.vehicle_id !== null,
      can_assign: dispatches(u) && active && !over,
    };
  });
}

async function findBooking(req: Request): Promise<BookingRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await first<BookingRow>(`${BOOKING_SELECT} WHERE m.uuid = ? AND m.deleted_at IS NULL`, [uuid]) : null;
  if (!row) throw notFound();
  return row;
}
const reload = async (id: number) => (await first<BookingRow>(`${BOOKING_SELECT} WHERE m.id = ?`, [id]))!;

vehicleRoutes.get("/vehicle-bookings", async (req, res) => {
  const f = await validate(req.input, { from: ["required", regex(DATE)], to: ["required", regex(DATE)] }, { locale: req.locale });
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  const rows = await select<BookingRow>(
    `${BOOKING_SELECT} WHERE m.deleted_at IS NULL AND m.status = 'confirmed' AND m.start_on <= ? AND m.end_on >= ?
      ORDER BY m.start_on, m.start_time, v.sort_order, v.name`,
    [to, from],
  );
  res.json({ data: await bookingsJson(rows, me(req)) });
});

/** ยังไม่จบ = เวลาสิ้นสุดยังไม่ถึง (เวลาไทย) */
const UPCOMING = "(m.end_on > ? OR (m.end_on = ? AND m.end_time > ?))";
const upcomingParams = () => {
  const now = localNow();
  return [now.slice(0, 10), now.slice(0, 10), now.slice(11)];
};

vehicleRoutes.get("/vehicle-bookings/mine", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { status: ["nullable", "in:upcoming,past,cancelled"] }, { locale: req.locale });
  const status = (f.status as string) ?? "upcoming";
  const where = ["m.user_id = ?", "m.deleted_at IS NULL"];
  const params: unknown[] = [u.id];
  if (status === "cancelled") where.push("m.status = 'cancelled'");
  else {
    where.push("m.status = 'confirmed'", status === "upcoming" ? UPCOMING : `NOT ${UPCOMING}`);
    params.push(...upcomingParams());
  }
  const order = status === "upcoming" ? "m.start_on, m.start_time" : "m.start_on DESC, m.start_time DESC";
  res.json({ data: await bookingsJson(await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, params), u) });
});

/** ผู้จัดคิวรถ: unassigned = ยังไม่ระบุรถ (ค่าตั้งต้น) / upcoming = ทุกการจองที่ยังไม่จบ */
vehicleRoutes.get("/vehicle-bookings/dispatch", async (req, res) => {
  const u = me(req);
  authorize(dispatches(u));
  const f = await validate(req.input, { status: ["nullable", "in:unassigned,upcoming"] }, { locale: req.locale });
  const where = ["m.deleted_at IS NULL", "m.status = 'confirmed'", UPCOMING];
  if ((f.status ?? "unassigned") === "unassigned") where.push("m.vehicle_id IS NULL");
  const rows = await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.start_on, m.start_time LIMIT 500`, upcomingParams());
  res.json({ data: await bookingsJson(rows, u) });
});

vehicleRoutes.get("/vehicle-bookings/:uuid", async (req, res) => {
  const [json] = await bookingsJson([await findBooking(req)], me(req));
  res.json({ data: json });
});

const activeOptions = async (list: string) => (await select<{ name: string }>("SELECT name FROM dropdown_options WHERE list = ? AND is_active = true", [list])).map((o) => o.name);

/** รถที่เลือกได้: เปิดใช้งาน (หรือคันเดิมของการจองนี้) */
async function vehicleOk(id: number | null, currentId: number | null): Promise<boolean> {
  if (id === null) return true;
  const v = await first<{ is_active: boolean | number }>("SELECT is_active FROM vehicles WHERE id = ?", [id]);
  return Boolean(v && (v.is_active || id === currentId));
}

async function bookingInput(req: Request, current: BookingRow | null, currentExtras: string[]) {
  const data = await validate(
    req.input,
    {
      vehicle_id: ["nullable", "integer"],
      details: ["required", "string", "max:2000", regex(/\S/)],
      passengers: ["required", "integer", "min:1", "max:99"],
      purpose: ["required", "string", "max:100"],
      extras: ["nullable", "array", "max:30"],
      "extras.*": ["string", "max:100"],
      note: ["nullable", "string", "max:2000"],
      start_on: ["required", regex(DATE)],
      start_time: ["required", regex(TIME)],
      end_on: ["required", regex(DATE)],
      end_time: ["required", regex(TIME)],
      start_mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`],
      end_mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`],
    },
    { locale: req.locale },
  );
  const errors: Record<string, string> = {};
  const vehicleId = int(data.vehicle_id);
  if (!(await vehicleOk(vehicleId, current?.vehicle_id ? Number(current.vehicle_id) : null))) errors.vehicle_id = t(req, "eam.vehicle.vehicle_invalid");
  const v = { start_on: String(data.start_on), start_time: String(data.start_time), end_on: String(data.end_on), end_time: String(data.end_time) };
  const days = (new Date(v.end_on).getTime() - new Date(v.start_on).getTime()) / 86_400_000;
  if (endAt(v) <= startAt(v)) errors.end_time = t(req, "eam.meeting.time_order");
  else if (days > MAX_DAYS) errors.end_on = t(req, "eam.vehicle.too_long", { days: MAX_DAYS });
  else if (isOver(v)) errors.end_on = t(req, "eam.meeting.past");
  const startMileage = int(data.start_mileage);
  const endMileage = int(data.end_mileage);
  if (startMileage !== null && endMileage !== null && endMileage < startMileage) errors.end_mileage = t(req, "eam.vehicle.mileage_order");

  const purpose = String(data.purpose).trim();
  if (!(await activeOptions("vehicle_purpose")).some((p) => p.toLowerCase() === purpose.toLowerCase()) && purpose.toLowerCase() !== (current?.purpose ?? "").toLowerCase()) {
    errors.purpose = t(req, "eam.meeting.option_invalid");
  }
  const extras = [...new Set(Object.values((data.extras as Record<string, unknown>) ?? {}).map((e) => String(e).trim()).filter(Boolean))];
  const allowed = [...(await activeOptions("vehicle_extra")), ...currentExtras].map((e) => e.toLowerCase());
  if (extras.some((e) => !allowed.includes(e.toLowerCase()))) errors.extras = t(req, "eam.meeting.option_invalid");
  if (Object.keys(errors).length) throw ValidationError.withMessages(errors);
  return {
    vehicle_id: vehicleId,
    details: String(data.details).trim(),
    passengers: int(data.passengers)!,
    purpose,
    note: typeof data.note === "string" && data.note.trim() ? data.note.trim() : null,
    ...v,
    start_mileage: startMileage,
    end_mileage: endMileage,
    extras,
  };
}

/** รถคันเดียวกัน ช่วงเวลาซ้อนกัน (ไม่นับที่ยกเลิก/ลบ และตัวเอง) — เรียกใน transaction หลัง lock */
async function assertFree(req: Request, vehicleId: number, v: { start_on: string; start_time: string; end_on: string; end_time: string }, exceptId: number | null) {
  const clash = await first<BookingRow>(
    `${BOOKING_SELECT} WHERE m.vehicle_id = ? AND m.status = 'confirmed' AND m.deleted_at IS NULL
        AND m.start_on <= ? AND m.end_on >= ?
        AND CONCAT(m.start_on, ' ', m.start_time) < ? AND CONCAT(m.end_on, ' ', m.end_time) > ?${exceptId ? " AND m.id <> ?" : ""}
      ORDER BY m.start_on, m.start_time LIMIT 1`,
    [vehicleId, v.end_on, v.start_on, endAt(v), startAt(v), ...(exceptId ? [exceptId] : [])],
  );
  if (clash) {
    const period = (b: BookingRow) => (dateOnly(b.start_on) === dateOnly(b.end_on) ? `${dateOnly(b.start_on)} ${b.start_time}–${b.end_time}` : `${startAt(b)} – ${endAt(b)}`);
    throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.overlap", { vehicle: clash.vehicle_name ?? "", period: period(clash), name: clash.user_name ?? "-" }) });
  }
}

const lockKey = (vehicleId: number) => `vehicle:${vehicleId}`;

async function saveExtras(bookingId: number, names: string[]) {
  await exec("DELETE FROM vehicle_booking_extras WHERE booking_id = ?", [bookingId]);
  for (const name of names) await insert("vehicle_booking_extras", { booking_id: bookingId, name });
}

/** เลขไมล์ที่บันทึกมากกว่าเลขไมล์ล่าสุดของคัน → อัปเดตเลขไมล์ล่าสุด */
async function bumpMileage(vehicleId: number | null, ...values: (number | null)[]) {
  const max = Math.max(...values.filter((x): x is number => x !== null), -1);
  if (vehicleId && max >= 0) await exec("UPDATE vehicles SET mileage = ?, updated_at = ? WHERE id = ? AND (mileage IS NULL OR mileage < ?)", [max, nowDb(), vehicleId, max]);
}
const currentMileage = async (vehicleId: number | null) => (vehicleId ? numOrNull((await scalar<number | null>("SELECT mileage FROM vehicles WHERE id = ?", [vehicleId])) ?? null) : null);

/** แจ้งผู้จัดคิวรถ (ยกเว้นตัวเอง): มีการจองที่ยังไม่ระบุรถ */
async function notifyDispatchers(u: UserRow, b: BookingRow) {
  const ids = (await usersWithPermissions(["vehicle.dispatch"])).map((x) => x.id).filter((id) => id !== u.id);
  if (!ids.length) return;
  await notifyUsers(ids, "vehicle.requested", noticeData(u, b, "requested"));
}
const noticeData = (u: UserRow, b: BookingRow, event: string) => ({
  kind: "vehicle",
  event,
  vehicle_booking_id: b.uuid,
  actor: u.name,
  vehicle: b.vehicle_name,
  start_on: dateOnly(b.start_on),
  start_time: b.start_time,
  end_on: dateOnly(b.end_on),
  end_time: b.end_time,
});
/** การจองมีรถแล้ว / ยกเลิก / ลบ → แจ้งเตือน "รอจัดรถ" ของผู้จัดคิวหมดหน้าที่ */
const resolveRequested = (b: BookingRow) => markNoticesRead("vehicle_booking_id", b.uuid, { events: ["requested"] });

vehicleRoutes.post("/vehicle-bookings", async (req, res) => {
  const u = me(req);
  const v = await bookingInput(req, null, []);
  const { extras, ...row } = v;
  // ไม่กรอกเลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคัน
  if (row.vehicle_id && row.start_mileage === null) row.start_mileage = await currentMileage(row.vehicle_id);
  const now = nowDb();
  const id = await transaction(async () => {
    if (row.vehicle_id) {
      await lockNamed(lockKey(row.vehicle_id));
      await assertFree(req, row.vehicle_id, row, null);
    }
    const bookingId = await insert("vehicle_bookings", {
      uuid: randomUUID(), ...row, user_id: u.id, department: u.department, status: "confirmed",
      ...(row.vehicle_id ? { assigned_by: u.id, assigned_at: now } : {}),
      created_at: now, updated_at: now,
    });
    await saveExtras(bookingId, extras);
    return bookingId;
  });
  await bumpMileage(row.vehicle_id, row.start_mileage, row.end_mileage);
  const b = await reload(id);
  await audit(req, { action: "vehicle_booking.created", subjectType: "vehicle_booking", subjectId: id, after: v });
  if (!row.vehicle_id) await notifyDispatchers(u, b);
  const [json] = await bookingsJson([b], u);
  res.status(201).json({ data: json });
});

function assertOwner(u: UserRow, b: BookingRow) {
  authorize(Number(b.user_id) === u.id || dispatches(u));
}
/** ผู้จัดคิวแก้/เลือกรถ/ยกเลิก/ลบการจองของคนอื่น → แจ้งเจ้าของ */
async function notifyOwner(u: UserRow, b: BookingRow, event: "updated" | "assigned" | "cancelled" | "deleted") {
  if (Number(b.user_id) === u.id) return;
  await notifyUsers([Number(b.user_id)], `vehicle.${event}`, noticeData(u, b, event));
}
const assertActive = (req: Request, b: BookingRow) => {
  if (b.status !== "confirmed" || isOver(b)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_editable") });
};
const snapshot = (b: BookingRow, extras: string[]) => ({
  vehicle_id: numOrNull(b.vehicle_id), details: b.details, passengers: Number(b.passengers), purpose: b.purpose, note: b.note,
  start_on: dateOnly(b.start_on), start_time: b.start_time, end_on: dateOnly(b.end_on), end_time: b.end_time,
  start_mileage: numOrNull(b.start_mileage), end_mileage: numOrNull(b.end_mileage), extras,
});

vehicleRoutes.put("/vehicle-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  assertActive(req, b);
  const currentExtras = (await select<{ name: string }>("SELECT name FROM vehicle_booking_extras WHERE booking_id = ?", [b.id])).map((e) => e.name);
  const v = await bookingInput(req, b, currentExtras);
  const { extras, ...row } = v;
  const vehicleChanged = numOrNull(b.vehicle_id) !== row.vehicle_id;
  if (row.vehicle_id && row.start_mileage === null && vehicleChanged) row.start_mileage = await currentMileage(row.vehicle_id);
  await transaction(async () => {
    if (row.vehicle_id) {
      await lockNamed(lockKey(row.vehicle_id));
      await assertFree(req, row.vehicle_id, row, Number(b.id));
    }
    await update(
      "vehicle_bookings",
      { ...row, ...(vehicleChanged ? { assigned_by: row.vehicle_id ? u.id : null, assigned_at: row.vehicle_id ? nowDb() : null } : {}), updated_at: nowDb() },
      "id = ?",
      [b.id],
    );
    await saveExtras(Number(b.id), extras);
  });
  await bumpMileage(row.vehicle_id, row.start_mileage, row.end_mileage);
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.updated", subjectType: "vehicle_booking", subjectId: b.id, before: snapshot(b, currentExtras), after: v });
  if (row.vehicle_id) await resolveRequested(after);
  else if (vehicleChanged) await notifyDispatchers(u, after);
  await notifyOwner(u, after, "updated");
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/** ผู้จัดคิวรถเลือก / เปลี่ยน / เอารถออก (vehicle_id = null) — ไม่มีเลขไมล์เริ่มต้น = ใช้เลขไมล์ล่าสุดของคัน */
vehicleRoutes.put("/vehicle-bookings/:uuid/vehicle", async (req, res) => {
  const u = me(req);
  authorize(dispatches(u));
  const b = await findBooking(req);
  assertActive(req, b);
  const data = await validate(req.input, { vehicle_id: ["nullable", "integer"] }, { locale: req.locale });
  const vehicleId = int(data.vehicle_id);
  if (!(await vehicleOk(vehicleId, numOrNull(b.vehicle_id)))) throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.vehicle_invalid") });
  const startMileage = vehicleId && (b.start_mileage === null || numOrNull(b.vehicle_id) !== vehicleId) ? await currentMileage(vehicleId) : numOrNull(b.start_mileage);
  await transaction(async () => {
    if (vehicleId) {
      await lockNamed(lockKey(vehicleId));
      await assertFree(req, vehicleId, { start_on: dateOnly(b.start_on)!, start_time: b.start_time, end_on: dateOnly(b.end_on)!, end_time: b.end_time }, Number(b.id));
    }
    await update(
      "vehicle_bookings",
      { vehicle_id: vehicleId, start_mileage: vehicleId ? startMileage : null, end_mileage: vehicleId ? b.end_mileage : null, assigned_by: vehicleId ? u.id : null, assigned_at: vehicleId ? nowDb() : null, updated_at: nowDb() },
      "id = ?",
      [b.id],
    );
  });
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.assigned", subjectType: "vehicle_booking", subjectId: b.id, before: { vehicle_id: numOrNull(b.vehicle_id) }, after: { vehicle_id: vehicleId, start_mileage: startMileage } });
  if (vehicleId) {
    await resolveRequested(after);
    await notifyOwner(u, after, "assigned");
  } else await notifyDispatchers(u, after);
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/** บันทึกเลขไมล์ (ระหว่าง / หลังใช้งาน) — เจ้าของการจอง หรือผู้จัดคิวรถ */
vehicleRoutes.put("/vehicle-bookings/:uuid/mileage", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  if (b.status !== "confirmed" || !b.vehicle_id) throw ValidationError.withMessages({ start_mileage: t(req, "eam.vehicle.mileage_no_vehicle") });
  const data = await validate(
    req.input,
    { start_mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`], end_mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`] },
    { locale: req.locale },
  );
  const start = int(data.start_mileage);
  const end = int(data.end_mileage);
  if (start !== null && end !== null && end < start) throw ValidationError.withMessages({ end_mileage: t(req, "eam.vehicle.mileage_order") });
  await update("vehicle_bookings", { start_mileage: start, end_mileage: end, updated_at: nowDb() }, "id = ?", [b.id]);
  await bumpMileage(Number(b.vehicle_id), start, end);
  await audit(req, { action: "vehicle_booking.mileage", subjectType: "vehicle_booking", subjectId: b.id, before: { start_mileage: numOrNull(b.start_mileage), end_mileage: numOrNull(b.end_mileage) }, after: { start_mileage: start, end_mileage: end } });
  const [json] = await bookingsJson([await reload(Number(b.id))], u);
  res.json({ data: json });
});

vehicleRoutes.post("/vehicle-bookings/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  assertActive(req, b);
  const now = nowDb();
  await update("vehicle_bookings", { status: "cancelled", cancelled_at: now, cancelled_by: u.id, updated_at: now }, "id = ?", [b.id]);
  await audit(req, { action: "vehicle_booking.cancelled", subjectType: "vehicle_booking", subjectId: b.id, before: { status: b.status } });
  await resolveRequested(b);
  await notifyOwner(u, b, "cancelled");
  const [json] = await bookingsJson([await reload(Number(b.id))], u);
  res.json({ data: json });
});

/** ลบ (soft delete) — การจองที่ใช้ไปแล้วเก็บเป็นประวัติ (เลขไมล์) ลบไม่ได้ */
vehicleRoutes.delete("/vehicle-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  assertOwner(u, b);
  if (b.status === "confirmed" && isOver(b)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_deletable") });
  await update("vehicle_bookings", { deleted_at: nowDb() }, "id = ?", [b.id]);
  await audit(req, { action: "vehicle_booking.deleted", subjectType: "vehicle_booking", subjectId: b.id, before: snapshot(b, []) });
  await resolveRequested(b);
  if (b.status === "confirmed") await notifyOwner(u, b, "deleted");
  res.status(204).end();
});

/** ตัวเลขเมนู "จัดคิวรถ" = การจองที่ยังไม่จบและยังไม่ระบุรถ */
export async function unassignedVehicleBookings(): Promise<number> {
  return Number(await scalar(`SELECT COUNT(*) FROM vehicle_bookings m WHERE m.deleted_at IS NULL AND m.status = 'confirmed' AND m.vehicle_id IS NULL AND ${UPCOMING}`, upcomingParams()));
}
