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
import { bookingScope, branchWhere, canManageBranch, canSeeBranch, scopeOf, type ScopeOf } from "../services/booking-scope.js";
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
 *   อนุมัติโดยผู้จัดคิวรถ: จองใหม่ = pending (รออนุมัติ — แจ้งผู้จัดคิวของสาขา, ขึ้นปฏิทินเฉพาะเจ้าของแบบรออนุมัติ) →
 *     POST /vehicle-bookings/:uuid/approve { vehicle_id? } = confirmed (ต้องมีรถ — เปลี่ยนรถก่อนอนุมัติได้) / POST .../reject { reason } = rejected — แจ้งผู้จอง
 *     ผู้จัดคิวของสาขานั้นจองเองพร้อมเลือกรถ = อนุมัติทันที; เจ้าของแก้เวลา/รถของการจองที่อนุมัติแล้ว = กลับเป็นรออนุมัติ
 *     pending จองช่วงเวลาของรถไว้ด้วย (ตรวจชนกับ pending + confirmed)
 *   ช่วงเวลา = start_on + start_time ถึง end_on + end_time ("HH:MM" เวลาไทย, หลายวันได้) — รถคันเดียวกันช่วงเวลาซ้อนกัน = 422 (ตรวจใน transaction + lock ต่อคัน)
 *   เลขไมล์: vehicles.mileage = เลขไมล์ล่าสุด (จากเลขไมล์สิ้นสุดตอนคืนรถ) — ฟอร์มจอง/แก้ไขไม่รับเลขไมล์ (ไม่สนค่าที่ส่งมา);
 *     ผู้จองบันทึกเลขไมล์สิ้นสุดได้ครั้งเดียว (PUT .../mileage) โดยเลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคัน ณ ตอนบันทึก — บันทึกแล้วแก้ได้เฉพาะผู้จัดคิว
 *     ผู้จองเปลี่ยนรถของการจองที่อนุมัติแล้วไม่ได้ (422 vehicle_locked — ผู้จัดคิวเปลี่ยนได้)
 *   ขอบเขตตามสาขาต่อกลุ่ม (services/booking-scope.ts): branch = เห็น/จองรถสาขาตัวเอง + รถใช้ร่วมกัน, จัดการรถ/จัดคิวเฉพาะสาขาตัวเอง
 *     การจองเก็บสาขาที่ขอใช้ (vehicle_bookings.branch_id) — ยังไม่ระบุรถ = ผู้จัดคิวของสาขานั้น (+ ขอบเขต all) เลือกรถให้
 *   ย้ายรถไปสาขาอื่น: POST /vehicles/:id/transfer (ประวัติ vehicle_transfers, GET /vehicles/:id/transfers) — แก้สาขาที่ PUT /vehicles/:id ไม่ได้
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
const scope = (u: UserRow) => scopeOf(u, "vehicle");
const branchOf = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
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
  vehicle_type: string | null;
  fuel_type: string | null;
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

async function vehicleJson(v: VehicleRow, images?: ImageRow[], canManage?: boolean) {
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
    vehicle_type: v.vehicle_type,
    fuel_type: v.fuel_type,
    is_active: Boolean(v.is_active),
    sort_order: Number(v.sort_order),
    images: imgs.map((i) => ({ id: Number(i.id), is_primary: Boolean(i.is_primary) })),
    ...(v.bookings_count !== undefined ? { bookings_count: Number(v.bookings_count) } : {}),
    ...(canManage !== undefined ? { can_manage: canManage } : {}),
  };
}

async function findVehicle(id: number): Promise<VehicleRow> {
  const v = id ? await first<VehicleRow>(`${VEHICLE_SELECT} WHERE v.id = ?`, [id]) : null;
  if (!v) throw notFound();
  return v;
}

vehicleRoutes.get("/vehicles", async (req, res) => {
  const u = me(req);
  const all = bool(req.query.include_inactive);
  if (all) authorize(manages(u));
  const s = await scope(u);
  const w = branchWhere("v.branch_id", s, int(req.query.branch_id));
  const rows = await select<VehicleRow>(
    `SELECT v.*, b.name AS branch_name, (SELECT COUNT(*) FROM vehicle_bookings x WHERE x.vehicle_id = v.id AND x.deleted_at IS NULL) AS bookings_count
       FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id WHERE ${w.sql}${all ? "" : " AND v.is_active = true"} ORDER BY v.sort_order, v.name`,
    w.params,
  );
  const images = rows.length ? await select<ImageRow>("SELECT * FROM vehicle_images WHERE vehicle_id IN (?) ORDER BY sort_order, id", [rows.map((r) => r.id)]) : [];
  const canManage = manages(u);
  res.json({ data: await Promise.all(rows.map((r) => vehicleJson(r, images.filter((i) => Number(i.vehicle_id) === Number(r.id)), canManage && canManageBranch(s, branchOf(r.branch_id))))) });
});

/** รถที่ผู้ใช้เห็นได้ตามขอบเขตสาขา — นอกขอบเขต = 404 */
async function visibleVehicle(u: UserRow, id: number): Promise<{ vehicle: VehicleRow; s: ScopeOf }> {
  const vehicle = await findVehicle(id);
  const s = await scope(u);
  if (!canSeeBranch(s, branchOf(vehicle.branch_id))) throw notFound();
  return { vehicle, s };
}

/** รถที่ผู้ใช้จัดการได้ (vehicle.manage + สาขาในขอบเขตที่จัดการได้) */
async function managedVehicle(u: UserRow, id: number): Promise<VehicleRow> {
  authorize(manages(u));
  const { vehicle, s } = await visibleVehicle(u, id);
  authorize(canManageBranch(s, branchOf(vehicle.branch_id)));
  return vehicle;
}

/** การจองที่ยังไม่จบของรถคันนี้ (เตือนก่อนย้ายสาขา) */
const upcomingOf = async (vehicleId: number) =>
  Number(await scalar(`SELECT COUNT(*) FROM vehicle_bookings m WHERE m.vehicle_id = ? AND m.deleted_at IS NULL AND m.status IN ('pending', 'confirmed') AND ${UPCOMING}`, [vehicleId, ...upcomingParams()]));

vehicleRoutes.get("/vehicles/:id", async (req, res) => {
  const u = me(req);
  const { vehicle, s } = await visibleVehicle(u, idParam(req.params.id));
  const canManage = manages(u) && canManageBranch(s, branchOf(vehicle.branch_id));
  res.json({ data: { ...(await vehicleJson(vehicle, undefined, canManage)), ...(canManage ? { upcoming_bookings: await upcomingOf(Number(vehicle.id)) } : {}) } });
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
      vehicle_type: ["nullable", "string", "max:50"],
      fuel_type: ["nullable", "string", "max:50"],
      is_active: ["sometimes", "boolean"],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
    },
    { locale: req.locale },
  );
  // สาขา: ตอนเพิ่ม = ในขอบเขตที่จัดการได้ (ขอบเขตสาขาตัวเอง = สาขาของผู้เพิ่ม), ตอนแก้ = เปลี่ยนไม่ได้ (ใช้ POST /vehicles/:id/transfer)
  let branchId = int(data.branch_id);
  if (current) {
    if ("branch_id" in req.input && branchId !== branchOf(current.branch_id)) throw ValidationError.withMessages({ branch_id: t(req, "eam.vehicle.branch_locked") });
    branchId = branchOf(current.branch_id);
  } else {
    const s = await scope(me(req));
    if (!canManageBranch(s, branchId)) throw ValidationError.withMessages({ branch_id: t(req, s.branchId === null ? "eam.meeting.no_branch" : "eam.meeting.branch_scope") });
  }
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  // ประเภทรถ / เชื้อเพลิง ต้องเป็นตัวเลือกที่เปิดใช้งาน (ค่าเดิมของรถคันนี้คงไว้ได้แม้ถูกปิดใช้งานภายหลัง)
  const option = async (field: "vehicle_type" | "fuel_type", list: string) => {
    const value = text(data[field]);
    if (value === null || value.toLowerCase() === (current?.[field] ?? "").toLowerCase()) return value;
    if (!(await activeOptions(list)).some((o) => o.toLowerCase() === value.toLowerCase())) throw ValidationError.withMessages({ [field]: t(req, "eam.meeting.option_invalid") });
    return value;
  };
  const vehicleType = await option("vehicle_type", "vehicle_type");
  const fuelType = await option("fuel_type", "vehicle_fuel");
  return {
    name: String(data.name).trim(),
    plate_no: text(data.plate_no),
    vehicle_type: vehicleType,
    fuel_type: fuelType,
    branch_id: branchId,
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
  const json = await vehicleJson(await findVehicle(id), undefined, true);
  await audit(req, { action: "vehicle.created", subjectType: "vehicle", subjectId: id, after: withoutImages(json) });
  res.status(201).json({ data: json });
});

vehicleRoutes.put("/vehicles/:id", async (req, res) => {
  const current = await managedVehicle(me(req), idParam(req.params.id));
  const v = await vehicleInput(req, current);
  await update("vehicles", { ...v, updated_at: nowDb() }, "id = ?", [current.id]);
  const before = await vehicleJson(current, []);
  const after = await vehicleJson(await findVehicle(current.id), undefined, true);
  await audit(req, { action: "vehicle.updated", subjectType: "vehicle", subjectId: current.id, before: withoutImages(before), after: withoutImages(after) });
  res.json({ data: after });
});

/** ลบได้เมื่อไม่เคยมีการจอง — มีประวัติแล้วให้ปิดใช้งานแทน */
vehicleRoutes.delete("/vehicles/:id", async (req, res) => {
  const current = await managedVehicle(me(req), idParam(req.params.id));
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
  const u = me(req);
  authorize(manages(u) || dispatches(u));
  const { vehicle: v, s } = await visibleVehicle(u, idParam(req.params.id));
  authorize(canManageBranch(s, branchOf(v.branch_id)) || branchOf(v.branch_id) === null);
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

/* ---------------------------------------------------------------- ย้ายสาขา */

/**
 * ย้ายรถไปสาขาอื่น (branch_id = null → ใช้ร่วมกันทุกสาขา เฉพาะขอบเขต all) — ผู้จัดการรถของสาขาต้นทาง
 * การจองที่ยังไม่จบของรถคันนี้คงไว้ (ตอบจำนวนกลับไปให้หน้าเว็บแจ้ง) — ประวัติอยู่ที่ vehicle_transfers
 */
vehicleRoutes.post("/vehicles/:id/transfer", async (req, res) => {
  const u = me(req);
  const vehicle = await managedVehicle(u, idParam(req.params.id));
  const data = await validate(
    req.input,
    {
      branch_id: ["nullable", "integer", custom(async (v) => (await scalar("SELECT 1 FROM branches WHERE id = ?", [Number(v)])) !== null, t(req, "eam.meeting.branch_invalid"))],
      note: ["nullable", "string", "max:1000"],
    },
    { locale: req.locale },
  );
  const to = int(data.branch_id);
  const from = branchOf(vehicle.branch_id);
  if (to === from) throw ValidationError.withMessages({ branch_id: t(req, "eam.vehicle.transfer_same") });
  if (to === null && (await scope(u)).scope !== "all") throw ValidationError.withMessages({ branch_id: t(req, "eam.meeting.branch_scope") });
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  const now = nowDb();
  await transaction(async () => {
    await insert("vehicle_transfers", { vehicle_id: vehicle.id, from_branch_id: from, to_branch_id: to, note, created_by: u.id, created_at: now });
    await update("vehicles", { branch_id: to, updated_at: now }, "id = ?", [vehicle.id]);
  });
  await audit(req, { action: "vehicle.transferred", subjectType: "vehicle", subjectId: vehicle.id, before: { branch_id: from }, after: { branch_id: to, note } });
  const after = await findVehicle(Number(vehicle.id));
  const s = await scope(u);
  res.json({ data: { ...(await vehicleJson(after, undefined, canManageBranch(s, branchOf(after.branch_id)))), upcoming_bookings: await upcomingOf(Number(vehicle.id)) } });
});

/** ประวัติการย้ายสาขา (ล่าสุดก่อน) */
vehicleRoutes.get("/vehicles/:id/transfers", async (req, res) => {
  const u = me(req);
  authorize(manages(u) || dispatches(u));
  const { vehicle } = await visibleVehicle(u, idParam(req.params.id));
  const rows = await select<{ id: number; from_name: string | null; to_name: string | null; from_branch_id: number | null; to_branch_id: number | null; note: string | null; user_name: string | null; created_at: string | null }>(
    `SELECT x.id, x.from_branch_id, x.to_branch_id, x.note, x.created_at, fb.name AS from_name, tb.name AS to_name, u.name AS user_name
       FROM vehicle_transfers x LEFT JOIN branches fb ON fb.id = x.from_branch_id LEFT JOIN branches tb ON tb.id = x.to_branch_id LEFT JOIN users u ON u.id = x.created_by
      WHERE x.vehicle_id = ? ORDER BY x.created_at DESC, x.id DESC LIMIT 200`,
    [vehicle.id],
  );
  const branch = (id: number | null, name: string | null) => (id === null ? null : { id: Number(id), name: name ?? "" });
  res.json({
    data: rows.map((r) => ({ id: Number(r.id), from: branch(r.from_branch_id, r.from_name), to: branch(r.to_branch_id, r.to_name), note: r.note, user_name: r.user_name ?? "", created_at: iso(r.created_at) })),
  });
});

/* ---------------------------------------------------------------- รูปรถ */

vehicleRoutes.post("/vehicles/:id/images", async (req, res) => {
  const vehicle = await managedVehicle(me(req), idParam(req.params.id));
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
  const { vehicle, img } = await findImage(req);
  await managedVehicle(me(req), Number(vehicle.id));
  await transaction(async () => {
    await exec("UPDATE vehicle_images SET is_primary = false WHERE vehicle_id = ?", [vehicle.id]);
    await exec("UPDATE vehicle_images SET is_primary = true WHERE id = ?", [img.id]);
  });
  await audit(req, { action: "vehicle.primary_image", subjectType: "vehicle", subjectId: vehicle.id, after: { image_id: Number(img.id) } });
  res.json({ data: await vehicleJson(await findVehicle(vehicle.id)) });
});

vehicleRoutes.delete("/vehicles/:id/images/:imageId", async (req, res) => {
  const { vehicle, img } = await findImage(req);
  await managedVehicle(me(req), Number(vehicle.id));
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
  vehicle_mileage: number | null;
  vehicle_branch_id: number | null;
  branch_id: number | null;
  branch_name: string | null;
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
  approved_name: string | null;
  approved_at: string | null;
  rejected_name: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const BOOKING_SELECT = `SELECT m.*, v.name AS vehicle_name, v.plate_no, v.mileage AS vehicle_mileage, v.branch_id AS vehicle_branch_id, bb.name AS branch_name, u.name AS user_name, a.name AS assigned_name,
    ap.name AS approved_name, rj.name AS rejected_name
  FROM vehicle_bookings m LEFT JOIN vehicles v ON v.id = m.vehicle_id LEFT JOIN branches bb ON bb.id = m.branch_id
  LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users a ON a.id = m.assigned_by
  LEFT JOIN users ap ON ap.id = m.approved_by LEFT JOIN users rj ON rj.id = m.rejected_by`;

/** ยังมีผล (จองช่วงเวลาของรถไว้): รออนุมัติ + อนุมัติแล้ว */
const ACTIVE = ["pending", "confirmed"];
const isActive = (b: { status: string }) => ACTIVE.includes(b.status);

/**
 * เห็นการจองได้: มีรถแล้ว = รถอยู่ในขอบเขต (รถใช้ร่วมกันเห็นทุกสาขา — ให้รู้ว่ารถไม่ว่าง), ยังไม่มีรถ = สาขาที่ขอใช้อยู่ในขอบเขต
 * จัดการ (ผู้จัดคิว): สาขาที่ขอใช้ หรือสาขาของรถ เป็นสาขาที่จัดการได้ (การจองเดิมที่ไม่มีสาขา = ทุกสาขา)
 */
const seesBooking = (s: ScopeOf, b: BookingRow) => (b.vehicle_id ? canSeeBranch(s, branchOf(b.vehicle_branch_id)) : canSeeBranch(s, branchOf(b.branch_id)));
const managesBooking = (s: ScopeOf, b: BookingRow) =>
  b.branch_id === null || canManageBranch(s, branchOf(b.branch_id)) || (b.vehicle_id !== null && canManageBranch(s, branchOf(b.vehicle_branch_id)));
/** SQL เดียวกับ seesBooking / managesBooking (alias m = vehicle_bookings, v = vehicles) */
function seesWhere(s: ScopeOf, filter?: number | null) {
  const vw = branchWhere("v.branch_id", s, filter);
  const bw = branchWhere("m.branch_id", s, filter);
  return { sql: `((m.vehicle_id IS NOT NULL AND ${vw.sql}) OR (m.vehicle_id IS NULL AND ${bw.sql}))`, params: [...vw.params, ...bw.params] };
}
function managesWhere(s: ScopeOf) {
  if (s.scope === "all") return { sql: "1 = 1", params: [] as unknown[] };
  if (s.branchId === null) return { sql: "m.branch_id IS NULL", params: [] as unknown[] };
  return { sql: "(m.branch_id IS NULL OR m.branch_id = ? OR v.branch_id = ?)", params: [s.branchId, s.branchId] as unknown[] };
}

const startAt = (b: { start_on: string; start_time: string }) => `${dateOnly(b.start_on)} ${b.start_time}`;
const endAt = (b: { end_on: string; end_time: string }) => `${dateOnly(b.end_on)} ${b.end_time}`;
const isOver = (b: { end_on: string; end_time: string }) => endAt(b) <= localNow();
const numOrNull = (v: number | null) => (v === null ? null : Number(v));

async function bookingsJson(rows: BookingRow[], u: UserRow) {
  const s = await scope(u);
  const extras = rows.length ? await select<{ booking_id: number; name: string }>("SELECT booking_id, name FROM vehicle_booking_extras WHERE booking_id IN (?) ORDER BY name", [rows.map((r) => r.id)]) : [];
  return rows.map((r) => {
    const mine = Number(r.user_id) === u.id;
    const over = isOver(r);
    const active = isActive(r);
    const dispatcher = dispatches(u) && managesBooking(s, r);
    const allowed = mine || dispatcher;
    return {
      id: r.uuid,
      // mileage = เลขไมล์ล่าสุดของคัน (ใช้เป็นเลขไมล์เริ่มต้นตอนบันทึก)
      vehicle: r.vehicle_id ? { id: Number(r.vehicle_id), name: r.vehicle_name ?? "", plate_no: r.plate_no, mileage: numOrNull(r.vehicle_mileage) } : null,
      branch: r.branch_id ? { id: Number(r.branch_id), name: r.branch_name ?? "" } : null,
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
      status: r.status as "pending" | "confirmed" | "rejected" | "cancelled",
      is_over: over,
      assigned_by: r.assigned_name,
      assigned_at: iso(r.assigned_at),
      approved_by: r.approved_name,
      approved_at: iso(r.approved_at),
      rejected_by: r.rejected_name,
      rejected_at: iso(r.rejected_at),
      reject_reason: r.reject_reason,
      cancelled_at: iso(r.cancelled_at),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      can_edit: allowed && active && !over,
      can_cancel: allowed && active && !over,
      can_delete: allowed && (!active || !over),
      // เลขไมล์บันทึกได้ทั้งระหว่างและหลังใช้งาน (เมื่อมีรถแล้ว)
      // บันทึกเลขไมล์สิ้นสุดได้ครั้งเดียว (ผู้จัดคิวแก้ได้เสมอ) — mileage_due = ถึงเวลาใช้รถแล้วแต่ยังไม่บันทึก (หน้าเว็บเตือน)
      can_mileage: allowed && r.status === "confirmed" && r.vehicle_id !== null && (r.end_mileage === null || dispatcher),
      mileage_due: mine && r.status === "confirmed" && r.vehicle_id !== null && r.end_mileage === null && startAt(r) <= localNow(),
      // ผู้จองเปลี่ยนรถได้ก่อนอนุมัติเท่านั้น — อนุมัติแล้วเปลี่ยนได้เฉพาะผู้จัดคิว
      can_change_vehicle: active && !over && (r.status === "pending" || dispatcher),
      can_assign: dispatcher && active && !over,
      // ผู้จัดคิวรถของสาขานั้นอนุมัติ / ไม่อนุมัติการจองที่รออนุมัติ
      can_approve: dispatcher && r.status === "pending" && !over,
    };
  });
}

async function findBooking(req: Request): Promise<BookingRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await first<BookingRow>(`${BOOKING_SELECT} WHERE m.uuid = ? AND m.deleted_at IS NULL`, [uuid]) : null;
  if (!row) throw notFound();
  const u = me(req);
  const s = await scope(u);
  if (Number(row.user_id) !== u.id && !seesBooking(s, row) && !(dispatches(u) && managesBooking(s, row))) throw notFound();
  return row;
}
const reload = async (id: number) => (await first<BookingRow>(`${BOOKING_SELECT} WHERE m.id = ?`, [id]))!;

vehicleRoutes.get("/vehicle-bookings", async (req, res) => {
  const u = me(req);
  const f = await validate(
    req.input,
    { from: ["required", regex(DATE)], to: ["required", regex(DATE)], branch_id: ["nullable", "integer"], include_pending: ["nullable", "boolean"] },
    { locale: req.locale },
  );
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  // ในขอบเขตสาขา (ของตัวเองเห็นเสมอเมื่อไม่ได้เลือกกรองสาขา)
  const filter = int(f.branch_id);
  const s = await scope(u);
  const w = seesWhere(s, filter);
  // ปฏิทิน = อนุมัติแล้ว + รออนุมัติของตัวเอง; ผู้จัดคิว (include_pending) = รออนุมัติของสาขาที่จัดการได้ด้วย (ไว้จัดคิว)
  const mw = managesWhere(s);
  const pending = bool(f.include_pending) && dispatches(u) ? `(m.user_id = ? OR ${mw.sql})` : "m.user_id = ?";
  const rows = await select<BookingRow>(
    `${BOOKING_SELECT} WHERE m.deleted_at IS NULL AND m.start_on <= ? AND m.end_on >= ?
        AND (m.status = 'confirmed' OR (m.status = 'pending' AND ${pending}))
        AND ${filter ? w.sql : `(${w.sql} OR m.user_id = ?)`}
      ORDER BY m.start_on, m.start_time, v.sort_order, v.name`,
    [to, from, u.id, ...(bool(f.include_pending) && dispatches(u) ? mw.params : []), ...w.params, ...(filter ? [] : [u.id])],
  );
  res.json({ data: await bookingsJson(rows, u) });
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
  // ยกเลิก = ยกเลิกเอง + ไม่อนุมัติ; ที่จะถึง / ผ่านมาแล้ว = รออนุมัติ + อนุมัติแล้ว
  if (status === "cancelled") where.push("m.status IN ('cancelled', 'rejected')");
  else {
    where.push("m.status IN ('pending', 'confirmed')", status === "upcoming" ? UPCOMING : `NOT ${UPCOMING}`);
    params.push(...upcomingParams());
  }
  const order = status === "upcoming" ? "m.start_on, m.start_time" : "m.start_on DESC, m.start_time DESC";
  res.json({ data: await bookingsJson(await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, params), u) });
});

/** ผู้จัดคิวรถ: pending = รออนุมัติ (ค่าตั้งต้น — unassigned ชื่อเดิม) / upcoming = อนุมัติแล้วที่ยังไม่จบ */
vehicleRoutes.get("/vehicle-bookings/dispatch", async (req, res) => {
  const u = me(req);
  authorize(dispatches(u));
  const f = await validate(req.input, { status: ["nullable", "in:pending,unassigned,upcoming"] }, { locale: req.locale });
  // เฉพาะการจองของสาขาที่จัดการได้
  const mw = managesWhere(await scope(u));
  const pending = (f.status ?? "pending") !== "upcoming";
  const where = ["m.deleted_at IS NULL", pending ? "m.status = 'pending'" : "m.status = 'confirmed'", UPCOMING, mw.sql];
  const rows = await select<BookingRow>(`${BOOKING_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.start_on, m.start_time LIMIT 500`, [...upcomingParams(), ...mw.params]);
  res.json({ data: await bookingsJson(rows, u) });
});

vehicleRoutes.get("/vehicle-bookings/:uuid", async (req, res) => {
  const [json] = await bookingsJson([await findBooking(req)], me(req));
  res.json({ data: json });
});

const activeOptions = async (list: string) => (await select<{ name: string }>("SELECT name FROM dropdown_options WHERE list = ? AND is_active = true", [list])).map((o) => o.name);

/** รถที่เลือกได้: เปิดใช้งาน + อยู่ในขอบเขตสาขา (หรือคันเดิมของการจองนี้) — คืนสาขาของรถ (undefined = เลือกไม่ได้) */
async function vehicleOk(s: ScopeOf, id: number | null, currentId: number | null): Promise<{ branch_id: number | null } | undefined> {
  if (id === null) return { branch_id: null };
  const v = await first<{ is_active: boolean | number; branch_id: number | null }>("SELECT is_active, branch_id FROM vehicles WHERE id = ?", [id]);
  if (!v) return undefined;
  if (id === currentId) return { branch_id: branchOf(v.branch_id) };
  return v.is_active && canSeeBranch(s, branchOf(v.branch_id)) ? { branch_id: branchOf(v.branch_id) } : undefined;
}

async function bookingInput(req: Request, current: BookingRow | null, currentExtras: string[]) {
  const data = await validate(
    req.input,
    {
      vehicle_id: ["nullable", "integer"],
      branch_id: ["nullable", "integer"],
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
  const s = await scope(me(req));
  const picked = await vehicleOk(s, vehicleId, current?.vehicle_id ? Number(current.vehicle_id) : null);
  if (!picked) errors.vehicle_id = t(req, "eam.vehicle.vehicle_invalid");
  // สาขาที่ขอใช้: เลือกรถ = สาขาของรถ (รถใช้ร่วมกัน = สาขาที่เลือก/สาขาเดิม/สาขาของผู้จอง), ไม่เลือกรถ = สาขาที่เลือก (ไม่ส่ง = สาขาของผู้จอง)
  const requested = "branch_id" in req.input ? int(data.branch_id) : current ? branchOf(current.branch_id) : s.branchId;
  if (requested !== null && (!canSeeBranch(s, requested) || (await scalar("SELECT 1 FROM branches WHERE id = ?", [requested])) === null)) {
    errors.branch_id = t(req, canSeeBranch(s, requested) ? "eam.meeting.branch_invalid" : "eam.meeting.branch_scope");
  }
  const branchId = picked?.branch_id ?? requested;
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
    branch_id: branchId,
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
    `${BOOKING_SELECT} WHERE m.vehicle_id = ? AND m.status IN ('pending', 'confirmed') AND m.deleted_at IS NULL
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

/** ผู้จัดคิวรถของสาขาที่ขอใช้ (ขอบเขต all = ทุกสาขา) — เงื่อนไขเดียวกับรายการ/ตัวเลขเมนูจัดคิวรถ */
async function dispatchersFor(branchId: number | null): Promise<number[]> {
  const ids = (await usersWithPermissions(["vehicle.dispatch"])).map((x) => Number(x.id));
  if (!ids.length) return [];
  const users = await select<UserRow>("SELECT * FROM users WHERE id IN (?)", [ids]);
  const out: number[] = [];
  for (const d of users) {
    const own = branchOf(d.branch_id);
    if (branchId === null || own === branchId || (await bookingScope(d, "vehicle")) === "all") out.push(Number(d.id));
  }
  return out;
}

/** แจ้งผู้จัดคิวรถของสาขานั้น (ยกเว้นตัวเอง): มีการจองรออนุมัติ */
async function notifyDispatchers(u: UserRow, b: BookingRow) {
  const ids = (await dispatchersFor(branchOf(b.branch_id))).filter((id) => id !== u.id);
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
/** อนุมัติ / ไม่อนุมัติ / ยกเลิก / ลบ → แจ้งเตือน "รออนุมัติ" ของผู้จัดคิวหมดหน้าที่ */
const resolveRequested = (b: BookingRow) => markNoticesRead("vehicle_booking_id", b.uuid, { events: ["requested"] });

vehicleRoutes.post("/vehicle-bookings", async (req, res) => {
  const u = me(req);
  const v = await bookingInput(req, null, []);
  const { extras, ...row } = v;
  // เลขไมล์ไม่รับจากฟอร์มจอง: เริ่มต้น = เลขไมล์ล่าสุดของคัน, สิ้นสุด = บันทึกตอนคืนรถ
  row.end_mileage = null;
  row.start_mileage = row.vehicle_id ? await currentMileage(row.vehicle_id) : null;
  const now = nowDb();
  // ผู้จัดคิวรถของสาขานั้นจองเองพร้อมเลือกรถ = อนุมัติทันที (ไม่ต้องรอตัวเอง) — คนอื่นรอผู้จัดคิวอนุมัติ
  const autoApprove = row.vehicle_id !== null && dispatches(u) && canManageBranch(await scope(u), branchOf(row.branch_id));
  const id = await transaction(async () => {
    if (row.vehicle_id) {
      await lockNamed(lockKey(row.vehicle_id));
      await assertFree(req, row.vehicle_id, row, null);
    }
    const bookingId = await insert("vehicle_bookings", {
      uuid: randomUUID(), ...row, user_id: u.id, department: u.department, status: autoApprove ? "confirmed" : "pending",
      ...(row.vehicle_id ? { assigned_by: u.id, assigned_at: now } : {}),
      ...(autoApprove ? { approved_by: u.id, approved_at: now } : {}),
      created_at: now, updated_at: now,
    });
    await saveExtras(bookingId, extras);
    return bookingId;
  });
  await bumpMileage(row.vehicle_id, row.start_mileage, row.end_mileage);
  const b = await reload(id);
  await audit(req, { action: "vehicle_booking.created", subjectType: "vehicle_booking", subjectId: id, after: { ...v, status: b.status } });
  if (b.status === "pending") await notifyDispatchers(u, b);
  const [json] = await bookingsJson([b], u);
  res.status(201).json({ data: json });
});

async function assertOwner(u: UserRow, b: BookingRow) {
  authorize(Number(b.user_id) === u.id || (dispatches(u) && managesBooking(await scope(u), b)));
}
/** ผู้จัดคิวแก้/เลือกรถ/ยกเลิก/ลบการจองของคนอื่น → แจ้งเจ้าของ */
async function notifyOwner(u: UserRow, b: BookingRow, event: "updated" | "assigned" | "approved" | "rejected" | "cancelled" | "deleted") {
  if (Number(b.user_id) === u.id) return;
  await notifyUsers([Number(b.user_id)], `vehicle.${event}`, noticeData(u, b, event));
}
const assertActive = (req: Request, b: BookingRow) => {
  if (!isActive(b) || isOver(b)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_editable") });
};
const snapshot = (b: BookingRow, extras: string[]) => ({
  vehicle_id: numOrNull(b.vehicle_id), details: b.details, passengers: Number(b.passengers), purpose: b.purpose, note: b.note,
  start_on: dateOnly(b.start_on), start_time: b.start_time, end_on: dateOnly(b.end_on), end_time: b.end_time,
  start_mileage: numOrNull(b.start_mileage), end_mileage: numOrNull(b.end_mileage), extras,
});

vehicleRoutes.put("/vehicle-bookings/:uuid", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  await assertOwner(u, b);
  assertActive(req, b);
  const currentExtras = (await select<{ name: string }>("SELECT name FROM vehicle_booking_extras WHERE booking_id = ?", [b.id])).map((e) => e.name);
  const v = await bookingInput(req, b, currentExtras);
  const { extras, ...row } = v;
  const vehicleChanged = numOrNull(b.vehicle_id) !== row.vehicle_id;
  const dispatcher = dispatches(u) && managesBooking(await scope(u), b);
  // อนุมัติแล้ว: ผู้จองเปลี่ยนรถไม่ได้ (ขอให้ผู้จัดคิวเปลี่ยน)
  if (b.status === "confirmed" && vehicleChanged && !dispatcher) throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.vehicle_locked") });
  // เลขไมล์ไม่รับจากฟอร์ม: คงค่าเดิม — เปลี่ยนรถ = เริ่มนับจากเลขไมล์ล่าสุดของคันใหม่
  row.start_mileage = vehicleChanged ? (row.vehicle_id ? await currentMileage(row.vehicle_id) : null) : numOrNull(b.start_mileage);
  row.end_mileage = vehicleChanged ? null : numOrNull(b.end_mileage);
  // อนุมัติแล้ว แต่ผู้จองเปลี่ยนเวลา = ต้องให้ผู้จัดคิวอนุมัติใหม่
  const timeChanged = startAt(row) !== startAt(b) || endAt(row) !== endAt(b);
  const requeue = b.status === "confirmed" && timeChanged && !dispatcher;
  await transaction(async () => {
    if (row.vehicle_id) {
      await lockNamed(lockKey(row.vehicle_id));
      await assertFree(req, row.vehicle_id, row, Number(b.id));
    }
    await update(
      "vehicle_bookings",
      {
        ...row,
        ...(vehicleChanged ? { assigned_by: row.vehicle_id ? u.id : null, assigned_at: row.vehicle_id ? nowDb() : null } : {}),
        ...(requeue ? { status: "pending", approved_by: null, approved_at: null } : {}),
        updated_at: nowDb(),
      },
      "id = ?",
      [b.id],
    );
    await saveExtras(Number(b.id), extras);
  });
  await bumpMileage(row.vehicle_id, row.start_mileage, row.end_mileage);
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.updated", subjectType: "vehicle_booking", subjectId: b.id, before: snapshot(b, currentExtras), after: v });
  if (requeue) await notifyDispatchers(u, after);
  await notifyOwner(u, after, "updated");
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/**
 * ผู้จัดคิวรถเลือก / เปลี่ยน / เอารถออก (vehicle_id = null) — ไม่มีเลขไมล์เริ่มต้น = ใช้เลขไมล์ล่าสุดของคัน
 * รออนุมัติ: เปลี่ยนรถก่อนอนุมัติ (ยังไม่แจ้งผู้จอง) / อนุมัติแล้ว: แจ้งผู้จอง — เอารถออกจากการจองที่อนุมัติแล้ว = กลับเป็นรออนุมัติ
 */
vehicleRoutes.put("/vehicle-bookings/:uuid/vehicle", async (req, res) => {
  const u = me(req);
  authorize(dispatches(u));
  const b = await findBooking(req);
  const s = await scope(u);
  authorize(managesBooking(s, b));
  assertActive(req, b);
  const data = await validate(req.input, { vehicle_id: ["nullable", "integer"] }, { locale: req.locale });
  const vehicleId = int(data.vehicle_id);
  if (!(await vehicleOk(s, vehicleId, numOrNull(b.vehicle_id)))) throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.vehicle_invalid") });
  const startMileage = vehicleId && (b.start_mileage === null || numOrNull(b.vehicle_id) !== vehicleId) ? await currentMileage(vehicleId) : numOrNull(b.start_mileage);
  await transaction(async () => {
    if (vehicleId) {
      await lockNamed(lockKey(vehicleId));
      await assertFree(req, vehicleId, { start_on: dateOnly(b.start_on)!, start_time: b.start_time, end_on: dateOnly(b.end_on)!, end_time: b.end_time }, Number(b.id));
    }
    await update(
      "vehicle_bookings",
      {
        vehicle_id: vehicleId, start_mileage: vehicleId ? startMileage : null, end_mileage: vehicleId ? b.end_mileage : null,
        assigned_by: vehicleId ? u.id : null, assigned_at: vehicleId ? nowDb() : null,
        ...(!vehicleId && b.status === "confirmed" ? { status: "pending", approved_by: null, approved_at: null } : {}),
        updated_at: nowDb(),
      },
      "id = ?",
      [b.id],
    );
  });
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.assigned", subjectType: "vehicle_booking", subjectId: b.id, before: { vehicle_id: numOrNull(b.vehicle_id) }, after: { vehicle_id: vehicleId, start_mileage: startMileage } });
  if (after.status === "confirmed") await notifyOwner(u, after, "assigned");
  else if (b.status === "confirmed") await notifyDispatchers(u, after);
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/** ผู้จัดคิวรถของสาขานั้น: การจองรออนุมัติ ที่ยังไม่จบ */
async function pendingForDispatcher(req: Request): Promise<{ u: UserRow; b: BookingRow; s: ScopeOf }> {
  const u = me(req);
  authorize(dispatches(u));
  const b = await findBooking(req);
  const s = await scope(u);
  authorize(managesBooking(s, b));
  if (b.status !== "pending" || isOver(b)) throw ValidationError.withMessages({ status: t(req, "eam.vehicle.not_pending") });
  return { u, b, s };
}

/** อนุมัติ { vehicle_id? } — เลือก/เปลี่ยนรถพร้อมอนุมัติได้ (ต้องมีรถ, ตรวจรถว่าง) → ขึ้นปฏิทิน + แจ้งผู้จอง */
vehicleRoutes.post("/vehicle-bookings/:uuid/approve", async (req, res) => {
  const { u, b, s } = await pendingForDispatcher(req);
  const data = await validate(req.input, { vehicle_id: ["nullable", "integer"] }, { locale: req.locale });
  const vehicleId = "vehicle_id" in req.input && data.vehicle_id !== null ? int(data.vehicle_id) : numOrNull(b.vehicle_id);
  if (!vehicleId) throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.need_vehicle") });
  if (!(await vehicleOk(s, vehicleId, numOrNull(b.vehicle_id)))) throw ValidationError.withMessages({ vehicle_id: t(req, "eam.vehicle.vehicle_invalid") });
  const changed = vehicleId !== numOrNull(b.vehicle_id);
  const startMileage = changed || b.start_mileage === null ? await currentMileage(vehicleId) : numOrNull(b.start_mileage);
  const now = nowDb();
  await transaction(async () => {
    await lockNamed(lockKey(vehicleId));
    await assertFree(req, vehicleId, { start_on: dateOnly(b.start_on)!, start_time: b.start_time, end_on: dateOnly(b.end_on)!, end_time: b.end_time }, Number(b.id));
    // ล็อกแถวแล้วตรวจสถานะซ้ำ (กันผู้จัดคิว 2 คนกดพร้อมกัน / ผู้จองยกเลิกพอดี)
    const locked = await first<{ status: string }>("SELECT status FROM vehicle_bookings WHERE id = ? FOR UPDATE", [b.id]);
    if (locked?.status !== "pending") throw ValidationError.withMessages({ status: t(req, "eam.vehicle.not_pending") });
    await update(
      "vehicle_bookings",
      {
        status: "confirmed", vehicle_id: vehicleId, start_mileage: startMileage, approved_by: u.id, approved_at: now,
        ...(changed ? { assigned_by: u.id, assigned_at: now } : {}),
        updated_at: now,
      },
      "id = ?",
      [b.id],
    );
  });
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.approved", subjectType: "vehicle_booking", subjectId: b.id, before: { status: b.status, vehicle_id: numOrNull(b.vehicle_id) }, after: { status: "confirmed", vehicle_id: vehicleId } });
  await resolveRequested(after);
  await notifyOwner(u, after, "approved");
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/** ไม่อนุมัติ { reason } (บังคับ) → แจ้งผู้จอง — คืนช่วงเวลาของรถ */
vehicleRoutes.post("/vehicle-bookings/:uuid/reject", async (req, res) => {
  const { u, b } = await pendingForDispatcher(req);
  const data = await validate(req.input, { reason: ["required", "string", "max:1000", regex(/\S/)] }, { locale: req.locale });
  const now = nowDb();
  await update("vehicle_bookings", { status: "rejected", rejected_by: u.id, rejected_at: now, reject_reason: String(data.reason).trim(), updated_at: now }, "id = ? AND status = 'pending'", [b.id]);
  const after = await reload(Number(b.id));
  await audit(req, { action: "vehicle_booking.rejected", subjectType: "vehicle_booking", subjectId: b.id, before: { status: b.status }, after: { status: after.status, reason: after.reject_reason } });
  await resolveRequested(after);
  await notifyOwner(u, after, "rejected");
  const [json] = await bookingsJson([after], u);
  res.json({ data: json });
});

/** บันทึกเลขไมล์ (ระหว่าง / หลังใช้งาน) — เจ้าของการจอง หรือผู้จัดคิวรถ */
vehicleRoutes.put("/vehicle-bookings/:uuid/mileage", async (req, res) => {
  const u = me(req);
  const b = await findBooking(req);
  await assertOwner(u, b);
  if (b.status !== "confirmed" || !b.vehicle_id) throw ValidationError.withMessages({ start_mileage: t(req, "eam.vehicle.mileage_no_vehicle") });
  // ผู้จองบันทึกเลขไมล์สิ้นสุดได้ครั้งเดียว — ผู้จัดคิวแก้ได้ (รวมเลขไมล์เริ่มต้น)
  const dispatcher = dispatches(u) && managesBooking(await scope(u), b);
  if (!dispatcher && b.end_mileage !== null) throw ValidationError.withMessages({ end_mileage: t(req, "eam.vehicle.mileage_locked") });
  const data = await validate(
    req.input,
    {
      start_mileage: ["nullable", "integer", "min:0", `max:${MAX_MILEAGE}`],
      end_mileage: [dispatcher ? "nullable" : "required", "integer", "min:0", `max:${MAX_MILEAGE}`],
    },
    { locale: req.locale },
  );
  // เลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคัน ณ ตอนบันทึก (เลขไมล์สิ้นสุดตอนคืนรถครั้งก่อน) — ผู้จัดคิวระบุเองได้
  const start = dispatcher && "start_mileage" in req.input ? int(data.start_mileage) : ((await currentMileage(Number(b.vehicle_id))) ?? numOrNull(b.start_mileage));
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
  await assertOwner(u, b);
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
  await assertOwner(u, b);
  if (b.status === "confirmed" && isOver(b)) throw ValidationError.withMessages({ status: t(req, "eam.meeting.not_deletable") });
  await update("vehicle_bookings", { deleted_at: nowDb() }, "id = ?", [b.id]);
  await audit(req, { action: "vehicle_booking.deleted", subjectType: "vehicle_booking", subjectId: b.id, before: snapshot(b, []) });
  await resolveRequested(b);
  if (isActive(b)) await notifyOwner(u, b, "deleted");
  res.status(204).end();
});

/** ตัวเลขเมนู "จัดคิวรถ" = การจองรออนุมัติที่ยังไม่จบ ของสาขาที่ผู้จัดคิวดูแล (เงื่อนไขเดียวกับผู้รับแจ้งเตือน requested) */
export async function pendingVehicleBookings(u: UserRow): Promise<number> {
  const mw = managesWhere(await scope(u));
  return Number(
    await scalar(
      `SELECT COUNT(*) FROM vehicle_bookings m LEFT JOIN vehicles v ON v.id = m.vehicle_id
        WHERE m.deleted_at IS NULL AND m.status = 'pending' AND ${UPCOMING} AND ${mw.sql}`,
      [...upcomingParams(), ...mw.params],
    ),
  );
}
