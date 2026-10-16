import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, insert, isUuid, lockNamed, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { int, regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audit } from "../services/audit.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { usersWithPermissions } from "../services/permissions.js";
import { IT_STAFF_WHERE } from "../services/ticket-workflow.js";

/**
 * ยืมอุปกรณ์ IT — อุปกรณ์ = สินทรัพย์ที่เจ้าหน้าที่ IT ถือครอง (IT_STAFF_WHERE) สถานะใช้งาน / เก็บในคลัง
 *   ทุกคน: GET /loan-devices?from=&to= (อุปกรณ์ + ว่าง/ไม่ว่างในช่วงนั้น), GET /loans?from=&to= (ปฏิทิน), GET /loans/mine?status=active|past|cancelled,
 *          GET /loans/:uuid, POST /loans, PUT /loans/:uuid + POST /loans/:uuid/cancel (ของตัวเอง ระหว่างยังไม่ส่งมอบ)
 *   loans.manage: GET /loans/manage?status=pending|on_loan|overdue|all, POST /loans/:uuid/hand-out (ส่งมอบ), POST /loans/:uuid/return (รับคืน),
 *          แก้ / ยกเลิกการจองของผู้อื่น (แจ้งเตือนเจ้าของ)
 *   สถานะ: reserved (จองแล้ว รอส่งมอบ) → on_loan (ยืมอยู่) → returned (คืนแล้ว) / cancelled — ห้ามลบ (เก็บเป็นประวัติ)
 *   ช่วงเวลา = start_on + start_time ถึง end_on + end_time ("HH:MM" เวลาไทย) — อุปกรณ์เดียวกันช่วงซ้อน (reserved / on_loan) = 422
 *   เกินกำหนด = on_loan และเลยวันเวลาคืน — แจ้งผู้ยืม + ผู้จัดการ วันละครั้ง (notifyOverdueLoans ใน jobs/scheduler.ts)
 */
export const loanRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 90;
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);
const manages = (u: UserRow) => can(u, "loans.manage");

/** วันเวลาปัจจุบัน "YYYY-MM-DD HH:MM" ตามเขตเวลาของผู้ใช้ */
function localNow(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: config.localTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const startAt = (b: { start_on: string; start_time: string }) => `${dateOnly(b.start_on)} ${b.start_time}`;
const endAt = (b: { end_on: string; end_time: string }) => `${dateOnly(b.end_on)} ${b.end_time}`;
const isPast = (b: { end_on: string; end_time: string }) => endAt(b) <= localNow();

/** เลยกำหนดคืนแล้ว (SQL — alias l) */
const OVERDUE = "(l.status = 'on_loan' AND (l.end_on < ? OR (l.end_on = ? AND l.end_time <= ?)))";
const overdueParams = () => {
  const now = localNow();
  return [now.slice(0, 10), now.slice(0, 10), now.slice(11)];
};

/* ---------------------------------------------------------------- อุปกรณ์ */

interface DeviceRow {
  id: number;
  asset_tag: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  custodian_name: string | null;
}

/** อุปกรณ์ที่ให้ยืมได้ = สินทรัพย์ (ไม่ถูกลบ, ใช้งาน / เก็บในคลัง) ที่ผู้ถือครองเป็นเจ้าหน้าที่ IT */
const DEVICE_WHERE = `a.deleted_at IS NULL AND a.status IN ('active', 'in_storage') AND a.custodian_id IN (SELECT id FROM users WHERE ${IT_STAFF_WHERE})`;
const DEVICE_SELECT = `SELECT a.id, a.asset_tag, a.name, a.category, a.brand, a.model, c.name AS custodian_name FROM assets a LEFT JOIN users c ON c.id = a.custodian_id`;

const deviceJson = (d: DeviceRow) => ({
  id: Number(d.id),
  asset_tag: d.asset_tag,
  name: d.name,
  category: d.category,
  brand: d.brand,
  model: d.model,
  custodian: d.custodian_name,
});

loanRoutes.get("/loan-devices", async (req, res) => {
  const f = await validate(req.input, { from: ["nullable", regex(DATE)], to: ["nullable", regex(DATE)] }, { locale: req.locale });
  const devices = await select<DeviceRow>(`${DEVICE_SELECT} WHERE ${DEVICE_WHERE} ORDER BY a.category, a.name, a.asset_tag`);
  // ยืมอยู่ตอนนี้ (ยังไม่คืน) — แสดงสถานะในรายการอุปกรณ์
  const onLoan = await select<{ asset_id: number; user_name: string | null; end_on: string; end_time: string }>(
    "SELECT l.asset_id, u.name AS user_name, l.end_on, l.end_time FROM equipment_loans l LEFT JOIN users u ON u.id = l.user_id WHERE l.status = 'on_loan'",
  );
  const from = typeof f.from === "string" ? f.from : null;
  const to = typeof f.to === "string" ? f.to : from;
  res.json({
    data: devices.map((d) => {
      const loan = onLoan.find((l) => Number(l.asset_id) === Number(d.id));
      return {
        ...deviceJson(d),
        on_loan: loan ? { user: loan.user_name ?? "", end_on: dateOnly(loan.end_on), end_time: loan.end_time, is_overdue: isPast(loan) } : null,
      };
    }),
    meta: { from, to, can_manage: manages(me(req)) },
  });
});

/* ---------------------------------------------------------------- การยืม */

interface LoanRow {
  id: number;
  uuid: string;
  asset_id: number;
  asset_tag: string;
  asset_name: string;
  asset_category: string;
  user_id: number;
  user_name: string | null;
  department: string | null;
  purpose: string;
  note: string | null;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
  status: string;
  handed_out_at: string | null;
  handed_name: string | null;
  returned_at: string | null;
  returned_name: string | null;
  return_note: string | null;
  cancelled_at: string | null;
  created_at: string | null;
}

const LOAN_SELECT = `SELECT l.*, a.asset_tag, a.name AS asset_name, a.category AS asset_category, u.name AS user_name, h.name AS handed_name, r.name AS returned_name
  FROM equipment_loans l JOIN assets a ON a.id = l.asset_id LEFT JOIN users u ON u.id = l.user_id
  LEFT JOIN users h ON h.id = l.handed_out_by LEFT JOIN users r ON r.id = l.returned_by`;

function loanJson(r: LoanRow, u: UserRow) {
  const mine = Number(r.user_id) === u.id;
  const reserved = r.status === "reserved";
  const past = isPast(r);
  return {
    id: r.uuid,
    asset: { id: Number(r.asset_id), asset_tag: r.asset_tag, name: r.asset_name, category: r.asset_category },
    user: { id: Number(r.user_id), name: r.user_name ?? "" },
    department: r.department,
    purpose: r.purpose,
    note: r.note,
    start_on: dateOnly(r.start_on)!,
    start_time: r.start_time,
    end_on: dateOnly(r.end_on)!,
    end_time: r.end_time,
    status: r.status as "reserved" | "on_loan" | "returned" | "cancelled",
    is_overdue: r.status === "on_loan" && past,
    handed_out_at: iso(r.handed_out_at),
    handed_out_by: r.handed_name,
    returned_at: iso(r.returned_at),
    returned_by: r.returned_name,
    return_note: r.return_note,
    cancelled_at: iso(r.cancelled_at),
    created_at: iso(r.created_at),
    // ผู้ยืมแก้ / ยกเลิกได้ระหว่างยังไม่ส่งมอบ — ผู้จัดการทำแทนได้
    can_edit: (mine || manages(u)) && reserved && !past,
    can_cancel: (mine || manages(u)) && reserved,
    can_hand_out: manages(u) && reserved,
    can_return: manages(u) && r.status === "on_loan",
  };
}

async function findLoan(req: Request): Promise<LoanRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await first<LoanRow>(`${LOAN_SELECT} WHERE l.uuid = ?`, [uuid]) : null;
  if (!row) throw notFound();
  return row;
}
const reload = async (id: number) => (await first<LoanRow>(`${LOAN_SELECT} WHERE l.id = ?`, [id]))!;

loanRoutes.get("/loans", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { from: ["required", regex(DATE)], to: ["required", regex(DATE)], asset_id: ["nullable", "integer"] }, { locale: req.locale });
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  const where = ["l.status <> 'cancelled'", "l.start_on <= ?", "l.end_on >= ?"];
  const params: unknown[] = [to, from];
  if (int(f.asset_id)) (where.push("l.asset_id = ?"), params.push(int(f.asset_id)));
  const rows = await select<LoanRow>(`${LOAN_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.start_on, l.start_time, a.name`, params);
  res.json({ data: rows.map((r) => loanJson(r, u)) });
});

/** การยืมของฉัน: active = จอง / ยืมอยู่, past = คืนแล้ว, cancelled = ยกเลิก */
loanRoutes.get("/loans/mine", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { status: ["nullable", "in:active,past,cancelled"] }, { locale: req.locale });
  const status = (f.status as string) ?? "active";
  const filter = { active: "l.status IN ('reserved', 'on_loan')", past: "l.status = 'returned'", cancelled: "l.status = 'cancelled'" }[status]!;
  const order = status === "active" ? "l.start_on, l.start_time" : "l.start_on DESC, l.start_time DESC";
  const rows = await select<LoanRow>(`${LOAN_SELECT} WHERE l.user_id = ? AND ${filter} ORDER BY ${order} LIMIT 500`, [u.id]);
  res.json({ data: rows.map((r) => loanJson(r, u)) });
});

/** ผู้จัดการ: pending = รอส่งมอบ, on_loan = ยืมอยู่, overdue = เกินกำหนดคืน, all = ทั้งหมด (ล่าสุดก่อน) */
loanRoutes.get("/loans/manage", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const f = await validate(req.input, { status: ["nullable", "in:pending,on_loan,overdue,all"] }, { locale: req.locale });
  const status = (f.status as string) ?? "pending";
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "pending") where.push("l.status = 'reserved'");
  if (status === "on_loan") where.push("l.status = 'on_loan'");
  if (status === "overdue") (where.push(OVERDUE), params.push(...overdueParams()));
  const order = status === "all" ? "l.start_on DESC, l.start_time DESC" : "l.end_on, l.end_time";
  const rows = await select<LoanRow>(`${LOAN_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 500`, params);
  res.json({ data: rows.map((r) => loanJson(r, u)) });
});

loanRoutes.get("/loans/:uuid", async (req, res) => {
  const u = me(req);
  const r = await findLoan(req);
  res.json({ data: loanJson(r, u) });
});

async function loanInput(req: Request, current: LoanRow | null) {
  const data = await validate(
    req.input,
    {
      asset_id: ["required", "integer"],
      purpose: ["required", "string", "max:2000", regex(/\S/)],
      note: ["nullable", "string", "max:2000"],
      start_on: ["required", regex(DATE)],
      start_time: ["required", regex(TIME)],
      end_on: ["required", regex(DATE)],
      end_time: ["required", regex(TIME)],
    },
    { locale: req.locale },
  );
  const errors: Record<string, string> = {};
  const assetId = int(data.asset_id)!;
  // อุปกรณ์ต้องให้ยืมได้ (อุปกรณ์เดิมของการจองนี้คงไว้ได้ แม้ภายหลังย้ายผู้ถือครองแล้ว)
  if (assetId !== Number(current?.asset_id) && !(await first(`SELECT 1 AS x FROM assets a WHERE a.id = ? AND ${DEVICE_WHERE}`, [assetId]))) {
    errors.asset_id = t(req, "eam.loan.device_invalid");
  }
  const v = { start_on: String(data.start_on), start_time: String(data.start_time), end_on: String(data.end_on), end_time: String(data.end_time) };
  const days = (new Date(v.end_on).getTime() - new Date(v.start_on).getTime()) / 86_400_000;
  if (endAt(v) <= startAt(v)) errors.end_time = t(req, "eam.meeting.time_order");
  else if (days > MAX_DAYS) errors.end_on = t(req, "eam.loan.too_long", { days: MAX_DAYS });
  else if (isPast(v)) errors.end_on = t(req, "eam.meeting.past");
  if (Object.keys(errors).length) throw ValidationError.withMessages(errors);
  return {
    asset_id: assetId,
    purpose: String(data.purpose).trim(),
    note: typeof data.note === "string" && data.note.trim() ? data.note.trim() : null,
    ...v,
  };
}

/** อุปกรณ์เดียวกัน ช่วงเวลาซ้อน (จอง / ยืมอยู่) — เรียกใน transaction หลัง lock */
async function assertFree(req: Request, v: { asset_id: number; start_on: string; start_time: string; end_on: string; end_time: string }, exceptId: number | null) {
  const clash = await first<LoanRow>(
    `${LOAN_SELECT} WHERE l.asset_id = ? AND l.status IN ('reserved', 'on_loan') AND l.start_on <= ? AND l.end_on >= ?
        AND CONCAT(l.start_on, ' ', l.start_time) < ? AND CONCAT(l.end_on, ' ', l.end_time) > ?${exceptId ? " AND l.id <> ?" : ""}
      ORDER BY l.start_on, l.start_time LIMIT 1`,
    [v.asset_id, v.end_on, v.start_on, endAt(v), startAt(v), ...(exceptId ? [exceptId] : [])],
  );
  if (clash) {
    const period = dateOnly(clash.start_on) === dateOnly(clash.end_on) ? `${dateOnly(clash.start_on)} ${clash.start_time}–${clash.end_time}` : `${startAt(clash)} – ${endAt(clash)}`;
    throw ValidationError.withMessages({ asset_id: t(req, "eam.loan.overlap", { device: clash.asset_name, period, name: clash.user_name ?? "-" }) });
  }
}
const lockKey = (assetId: number) => `equipment_loan:${assetId}`;

const noticeData = (u: UserRow | null, r: LoanRow, event: string) => ({
  kind: "loan",
  event,
  loan_id: r.uuid,
  actor: u?.name ?? null,
  device: `${r.asset_tag} ${r.asset_name}`,
  start_on: dateOnly(r.start_on),
  start_time: r.start_time,
  end_on: dateOnly(r.end_on),
  end_time: r.end_time,
});
const managerIds = async () => (await usersWithPermissions(["loans.manage"])).map((x) => Number(x.id));

/** ผู้จัดการทำกับการยืมของคนอื่น → แจ้งเจ้าของ */
async function notifyOwner(u: UserRow, r: LoanRow, event: "updated" | "cancelled" | "handed_out" | "returned") {
  if (Number(r.user_id) === u.id) return;
  await notifyUsers([Number(r.user_id)], `loan.${event}`, noticeData(u, r, event));
}
const resolve = (r: LoanRow, events: string[]) => markNoticesRead("loan_id", r.uuid, { events });

loanRoutes.post("/loans", async (req, res) => {
  const u = me(req);
  const v = await loanInput(req, null);
  const now = nowDb();
  const id = await transaction(async () => {
    await lockNamed(lockKey(v.asset_id));
    await assertFree(req, v, null);
    return insert("equipment_loans", { uuid: randomUUID(), ...v, user_id: u.id, department: u.department, status: "reserved", created_at: now, updated_at: now });
  });
  const r = await reload(id);
  await audit(req, { action: "equipment_loan.created", subjectType: "equipment_loan", subjectId: id, after: v });
  // รอส่งมอบ → ผู้จัดการ (ยกเว้นตัวเอง)
  const ids = (await managerIds()).filter((x) => x !== u.id);
  if (ids.length) await notifyUsers(ids, "loan.requested", noticeData(u, r, "requested"));
  res.status(201).json({ data: loanJson(r, u) });
});

function assertOwner(u: UserRow, r: LoanRow) {
  authorize(Number(r.user_id) === u.id || manages(u));
}

loanRoutes.put("/loans/:uuid", async (req, res) => {
  const u = me(req);
  const r = await findLoan(req);
  assertOwner(u, r);
  if (r.status !== "reserved" || isPast(r)) throw ValidationError.withMessages({ status: t(req, "eam.loan.not_editable") });
  const v = await loanInput(req, r);
  await transaction(async () => {
    await lockNamed(lockKey(v.asset_id));
    await assertFree(req, v, Number(r.id));
    await update("equipment_loans", { ...v, updated_at: nowDb() }, "id = ?", [r.id]);
  });
  const after = await reload(Number(r.id));
  await audit(req, {
    action: "equipment_loan.updated", subjectType: "equipment_loan", subjectId: r.id,
    before: { asset_id: Number(r.asset_id), purpose: r.purpose, note: r.note, start_on: dateOnly(r.start_on), start_time: r.start_time, end_on: dateOnly(r.end_on), end_time: r.end_time },
    after: v,
  });
  await notifyOwner(u, after, "updated");
  res.json({ data: loanJson(after, u) });
});

loanRoutes.post("/loans/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const r = await findLoan(req);
  assertOwner(u, r);
  if (r.status !== "reserved") throw ValidationError.withMessages({ status: t(req, "eam.loan.not_editable") });
  const now = nowDb();
  await update("equipment_loans", { status: "cancelled", cancelled_at: now, cancelled_by: u.id, updated_at: now }, "id = ?", [r.id]);
  await audit(req, { action: "equipment_loan.cancelled", subjectType: "equipment_loan", subjectId: r.id, before: { status: r.status } });
  await resolve(r, ["requested"]);
  await notifyOwner(u, r, "cancelled");
  res.json({ data: loanJson(await reload(Number(r.id)), u) });
});

/** ส่งมอบอุปกรณ์ (ผู้จัดการ) — อุปกรณ์ต้องไม่ถูกยืมค้างอยู่ (การยืมก่อนหน้ายังไม่คืน) */
loanRoutes.post("/loans/:uuid/hand-out", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const r = await findLoan(req);
  if (r.status !== "reserved") throw ValidationError.withMessages({ status: t(req, "eam.loan.not_reserved") });
  await transaction(async () => {
    await lockNamed(lockKey(Number(r.asset_id)));
    const busy = await first<{ user_name: string | null }>(
      "SELECT u.name AS user_name FROM equipment_loans l LEFT JOIN users u ON u.id = l.user_id WHERE l.asset_id = ? AND l.status = 'on_loan' AND l.id <> ? LIMIT 1",
      [r.asset_id, r.id],
    );
    if (busy) throw ValidationError.withMessages({ status: t(req, "eam.loan.still_on_loan", { name: busy.user_name ?? "-" }) });
    const now = nowDb();
    await update("equipment_loans", { status: "on_loan", handed_out_at: now, handed_out_by: u.id, updated_at: now }, "id = ?", [r.id]);
  });
  const after = await reload(Number(r.id));
  await audit(req, { action: "equipment_loan.handed_out", subjectType: "equipment_loan", subjectId: r.id, after: { status: "on_loan" } });
  await resolve(r, ["requested"]);
  await notifyOwner(u, after, "handed_out");
  res.json({ data: loanJson(after, u) });
});

/** รับคืนอุปกรณ์ (ผู้จัดการ) { note } — สภาพ / หมายเหตุตอนคืน */
loanRoutes.post("/loans/:uuid/return", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const r = await findLoan(req);
  if (r.status !== "on_loan") throw ValidationError.withMessages({ status: t(req, "eam.loan.not_on_loan") });
  const data = await validate(req.input, { note: ["nullable", "string", "max:2000"] }, { locale: req.locale });
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  const now = nowDb();
  await update("equipment_loans", { status: "returned", returned_at: now, returned_by: u.id, return_note: note, updated_at: now }, "id = ?", [r.id]);
  const after = await reload(Number(r.id));
  await audit(req, { action: "equipment_loan.returned", subjectType: "equipment_loan", subjectId: r.id, after: { status: "returned", note, overdue: isPast(r) } });
  // คืนแล้ว → แจ้งเตือน "เกินกำหนด" ของทุกคนหมดหน้าที่
  await resolve(r, ["overdue", "requested"]);
  await notifyOwner(u, after, "returned");
  res.json({ data: loanJson(after, u) });
});

/* ---------------------------------------------------------------- ตัวเลขเมนู / แจ้งเตือนเกินกำหนด */

/** ตัวเลขเมนู: /loans/manage = รอส่งมอบที่ถึงวันแล้ว + เกินกำหนดคืน (ผู้จัดการ), /loans/mine = ของฉันที่เกินกำหนดคืน */
export async function loanBadges(u: UserRow): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const p = overdueParams();
  out["/loans/mine"] = Number(await scalar(`SELECT COUNT(*) FROM equipment_loans l WHERE l.user_id = ? AND ${OVERDUE}`, [u.id, ...p]));
  if (manages(u)) {
    out["/loans/manage"] = Number(
      await scalar(`SELECT COUNT(*) FROM equipment_loans l WHERE (l.status = 'reserved' AND l.start_on <= ?) OR ${OVERDUE}`, [localToday(), ...p]),
    );
  }
  return out;
}

/**
 * แจ้งเตือนเกินกำหนดคืน (ผู้ยืม + ผู้จัดการ) วันละครั้งต่อรายการ — เรียกจาก scheduler ทุกชั่วโมง
 * คืนจำนวนรายการที่แจ้ง
 */
export async function notifyOverdueLoans(): Promise<number> {
  const today = localToday();
  const rows = await select<LoanRow>(
    `${LOAN_SELECT} WHERE ${OVERDUE} AND (l.overdue_notified_on IS NULL OR l.overdue_notified_on < ?) ORDER BY l.end_on, l.end_time`,
    [...overdueParams(), today],
  );
  if (!rows.length) return 0;
  const managers = await managerIds();
  for (const r of rows) {
    // แจ้งเตือนเกินกำหนดของวันก่อนอ่านแล้ว (เหลือของวันนี้รายการเดียว)
    await resolve(r, ["overdue"]);
    await notifyUsers([...new Set([Number(r.user_id), ...managers])], "loan.overdue", noticeData(null, r, "overdue"));
    await exec("UPDATE equipment_loans SET overdue_notified_on = ? WHERE id = ?", [today, r.id]);
  }
  return rows.length;
}
