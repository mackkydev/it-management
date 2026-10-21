import { randomBytes, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { Router, type Request, type Response } from "express";
import { exec, first, insert, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { int, regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, rolesAbove, type UserRow } from "../models/user.js";
import { cellValue, toIsoDate } from "../services/asset-import.js";
import { normDept, planFor } from "../services/approval-routes.js";
import { editableGroupKeys, keepLockedGroups } from "../services/access-control.js";
import { canFor, scopeOf, scopeWhere } from "../services/manage-scope.js";
import { audit } from "../services/audit.js";
import {
  allowedScopes, busyOf, calendarItems, datesBetween, findUserByCalendarToken, holidayCalendarFor, leaveDays, weekdayRuns, leaveSettings, LEAVE_TYPES, LEAVE_UNITS, maxScope,
  scopeSettings, SCOPES, toIcs, type LeaveSettings, type LeaveType, type LeaveUnit, type Scope,
} from "../services/calendar.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { activeSignature, readSignature } from "../services/signatures.js";
import { putSetting } from "../services/settings.js";
import { readStored, storeUploadIn } from "../services/ticket-files.js";

/**
 * ปฏิทิน + การลา + วันหยุดบริษัท + กิจกรรม + iCal
 *   GET  /calendar?from=&to=&scope=&branch_id=        รายการในปฏิทิน (ตามขอบเขตของกลุ่ม)
 *   GET  /calendar/meta                               ขอบเขตที่เลือกได้ / ลิงก์ iCal
 *   GET  /calendar/busy?user_ids=&from=&to=           วันไม่ว่าง (ลา / หน้างาน) — เตือนตอนรับงาน/เลือกเจ้าหน้าที่
 *   POST/PUT/DELETE /calendar/events[/:id]            กิจกรรมทั่วไป
 *   GET/PUT /calendar/scope                           ขอบเขตต่อกลุ่ม (ผู้ดูแลระบบสูงสุด)
 *   POST/DELETE /calendar/token                       สร้าง/ยกเลิกลิงก์ iCal ส่วนตัว
 *   GET  /calendar/feed/:token                        .ics (public — ใช้ token)
 *   ใบลา: /leave, /leave/options, /leave/balance, /leave/approvals, /leave/export, /leave/:uuid(/approve|reject|cancel|files/:id|signature/:who)
 *   ตั้งค่าการลา: GET/PUT /leave/settings, GET/PUT /leave/quotas
 *   วันหยุด: /holidays (+ /copy-year, /import-template, /import)
 */
export const calendarRoutes = Router();
/** ไม่ต้อง login — ลิงก์ iCal ใช้ token */
export const publicCalendarRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const manages = (u: UserRow) => can(u, "holidays.manage");
/**
 * ขอบเขตการจัดการตามสาขา (services/manage-scope.ts) ของ holidays.manage:
 * สาขาตัวเอง = วันหยุดในชุดของสาขาตัวเอง + โควตา/กิจกรรมของคนในสาขา — ตั้งค่าการลา / ชุดวันหยุด / กิจกรรมทั้งบริษัท = ทุกสาขาเท่านั้น
 */
const managesAll = async (u: UserRow) => (await scopeOf(u, "holidays.manage")) === "all";
async function managesCalendar(u: UserRow, calendarId: number): Promise<boolean> {
  const scope = await scopeOf(u, "holidays.manage");
  if (scope === "all") return true;
  return scope === "branch" && Boolean(u.branch_id) && calendarId === (await holidayCalendarFor(Number(u.branch_id)));
}
async function assertCalendar(req: Request, calendarId: number) {
  if (!(await managesCalendar(me(req), calendarId))) throw ValidationError.withMessages({ calendar_id: t(req, "eam.holiday.branch_scope") });
}
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, key, replace);

/* ---------------------------------------------------------------- ปฏิทิน */

async function rangeOf(req: Request) {
  const f = await validate(
    req.input,
    { from: ["required", regex(DATE)], to: ["required", regex(DATE)], scope: ["nullable", `in:${SCOPES.join(",")}`], branch_id: ["nullable", "integer"] },
    { locale: req.locale },
  );
  const from = String(f.from);
  const to = String(f.to) < from ? from : String(f.to);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 120) throw ValidationError.withMessages({ to: t(req, "eam.calendar.range_too_long") });
  return { from, to, scope: f.scope as Scope | null, branchId: int(f.branch_id) };
}

calendarRoutes.get("/calendar", async (req, res) => {
  const u = me(req);
  const { from, to, scope, branchId } = await rangeOf(req);
  const max = await maxScope(u);
  const chosen = scope && allowedScopes(max).includes(scope) ? scope : max;
  res.json({ data: await calendarItems(u, { from, to, scope: chosen, branchId: chosen === "all" ? branchId : null, locale: req.locale, canManage: manages(u) }), meta: { scope: chosen } });
});

calendarRoutes.get("/calendar/meta", async (req, res) => {
  const u = me(req);
  const max = await maxScope(u);
  res.json({ data: { max_scope: max, scopes: allowedScopes(max), can_manage: manages(u), feed_token: u.calendar_token ?? null } });
});

calendarRoutes.get("/calendar/busy", async (req, res) => {
  const f = await validate(req.input, { user_ids: ["nullable", "string", "max:500"], from: ["required", regex(DATE)], to: ["required", regex(DATE)] }, { locale: req.locale });
  // ไม่ระบุ = ตัวเอง (ฟอร์มรับงาน)
  const ids = f.user_ids ? String(f.user_ids).split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : [me(req).id];
  const busy = await busyOf(ids, String(f.from), String(f.to));
  res.json({ data: Object.fromEntries([...busy.entries()].map(([id, list]) => [id, list])) });
});

/* ---------------------------------------------------------------- กิจกรรมทั่วไป */

async function eventInput(req: Request, u: UserRow) {
  const data = await validate(
    req.input,
    {
      title: ["required", "string", "max:255"],
      start_on: ["required", regex(DATE)],
      end_on: ["required", regex(DATE), "after_or_equal:start_on"],
      note: ["nullable", "string", "max:2000"],
      all_company: ["sometimes", "boolean"],
      skip_weekends: ["sometimes", "boolean"],
    },
    { locale: req.locale },
  );
  // ไม่รวมเสาร์-อาทิตย์: มีผลเฉพาะช่วงที่คร่อมสุดสัปดาห์ — ช่วงที่มีแต่เสาร์-อาทิตย์ = ไม่มีวันให้แสดง
  const skip = data.skip_weekends === true || data.skip_weekends === "1" || data.skip_weekends === 1;
  const runs = skip ? weekdayRuns(String(data.start_on), String(data.end_on)) : [];
  if (skip && runs.length === 0) throw ValidationError.withMessages({ skip_weekends: t(req, "eam.calendar.weekend_only") });
  const hasWeekend = skip && datesBetween(String(data.start_on), String(data.end_on)).some((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  return {
    title: String(data.title).trim(),
    start_on: data.start_on,
    end_on: data.end_on,
    note: typeof data.note === "string" && data.note.trim() ? data.note.trim() : null,
    // แสดงทั้งบริษัทได้เฉพาะผู้จัดการวันหยุด/ปฏิทิน
    all_company: (await managesAll(u)) && (data.all_company === true || data.all_company === "1" || data.all_company === 1),
    skip_weekends: hasWeekend,
  };
}

calendarRoutes.post("/calendar/events", async (req, res) => {
  const u = me(req);
  const v = await eventInput(req, u);
  const now = nowDb();
  const id = await insert("calendar_events", { type: "event", user_id: u.id, ...v, created_by: u.id, created_at: now, updated_at: now });
  await audit(req, { action: "calendar_event.created", subjectType: "calendar_event", subjectId: id, after: v });
  res.status(201).json({ data: { id } });
});

async function ownEvent(req: Request) {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : 0;
  const e = await first<{ id: number; type: string; created_by: number | null }>("SELECT id, type, created_by FROM calendar_events WHERE id = ? AND type = 'event'", [id]);
  if (!e) throw notFound();
  const u = me(req);
  // กิจกรรมของคนอื่น: ผู้จัดการวันหยุด (ขอบเขตสาขาตัวเอง = เฉพาะของคนในสาขา)
  const creator = e.created_by ? await first<{ branch_id: number | null }>("SELECT branch_id FROM users WHERE id = ?", [e.created_by]) : null;
  authorize(Number(e.created_by) === u.id || (await canFor(u, "holidays.manage", creator?.branch_id)));
  return { e, u };
}

calendarRoutes.put("/calendar/events/:id", async (req, res) => {
  const { e, u } = await ownEvent(req);
  const v = await eventInput(req, u);
  await update("calendar_events", { ...v, updated_at: nowDb() }, "id = ?", [e.id]);
  await audit(req, { action: "calendar_event.updated", subjectType: "calendar_event", subjectId: e.id, after: v });
  res.json({ data: { id: e.id } });
});

calendarRoutes.delete("/calendar/events/:id", async (req, res) => {
  const { e } = await ownEvent(req);
  await exec("DELETE FROM calendar_events WHERE id = ?", [e.id]);
  await audit(req, { action: "calendar_event.deleted", subjectType: "calendar_event", subjectId: e.id });
  res.status(204).end();
});

/* ---------------------------------------------------------------- ขอบเขตต่อกลุ่ม */

// ตั้งได้ = access.manage (ทุกกลุ่ม) / access.groups (เฉพาะกลุ่มที่ต่ำกว่า — กลุ่มอื่นคงค่าเดิม: keepLockedGroups)
calendarRoutes.get("/calendar/scope", async (req, res) => {
  authorize(can(me(req), "access.manage") || can(me(req), "access.groups"));
  res.json({ data: { calendar: await scopeSettings("calendar"), leave: await scopeSettings("leave") } });
});

calendarRoutes.put("/calendar/scope", async (req, res) => {
  const u = me(req);
  authorize(can(u, "access.manage") || can(u, "access.groups"));
  const editable = await editableGroupKeys(u, req.locale);
  const groups = (await select<{ key: string }>('SELECT "key" FROM permission_groups')).map((g) => g.key);
  // scopes = ปฏิทิน (กิจกรรม/หน้างาน), leave_scopes = วันลาของคนอื่น — ส่งมาอย่างใดอย่างหนึ่งหรือทั้งคู่
  const parse = (input: unknown, field: string): Record<string, Scope> | null => {
    if (input === undefined) return null;
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const next: Record<string, Scope> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!groups.includes(k) || !(SCOPES as readonly unknown[]).includes(v)) throw ValidationError.withMessages({ [field]: t(req, "eam.calendar.scope_invalid") });
      next[k] = v as Scope;
    }
    return next;
  };
  const calendar = parse(req.input.scopes, "scopes");
  const leave = parse(req.input.leave_scopes, "leave_scopes");
  for (const [kind, next] of [["calendar", calendar], ["leave", leave]] as const) {
    if (!next) continue;
    const before = await scopeSettings(kind);
    const key = kind === "calendar" ? "calendar_scope" : "leave_scope";
    const value = keepLockedGroups(editable, before, next);
    await putSetting(key, value, u.id);
    await audit(req, { action: `${key}.updated`, subjectType: "app_setting", subjectId: key, before, after: value });
  }
  res.json({ data: { calendar: await scopeSettings("calendar"), leave: await scopeSettings("leave") } });
});

/* ---------------------------------------------------------------- iCal */

calendarRoutes.post("/calendar/token", async (req, res) => {
  const u = me(req);
  const token = randomBytes(24).toString("hex");
  await update("users", { calendar_token: token }, "id = ?", [u.id]);
  res.json({ data: { token } });
});

calendarRoutes.delete("/calendar/token", async (req, res) => {
  await update("users", { calendar_token: null }, "id = ?", [me(req).id]);
  res.status(204).end();
});

publicCalendarRoutes.get("/calendar/feed/:token", async (req, res) => {
  const token = String(req.params.token).replace(/\.ics$/, "");
  const u = await findUserByCalendarToken(token);
  if (!u) throw notFound();
  const today = localToday();
  const from = `${Number(today.slice(0, 4)) - 0}-${today.slice(5, 7)}-01`;
  const back = new Date(`${from}T00:00:00Z`);
  back.setUTCMonth(back.getUTCMonth() - 1);
  const ahead = new Date(`${from}T00:00:00Z`);
  ahead.setUTCMonth(ahead.getUTCMonth() + 4);
  const items = await calendarItems(u, {
    from: back.toISOString().slice(0, 10),
    to: ahead.toISOString().slice(0, 10),
    scope: await maxScope(u),
    locale: "th",
    canManage: false,
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(toIcs(items.filter((i) => i.status !== "pending"), "IT-SYSTEM"));
});

/* ---------------------------------------------------------------- การลา */

interface LeaveRow {
  id: number; uuid: string; user_id: number; leave_type: LeaveType; unit: LeaveUnit; start_on: string; end_on: string;
  start_time: string | null; end_time: string | null; days: string; reason: string | null; approver_id: number | null; status: string;
  decided_at: string | null; decision_note: string | null; created_at: string | null;
  user_name: string; approver_name: string | null; user_department: string | null; branch_name: string | null; user_branch_id: number | null;
}
const LEAVE_SELECT = `SELECT l.*, o.name AS user_name, o.department AS user_department, o.branch_id AS user_branch_id, b.name AS branch_name, a.name AS approver_name
  FROM leave_requests l JOIN users o ON o.id = l.user_id LEFT JOIN users a ON a.id = l.approver_id LEFT JOIN branches b ON b.id = o.branch_id`;

async function leaveJson(l: LeaveRow, viewer: UserRow) {
  const files = await select<{ id: number; original_name: string; mime: string | null; size: number | null }>("SELECT id, original_name, mime, size FROM leave_files WHERE leave_id = ? ORDER BY id", [l.id]);
  const today = localToday();
  const isOwner = viewer.id === Number(l.user_id);
  // อนุมัติแทน (leave.approve_any) ตามขอบเขตสาขาของกลุ่ม
  const onBehalf = await canFor(viewer, "leave.approve_any", l.user_branch_id);
  const isApprover = viewer.id === Number(l.approver_id) || onBehalf;
  return {
    id: l.uuid,
    user: { id: Number(l.user_id), name: l.user_name, department: l.user_department, branch: l.branch_name },
    leave_type: l.leave_type,
    unit: l.unit,
    start_on: dateOnly(l.start_on),
    end_on: dateOnly(l.end_on),
    start_time: l.start_time,
    end_time: l.end_time,
    days: Number(l.days),
    reason: l.reason,
    approver: l.approver_id ? { id: Number(l.approver_id), name: l.approver_name } : null,
    status: l.status,
    decided_at: iso(l.decided_at),
    decision_note: l.decision_note,
    created_at: iso(l.created_at),
    files: files.map((f) => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: f.size })),
    can_decide: l.status === "pending" && isApprover && !isOwner,
    can_cancel: (isOwner || onBehalf) && (l.status === "pending" || (l.status === "approved" && dateOnly(l.start_on)! > today)),
  };
}

async function findLeave(req: Request) {
  const uuid = String(req.params.uuid);
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw notFound();
  const l = await first<LeaveRow>(`${LEAVE_SELECT} WHERE l.uuid = ?`, [uuid]);
  if (!l) throw notFound();
  const u = me(req);
  const allowed =
    u.id === Number(l.user_id) || u.id === Number(l.approver_id) || (await canFor(u, "leave.view_all", l.user_branch_id)) || (await canFor(u, "leave.approve_any", l.user_branch_id));
  if (!allowed) throw notFound();
  return { l, u };
}

/**
 * ผู้อนุมัติที่เลือกได้:
 *   1. ผู้ที่ตำแหน่งสูงกว่าในแผนกเดียวกัน หรือฝ่ายเดียวกัน (ฝ่าย = users.division หรือฝ่ายที่แผนกสังกัด)
 *   2. ไม่มี → ตามสายอนุมัติ (ขั้นแรกที่มีผู้อนุมัติ / ระบบเดิม = หัวหน้าตามสาย)
 */
async function approverOptions(u: UserRow): Promise<{ source: "org" | "route"; list: { id: number; name: string }[] }> {
  const roles = rolesAbove(u.role);
  const dept = normDept(u.department);
  const divisions = [normDept(u.division)];
  if (dept) {
    const rows = await select<{ name: string }>(
      "SELECT dv.name FROM departments d JOIN divisions dv ON dv.id = d.division_id WHERE LOWER(TRIM(d.name)) = ?",
      [dept],
    );
    divisions.push(...rows.map((r) => normDept(r.name)));
  }
  const divs = [...new Set(divisions.filter((d): d is string => d !== null))];
  const match: string[] = [];
  const params: unknown[] = [u.id, roles];
  if (dept) {
    match.push("LOWER(TRIM(o.department)) = ?");
    params.push(dept);
  }
  if (divs.length) {
    match.push(`LOWER(TRIM(o.division)) IN (?) OR EXISTS (SELECT 1 FROM departments d JOIN divisions dv ON dv.id = d.division_id
      WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(o.department)) AND LOWER(TRIM(dv.name)) IN (?))`);
    params.push(divs, divs);
  }
  if (roles.length && match.length) {
    const org = await select<{ id: number; name: string }>(
      `SELECT o.id, o.name FROM users o WHERE o.is_active = true AND o.id <> ? AND o.role IN (?) AND (${match.join(" OR ")}) ORDER BY o.name, o.id`,
      params,
    );
    if (org.length) return { source: "org", list: org.map((a) => ({ id: Number(a.id), name: a.name })) };
  }
  const plan = await planFor(u);
  const fromRoute = plan.source === "legacy" ? (plan.legacy_approver ? [plan.legacy_approver] : []) : (plan.steps.find((s) => !s.skipped)?.approvers ?? []);
  return { source: "route", list: fromRoute.map((a) => ({ id: Number(a.id), name: a.name })).filter((a) => a.id !== u.id) };
}

/** โควตาและที่ใช้ไปของปี */
async function balanceOf(userId: number, year: number, settings: LeaveSettings) {
  const overrides = await select<{ leave_type: string; days: string }>("SELECT leave_type, days FROM leave_quota_overrides WHERE user_id = ? AND year = ?", [userId, year]);
  const used = await select<{ leave_type: string; status: string; total: string }>(
    "SELECT leave_type, status, SUM(days) AS total FROM leave_requests WHERE user_id = ? AND YEAR(start_on) = ? AND status IN ('approved', 'pending') GROUP BY leave_type, status",
    [userId, year],
  );
  return LEAVE_TYPES.map((type) => {
    const override = overrides.find((o) => o.leave_type === type);
    const quota = override ? Number(override.days) : settings.quotas[type];
    const approved = Number(used.find((x) => x.leave_type === type && x.status === "approved")?.total ?? 0);
    const pending = Number(used.find((x) => x.leave_type === type && x.status === "pending")?.total ?? 0);
    return { type, quota, approved, pending, remaining: quota === null ? null : Math.round((quota - approved - pending) * 100) / 100 };
  });
}

calendarRoutes.get("/leave/options", async (req, res) => {
  const u = me(req);
  const settings = await leaveSettings();
  const approvers = await approverOptions(u);
  // ตั้งต้น = หัวหน้าตามสายถ้าอยู่ในรายชื่อ ไม่งั้นคนแรก (มีคนเดียว = เลือกให้เลย)
  const supervisor = approvers.list.find((a) => a.id === Number(u.supervisor_id));
  res.json({
    data: {
      types: LEAVE_TYPES,
      units: LEAVE_UNITS,
      approvers: approvers.list,
      approver_source: approvers.source,
      default_approver_id: (supervisor ?? approvers.list[0])?.id ?? null,
      sick_cert_days: settings.sick_cert_days,
      work_days: settings.work_days,
      balance: await balanceOf(u.id, Number(localToday().slice(0, 4)), settings),
    },
  });
});

calendarRoutes.get("/leave/balance", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { year: ["nullable", "integer", "min:2000", "max:2100"], user_id: ["nullable", "integer"] }, { locale: req.locale });
  const userId = int(f.user_id) ?? u.id;
  const target = userId === u.id ? null : await first<{ branch_id: number | null }>("SELECT branch_id FROM users WHERE id = ?", [userId]);
  authorize(userId === u.id || (target !== null && (await canFor(u, "leave.view_all", target.branch_id))));
  res.json({ data: await balanceOf(userId, int(f.year) ?? Number(localToday().slice(0, 4)), await leaveSettings()) });
});

/** วันลานับได้ (คำนวณก่อนส่ง — หน้าฟอร์มแสดงจำนวนวัน) */
calendarRoutes.get("/leave/preview", async (req, res) => {
  const f = await validate(
    req.input,
    { unit: ["required", `in:${LEAVE_UNITS.join(",")}`], start_on: ["required", regex(DATE)], end_on: ["nullable", regex(DATE)], start_time: ["nullable", regex(TIME)], end_time: ["nullable", regex(TIME)] },
    { locale: req.locale },
  );
  const unit = f.unit as LeaveUnit;
  const end = unit === "full" && f.end_on ? String(f.end_on) : String(f.start_on);
  const u = me(req);
  res.json({ data: { days: await leaveDays(unit, String(f.start_on), end < String(f.start_on) ? String(f.start_on) : end, (f.start_time as string) ?? null, (f.end_time as string) ?? null, u.branch_id ? Number(u.branch_id) : null) } });
});

calendarRoutes.post("/leave", async (req, res) => {
  const u = me(req);
  const input = req.input;
  const settings = await leaveSettings();
  const data = await validate(
    input,
    {
      leave_type: ["required", `in:${LEAVE_TYPES.join(",")}`],
      unit: ["required", `in:${LEAVE_UNITS.join(",")}`],
      start_on: ["required", regex(DATE)],
      end_on: ["nullable", regex(DATE), "after_or_equal:start_on"],
      start_time: ["required_if:unit,hours", "nullable", regex(TIME)],
      end_time: ["required_if:unit,hours", "nullable", regex(TIME)],
      // เหตุผลการลา — บังคับกรอก
      reason: ["required", "string", "max:2000", regex(/\S/)],
      approver_id: ["required", "integer"],
      files: ["nullable", "array", "max:3"],
      "files.*": ["file", "mimes:pdf,jpg,jpeg,png", "max:5120"],
    },
    { locale: req.locale },
  );
  const unit = data.unit as LeaveUnit;
  const type = data.leave_type as LeaveType;
  const start = String(data.start_on);
  const end = unit === "full" ? String(data.end_on ?? start) : start; // ครึ่งวัน / รายชั่วโมง = วันเดียว
  const startTime = unit === "hours" ? String(data.start_time) : null;
  const endTime = unit === "hours" ? String(data.end_time) : null;
  const errors: Record<string, string> = {};
  if (unit === "hours" && startTime! >= endTime!) errors.end_time = t(req, "eam.leave.hours_invalid");
  const approverId = int(data.approver_id)!;
  if (!(await approverOptions(u)).list.some((a) => a.id === approverId)) errors.approver_id = t(req, "eam.leave.approver_invalid");
  const days = await leaveDays(unit, start, end, startTime, endTime, u.branch_id ? Number(u.branch_id) : null);
  if (days <= 0 && !errors.end_time) errors.start_on = t(req, "eam.leave.no_working_days");

  // ทับใบลาเดิม (รออนุมัติ/อนุมัติแล้ว): เต็มวันทับวันใดก็ตาม / ครึ่งวันเดียวกัน / รายชั่วโมงเวลาซ้อน
  const others = await select<{ unit: string; start_on: string; end_on: string; start_time: string | null; end_time: string | null }>(
    "SELECT unit, start_on, end_on, start_time, end_time FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'approved') AND start_on <= ? AND end_on >= ?",
    [u.id, end, start],
  );
  const clash = others.some((o) => {
    if (unit === "full" || o.unit === "full") return true;
    if (unit === "hours" && o.unit === "hours") return startTime! < o.end_time! && o.start_time! < endTime!;
    if (unit === o.unit) return true; // ครึ่งเช้าซ้ำครึ่งเช้า
    // ครึ่งวันกับรายชั่วโมง: เช้า = ก่อน 12:00, บ่าย = ตั้งแต่ 12:00
    const half = unit === "hours" ? o.unit : unit;
    const [s, e] = unit === "hours" ? [startTime!, endTime!] : [o.start_time!, o.end_time!];
    return half === "half_am" ? s < "12:00" : e > "12:00";
  });
  if (clash) errors.start_on = t(req, "eam.leave.overlap");

  // โควตา
  const balance = (await balanceOf(u.id, Number(start.slice(0, 4)), settings)).find((b) => b.type === type)!;
  if (balance.remaining !== null && days > balance.remaining) {
    errors.leave_type = t(req, "eam.leave.quota_exceeded", { type: t(req, `eam.leave.types.${type}`), remaining: balance.remaining });
  }
  // ใบรับรองแพทย์
  const uploads = Object.values((data.files as Record<string, unknown>) ?? {}).filter((f): f is UploadedFile => f instanceof UploadedFile);
  if (type === "sick" && settings.sick_cert_days > 0 && days >= settings.sick_cert_days && uploads.length === 0) {
    errors.files = t(req, "eam.leave.cert_required", { days: settings.sick_cert_days });
  }
  if (Object.keys(errors).length) throw ValidationError.withMessages(errors);

  const uuid = randomUUID();
  const now = nowDb();
  const id = await transaction(async () => {
    const leaveId = await insert("leave_requests", {
      uuid, user_id: u.id, leave_type: type, unit, start_on: start, end_on: end, start_time: startTime, end_time: endTime, days,
      reason: typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : null,
      approver_id: approverId, status: "pending", created_at: now, updated_at: now,
    });
    for (const file of uploads) {
      const stored = await storeUploadIn(`leave/${uuid}`, file);
      await insert("leave_files", { leave_id: leaveId, ...stored, created_at: now });
    }
    return leaveId;
  });
  await notifyUsers([approverId], "leave.submitted", { kind: "leave", event: "submitted", leave_id: uuid, actor: u.name, leave_type: type, start_on: start, end_on: end, days });
  await audit(req, { action: "leave.created", subjectType: "leave_request", subjectId: id, after: { leave_type: type, unit, start_on: start, end_on: end, days, approver_id: approverId } });
  const row = (await first<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = ?`, [id]))!;
  res.status(201).json({ data: await leaveJson(row, u) });
});

/** GET /leave?scope=mine|all&status=&year=&user_id= — ของตัวเอง (ค่าเริ่มต้น) / ทุกคน (leave.view_all) */
async function leaveList(req: Request, u: UserRow) {
  const f = await validate(
    req.input,
    { scope: ["nullable", "in:mine,all"], status: ["nullable", "in:pending,approved,rejected,cancelled"], year: ["nullable", "integer", "min:2000", "max:2100"], user_id: ["nullable", "integer"] },
    { locale: req.locale },
  );
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.scope === "all") {
    authorize(can(u, "leave.view_all"));
    // ขอบเขตสาขาตัวเอง = เฉพาะใบลาของคนในสาขา
    const scope = await scopeWhere(u, "leave.view_all", "o.branch_id");
    where.push(scope.sql);
    params.push(...scope.params);
    if (int(f.user_id)) (where.push("l.user_id = ?"), params.push(int(f.user_id)));
  } else (where.push("l.user_id = ?"), params.push(u.id));
  if (f.status) (where.push("l.status = ?"), params.push(f.status));
  if (int(f.year)) (where.push("YEAR(l.start_on) = ?"), params.push(int(f.year)));
  return select<LeaveRow>(`${LEAVE_SELECT} WHERE ${where.join(" AND ") || "1 = 1"} ORDER BY l.start_on DESC, l.id DESC LIMIT 500`, params);
}

calendarRoutes.get("/leave", async (req, res) => {
  const u = me(req);
  const rows = await leaveList(req, u);
  res.json({ data: await Promise.all(rows.map((r) => leaveJson(r, u))) });
});

/** รอฉันอนุมัติ (+ ที่ฉันตัดสินแล้ว) — ผู้อนุมัติแทนทุกสายเห็นใบที่รออนุมัติทั้งหมด */
calendarRoutes.get("/leave/approvals", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { status: ["nullable", "in:pending,decided"] }, { locale: req.locale });
  const decided = f.status === "decided";
  // อนุมัติแทน = ทุกใบที่รออนุมัติในขอบเขต (ทุกสาขา / สาขาตัวเอง)
  const any = await scopeWhere(u, "leave.approve_any", "o.branch_id");
  const rows = await select<LeaveRow>(
    `${LEAVE_SELECT} WHERE ${decided ? "l.status IN ('approved', 'rejected') AND l.approver_id = ?" : `l.status = 'pending' AND (l.approver_id = ? OR ${any.sql})`}
      ORDER BY l.start_on ${decided ? "DESC" : "ASC"}, l.id LIMIT 300`,
    decided ? [u.id] : [u.id, ...any.params],
  );
  res.json({ data: await Promise.all(rows.filter((r) => Number(r.user_id) !== u.id || decided).map((r) => leaveJson(r, u))) });
});

/** ส่งออกรายงานการลา Excel */
calendarRoutes.get("/leave/export", async (req, res) => {
  const u = me(req);
  const rows = await leaveList(req, u);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t(req, "eam.leave.export_sheet"));
  const H = (k: string) => t(req, `eam.leave.export.${k}`);
  ws.columns = [
    { header: H("name"), key: "name", width: 26 }, { header: H("department"), key: "department", width: 16 }, { header: H("branch"), key: "branch", width: 16 },
    { header: H("type"), key: "type", width: 14 }, { header: H("unit"), key: "unit", width: 16 }, { header: H("start"), key: "start", width: 13 },
    { header: H("end"), key: "end", width: 13 }, { header: H("time"), key: "time", width: 14 }, { header: H("days"), key: "days", width: 9 },
    { header: H("reason"), key: "reason", width: 30 }, { header: H("approver"), key: "approver", width: 24 }, { header: H("status"), key: "status", width: 14 },
    { header: H("note"), key: "note", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  const asDate = (v: string | null) => (v ? new Date(`${dateOnly(v)}T00:00:00Z`) : null);
  for (const r of rows) {
    ws.addRow({
      name: r.user_name, department: r.user_department, branch: r.branch_name,
      type: t(req, `eam.leave.types.${r.leave_type}`), unit: t(req, `eam.leave.units.${r.unit}`),
      start: asDate(r.start_on), end: asDate(r.end_on), time: r.start_time ? `${r.start_time}–${r.end_time}` : null, days: Number(r.days),
      reason: r.reason, approver: r.approver_name, status: t(req, `eam.leave.statuses.${r.status}`), note: r.decision_note,
    });
  }
  ws.getColumn("start").numFmt = "dd/mm/yyyy";
  ws.getColumn("end").numFmt = "dd/mm/yyyy";
  const name = `leave-${localToday()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/* ---------- ตั้งค่าการลา / โควตารายคน (ผู้ดูแลระบบ) — ประกาศก่อน /leave/:uuid */

calendarRoutes.get("/leave/settings", async (req, res) => {
  authorize(manages(me(req)));
  res.json({ data: await leaveSettings() });
});

calendarRoutes.put("/leave/settings", async (req, res) => {
  const u = me(req);
  // ใช้ทั้งบริษัท — ขอบเขตทุกสาขาเท่านั้น
  authorize(await managesAll(u));
  const data = await validate(
    req.input,
    {
      ...Object.fromEntries(LEAVE_TYPES.map((k) => [`quotas.${k}`, ["nullable", "numeric", "min:0", "max:365"]])),
      sick_cert_days: ["required", "integer", "min:0", "max:60"],
      work_days: ["required", "array", "min:1", "max:7"],
      "work_days.*": ["integer", "min:0", "max:6"],
    },
    { locale: req.locale },
  );
  const q = (data.quotas ?? {}) as Record<string, unknown>;
  const next: LeaveSettings = {
    quotas: Object.fromEntries(LEAVE_TYPES.map((k) => [k, q[k] === null || q[k] === undefined || q[k] === "" ? null : Number(q[k])])) as LeaveSettings["quotas"],
    sick_cert_days: Number(data.sick_cert_days),
    work_days: [...new Set(Object.values(data.work_days as Record<string, unknown>).map(Number))].sort(),
  };
  const before = await leaveSettings();
  await putSetting("leave_settings", next, u.id);
  await audit(req, { action: "leave_settings.updated", subjectType: "app_setting", subjectId: "leave_settings", before, after: next });
  res.json({ data: next });
});

calendarRoutes.get("/leave/quotas", async (req, res) => {
  authorize(manages(me(req)));
  const f = await validate(req.input, { year: ["required", "integer", "min:2000", "max:2100"] }, { locale: req.locale });
  const scope = await scopeWhere(me(req), "holidays.manage", "u.branch_id");
  const rows = await select<{ user_id: number; name: string; leave_type: string; days: string }>(
    `SELECT q.user_id, u.name, q.leave_type, q.days FROM leave_quota_overrides q JOIN users u ON u.id = q.user_id WHERE q.year = ? AND ${scope.sql} ORDER BY u.name, q.leave_type`,
    [int(f.year), ...scope.params],
  );
  res.json({ data: rows.map((r) => ({ user: { id: Number(r.user_id), name: r.name }, leave_type: r.leave_type, days: Number(r.days) })) });
});

calendarRoutes.put("/leave/quotas", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const data = await validate(
    req.input,
    {
      user_id: ["required", "integer"],
      year: ["required", "integer", "min:2000", "max:2100"],
      leave_type: ["required", `in:${LEAVE_TYPES.join(",")}`],
      days: ["nullable", "numeric", "min:0", "max:365"],
    },
    { locale: req.locale },
  );
  // โควตารายคน = เฉพาะคนในขอบเขต (สาขาตัวเอง)
  const owner = await first<{ branch_id: number | null }>("SELECT branch_id FROM users WHERE id = ?", [int(data.user_id)]);
  if (!owner || !(await canFor(u, "holidays.manage", owner.branch_id))) throw ValidationError.withMessages({ user_id: t(req, "eam.holiday.branch_scope") });
  const key = [int(data.user_id), int(data.year), data.leave_type];
  if (data.days === null || data.days === undefined || data.days === "") {
    await exec("DELETE FROM leave_quota_overrides WHERE user_id = ? AND year = ? AND leave_type = ?", key);
  } else {
    await exec(
      "INSERT INTO leave_quota_overrides (user_id, year, leave_type, days, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE days = VALUES(days), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
      [...key, Number(data.days), u.id, nowDb()],
    );
  }
  await audit(req, { action: "leave_quota.updated", subjectType: "user", subjectId: int(data.user_id), after: { year: data.year, leave_type: data.leave_type, days: data.days ?? null } });
  res.json({ data: { ok: true } });
});

/* ---------- ใบลาแต่ละใบ */

calendarRoutes.get("/leave/:uuid", async (req, res) => {
  const { l, u } = await findLeave(req);
  // เปิดดูใบลานี้แล้ว = แจ้งเตือนของใบนี้ในกระดิ่ง (ของผู้ดู) อ่านแล้ว
  await markNoticesRead("leave_id", l.uuid, { userId: u.id });
  res.json({ data: await leaveJson(l, u) });
});

async function decide(req: Request, res: Response, approve: boolean) {
  const { l, u } = await findLeave(req);
  authorize((u.id === Number(l.approver_id) || (await canFor(u, "leave.approve_any", l.user_branch_id))) && u.id !== Number(l.user_id));
  const data = await validate(req.input, { note: [approve ? "nullable" : "required", "string", "max:2000"] }, { locale: req.locale });
  if (l.status !== "pending") throw ValidationError.withMessages({ status: t(req, "eam.leave.not_pending") });
  const status = approve ? "approved" : "rejected";
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  await update("leave_requests", { status, decided_at: nowDb(), decision_note: note, approver_id: u.id, updated_at: nowDb() }, "id = ?", [l.id]);
  // ตัดสินแล้ว → แจ้งเตือน "รออนุมัติ" ของใบนี้ (ทุกคน) อ่านแล้ว
  await markNoticesRead("leave_id", l.uuid, { events: ["submitted"] });
  await notifyUsers([Number(l.user_id)], approve ? "leave.approved" : "leave.rejected", {
    kind: "leave", event: approve ? "approved" : "rejected", leave_id: l.uuid, actor: u.name, leave_type: l.leave_type, start_on: dateOnly(l.start_on), end_on: dateOnly(l.end_on), note,
  });
  await audit(req, { action: approve ? "leave.approved" : "leave.rejected", subjectType: "leave_request", subjectId: l.id, after: { note } });
  res.json({ data: await leaveJson((await first<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = ?`, [l.id]))!, u) });
}
calendarRoutes.post("/leave/:uuid/approve", (req, res) => decide(req, res, true));
calendarRoutes.post("/leave/:uuid/reject", (req, res) => decide(req, res, false));

calendarRoutes.post("/leave/:uuid/cancel", async (req, res) => {
  const { l, u } = await findLeave(req);
  const json = await leaveJson(l, u);
  if (!json.can_cancel) throw ValidationError.withMessages({ status: t(req, "eam.leave.cancel_not_allowed") });
  await update("leave_requests", { status: "cancelled", cancelled_by: u.id, updated_at: nowDb() }, "id = ?", [l.id]);
  await markNoticesRead("leave_id", l.uuid, { events: ["submitted"] });
  const notify = [Number(l.user_id), Number(l.approver_id)].filter((id) => id && id !== u.id);
  await notifyUsers(notify, "leave.cancelled", { kind: "leave", event: "cancelled", leave_id: l.uuid, actor: u.name, owner: l.user_name, leave_type: l.leave_type, start_on: dateOnly(l.start_on), end_on: dateOnly(l.end_on) });
  await audit(req, { action: "leave.cancelled", subjectType: "leave_request", subjectId: l.id, before: { status: l.status } });
  res.json({ data: await leaveJson((await first<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = ?`, [l.id]))!, u) });
});

calendarRoutes.get("/leave/:uuid/files/:id", async (req, res) => {
  const { l } = await findLeave(req);
  const file = await first<{ path: string; original_name: string; mime: string | null }>("SELECT path, original_name, mime FROM leave_files WHERE id = ? AND leave_id = ?", [Number(req.params.id) || 0, l.id]);
  if (!file) throw notFound();
  const stored = await readStored(file.path);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime ?? stored.mime);
  res.setHeader("Content-Disposition", `inline; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

/** ลายเซ็นปัจจุบันของผู้ลา / ผู้อนุมัติ (พิมพ์ใบลา A4) — ผู้อนุมัติแสดงเมื่ออนุมัติแล้วเท่านั้น */
calendarRoutes.get("/leave/:uuid/signature/:who", async (req, res) => {
  const { l } = await findLeave(req);
  const who = req.params.who === "approver" ? "approver" : "requester";
  if (who === "approver" && l.status !== "approved") throw notFound();
  const userId = who === "approver" ? Number(l.approver_id) : Number(l.user_id);
  const sig = userId ? await activeSignature(userId) : null;
  const data = sig ? await readSignature(sig) : null;
  if (!sig || !data) throw notFound();
  res.setHeader("Content-Type", sig.mime_type);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(data);
});

/* ---------------------------------------------------------------- วันหยุดบริษัท */

/* ---------- ปฏิทินวันหยุด (แยกชุดตามประกาศ เช่น สำนักงานใหญ่ / สำนักงานโรงงาน) — สาขาเลือกใช้ 1 ชุด */

interface HolidayCalendarRow { id: number; name: string; is_default: number | boolean; sort_order: number }
type BranchRef = { id: number; code: string; name: string };

async function holidayCalendars() {
  const cals = await select<HolidayCalendarRow>("SELECT id, name, is_default, sort_order FROM holiday_calendars ORDER BY sort_order, name");
  const branches = await select<BranchRef & { holiday_calendar_id: number | null }>(
    "SELECT id, code, name, holiday_calendar_id FROM branches WHERE deleted_at IS NULL ORDER BY sort_order, name",
  );
  const def = cals.find((c) => Boolean(c.is_default)) ?? cals[0];
  return cals.map((c) => ({
    id: Number(c.id),
    name: c.name,
    is_default: Boolean(c.is_default),
    // สาขาที่ยังไม่เลือกชุด = ใช้ชุดตั้งต้น
    branches: branches
      .filter((b) => (b.holiday_calendar_id ? Number(b.holiday_calendar_id) === Number(c.id) : def && Number(def.id) === Number(c.id)))
      .map((b) => ({ id: Number(b.id), code: b.code, name: b.name })),
  }));
}

calendarRoutes.get("/holiday-calendars", async (_req, res) => {
  res.json({ data: await holidayCalendars() });
});

/** ชื่อชุด + สาขาที่ใช้ชุดนี้ (ย้ายสาขาจากชุดเดิมมา) + เป็นชุดตั้งต้นไหม */
async function holidayCalendarInput(req: Request, ignoreId?: number) {
  const data = await validate(req.input, { name: ["required", "string", "max:100"], is_default: ["nullable", "boolean"] }, { locale: req.locale });
  const name = String(data.name).trim();
  const dup = await first<{ id: number }>("SELECT id FROM holiday_calendars WHERE name = ?", [name]);
  if (dup && Number(dup.id) !== ignoreId) throw ValidationError.withMessages({ name: t(req, "eam.holiday.calendar_duplicate") });
  const raw = req.input.branch_ids;
  const branchIds = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number))];
  if (branchIds.length) {
    const found = await select<{ id: number }>("SELECT id FROM branches WHERE id IN (?) AND deleted_at IS NULL", [branchIds]);
    if (found.length !== branchIds.length) throw ValidationError.withMessages({ branch_ids: t(req, "eam.holiday.branch_invalid") });
  }
  return { name, branch_ids: branchIds, is_default: data.is_default === true || data.is_default === 1 || data.is_default === "1" || data.is_default === "true" };
}

async function saveHolidayCalendar(id: number, v: { branch_ids: number[]; is_default: boolean }) {
  // สาขาที่เลือก = ใช้ชุดนี้; สาขาที่เคยใช้ชุดนี้แต่ไม่ได้เลือกแล้ว = กลับไปใช้ชุดตั้งต้น
  await exec("UPDATE branches SET holiday_calendar_id = NULL WHERE holiday_calendar_id = ?", [id]);
  if (v.branch_ids.length) await exec("UPDATE branches SET holiday_calendar_id = ? WHERE id IN (?)", [id, v.branch_ids]);
  if (v.is_default) await exec("UPDATE holiday_calendars SET is_default = (id = ?)", [id]);
}

calendarRoutes.post("/holiday-calendars", async (req, res) => {
  const u = me(req);
  // ชุดวันหยุด (และสาขาที่ใช้ชุด) = ทุกสาขาเท่านั้น
  authorize(await managesAll(u));
  const v = await holidayCalendarInput(req);
  const now = nowDb();
  let id = 0;
  await transaction(async () => {
    const first_ = !(await first("SELECT 1 FROM holiday_calendars"));
    const order = Number((await first<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM holiday_calendars"))?.m ?? 0) + 10; // ต่อท้าย
    id = await insert("holiday_calendars", { name: v.name, is_default: v.is_default || first_, sort_order: order, created_at: now, updated_at: now });
    await saveHolidayCalendar(id, { ...v, is_default: v.is_default || first_ });
  });
  await audit(req, { action: "holiday_calendar.created", subjectType: "holiday_calendar", subjectId: id, after: v });
  res.status(201).json({ data: (await holidayCalendars()).find((c) => c.id === id) });
});

calendarRoutes.put("/holiday-calendars/:id", async (req, res) => {
  authorize(await managesAll(me(req)));
  const id = Number(req.params.id) || 0;
  const cal = await first<HolidayCalendarRow>("SELECT * FROM holiday_calendars WHERE id = ?", [id]);
  if (!cal) throw notFound();
  const v = await holidayCalendarInput(req, id);
  await transaction(async () => {
    await update("holiday_calendars", { name: v.name, updated_at: nowDb() }, "id = ?", [id]);
    await saveHolidayCalendar(id, v);
  });
  await audit(req, { action: "holiday_calendar.updated", subjectType: "holiday_calendar", subjectId: id, before: { name: cal.name }, after: v });
  res.json({ data: (await holidayCalendars()).find((c) => c.id === id) });
});

/** ลบชุด (ไม่ใช่ชุดตั้งต้น) — วันหยุดในชุดถูกลบด้วย, สาขาที่ใช้ชุดนี้กลับไปใช้ชุดตั้งต้น */
calendarRoutes.delete("/holiday-calendars/:id", async (req, res) => {
  authorize(await managesAll(me(req)));
  const id = Number(req.params.id) || 0;
  const cal = await first<HolidayCalendarRow>("SELECT * FROM holiday_calendars WHERE id = ?", [id]);
  if (!cal) throw notFound();
  if (cal.is_default) throw ValidationError.withMessages({ id: t(req, "eam.holiday.calendar_default_delete") });
  await exec("DELETE FROM holiday_calendars WHERE id = ?", [id]);
  await audit(req, { action: "holiday_calendar.deleted", subjectType: "holiday_calendar", subjectId: id, before: { name: cal.name } });
  res.status(204).end();
});

/* ---------- วันหยุดในแต่ละชุด */

/** ชุดที่ขอ (ไม่ระบุ = ชุดของสาขาผู้ใช้) */
async function calendarParam(req: Request, raw: unknown): Promise<number> {
  const id = Number(raw) || (await holidayCalendarFor(me(req).branch_id ? Number(me(req).branch_id) : null));
  if (!id || !(await first("SELECT 1 FROM holiday_calendars WHERE id = ?", [id]))) throw ValidationError.withMessages({ calendar_id: t(req, "eam.holiday.calendar_required") });
  return Number(id);
}

calendarRoutes.get("/holidays", async (req, res) => {
  const f = await validate(req.input, { year: ["nullable", "integer", "min:2000", "max:2100"] }, { locale: req.locale });
  const year = int(f.year) ?? Number(localToday().slice(0, 4));
  const calendars = await holidayCalendars();
  const calendarId = calendars.length ? await calendarParam(req, req.input.calendar_id) : null;
  const rows = calendarId
    ? await select<{ id: number; date: string; name: string }>("SELECT id, date, name FROM company_holidays WHERE calendar_id = ? AND YEAR(date) = ? ORDER BY date", [calendarId, year])
    : [];
  res.json({
    data: rows.map((r) => ({ id: Number(r.id), date: dateOnly(r.date), name: r.name, calendar_id: calendarId })),
    // can_manage = แก้วันหยุดของชุดนี้ได้ · can_manage_all = ตั้งค่าการลา / ชุดวันหยุด (ขอบเขตทุกสาขา)
    meta: { year, calendar_id: calendarId, calendars, can_manage: calendarId ? await managesCalendar(me(req), calendarId) : false, can_manage_all: await managesAll(me(req)) },
  });
});

async function holidayInput(req: Request, ignoreId?: number) {
  const data = await validate(req.input, { date: ["required", regex(DATE)], name: ["required", "string", "max:255"] }, { locale: req.locale });
  const calendarId = await calendarParam(req, req.input.calendar_id);
  await assertCalendar(req, calendarId);
  const dup = await first<{ id: number }>("SELECT id FROM company_holidays WHERE calendar_id = ? AND date = ?", [calendarId, data.date]);
  if (dup && Number(dup.id) !== ignoreId) throw ValidationError.withMessages({ date: t(req, "eam.holiday.duplicate") });
  return { calendar_id: calendarId, date: String(data.date), name: String(data.name).trim() };
}

calendarRoutes.post("/holidays", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const v = await holidayInput(req);
  const now = nowDb();
  const id = await insert("company_holidays", { ...v, created_by: u.id, created_at: now, updated_at: now });
  await audit(req, { action: "holiday.created", subjectType: "company_holiday", subjectId: id, after: v });
  res.status(201).json({ data: { id, ...v } });
});

/** คัดลอกวันหยุดของชุดนี้จากปีก่อน (วัน/เดือนเดิม) — ข้ามวันที่มีอยู่แล้วในชุด */
calendarRoutes.post("/holidays/copy-year", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const data = await validate(req.input, { from: ["required", "integer", "min:2000", "max:2100"], to: ["required", "integer", "min:2000", "max:2100"] }, { locale: req.locale });
  const calendarId = await calendarParam(req, req.input.calendar_id);
  await assertCalendar(req, calendarId);
  const rows = await select<{ date: string; name: string }>("SELECT date, name FROM company_holidays WHERE calendar_id = ? AND YEAR(date) = ?", [calendarId, int(data.from)]);
  let created = 0;
  const now = nowDb();
  for (const r of rows) {
    const d = dateOnly(r.date)!;
    const next = `${int(data.to)}${d.slice(4)}`;
    if (d.slice(5) === "02-29" || !Number.isFinite(new Date(`${next}T00:00:00Z`).getTime())) continue;
    if (await first("SELECT 1 FROM company_holidays WHERE calendar_id = ? AND date = ?", [calendarId, next])) continue;
    await insert("company_holidays", { calendar_id: calendarId, date: next, name: r.name, created_by: u.id, created_at: now, updated_at: now });
    created++;
  }
  await audit(req, { action: "holiday.copied", subjectType: "company_holiday", after: { calendar_id: calendarId, from: data.from, to: data.to, created } });
  res.json({ data: { created } });
});

/**
 * GET /holidays/import-template?year= — วันที่ | ชื่อวันหยุด | ปฏิทินวันหยุด (dropdown ชื่อชุด)
 * เติมวันหยุดของทุกชุดในปีนั้นไว้ให้ (แก้แล้วนำเข้ากลับได้) + แผ่นรายชื่อชุดและสาขาที่ใช้ + คำอธิบาย
 */
calendarRoutes.get("/holidays/import-template", async (req, res) => {
  authorize(manages(me(req)));
  const f = await validate(req.input, { year: ["nullable", "integer", "min:2000", "max:2100"] }, { locale: req.locale });
  const year = int(f.year) ?? Number(localToday().slice(0, 4));
  const calendars = await holidayCalendars();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t(req, "eam.holiday.sheet"));
  ws.columns = [
    { header: t(req, "eam.holiday.col_date"), key: "date", width: 16 },
    { header: t(req, "eam.holiday.col_name"), key: "name", width: 46 },
    { header: t(req, "eam.holiday.col_calendar"), key: "calendar", width: 26 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn("date").numFmt = "dd/mm/yyyy";
  const rows = await select<{ date: string; name: string; calendar: string }>(
    `SELECT h.date, h.name, c.name AS calendar FROM company_holidays h JOIN holiday_calendars c ON c.id = h.calendar_id
      WHERE YEAR(h.date) = ? ORDER BY c.sort_order, c.name, h.date`,
    [year],
  );
  for (const r of rows) ws.addRow({ date: new Date(`${dateOnly(r.date)}T00:00:00Z`), name: r.name, calendar: r.calendar });

  // แผ่นรายชื่อชุด (ใช้เป็นตัวเลือก dropdown ของคอลัมน์ ปฏิทินวันหยุด)
  const list = wb.addWorksheet(t(req, "eam.holiday.calendar_sheet"));
  list.columns = [{ header: t(req, "eam.holiday.col_calendar"), width: 28 }, { header: t(req, "eam.holiday.calendar_branches"), width: 70 }];
  list.getRow(1).font = { bold: true };
  for (const c of calendars) list.addRow([c.name, c.branches.map((b) => b.name).join(", ")]);
  if (calendars.length) {
    const ref = `'${list.name.replace(/'/g, "''")}'!$A$2:$A$${calendars.length + 1}`;
    for (let r = 2; r <= Math.max(rows.length + 1, 2) + 200; r++) {
      ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: calendars.length === 1, formulae: [ref], showErrorMessage: true };
    }
  }
  const help = wb.addWorksheet(t(req, "eam.asset_import.help_sheet"));
  help.columns = [{ width: 100 }];
  for (const line of t(req, "eam.holiday.help").split("\n")) help.addRow([line]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="holidays-${year}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/**
 * POST /holidays/import (multipart: file) — คอลัมน์ วันที่ | ชื่อวันหยุด | ปฏิทินวันหยุด (ชื่อชุด — มีชุดเดียวเว้นว่างได้)
 * วันที่ซ้ำในชุดเดียวกัน = อัปเดตชื่อ, ผิดแม้แถวเดียว = ไม่บันทึกเลย
 */
calendarRoutes.post("/holidays/import", async (req, res) => {
  const u = me(req);
  authorize(manages(u));
  const file = req.input.file;
  if (!(file instanceof UploadedFile)) return res.status(422).json({ message: t(req, "eam.holiday.no_file"), rows: [] });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    return res.status(422).json({ message: t(req, "eam.asset_import.unreadable"), rows: [] });
  }
  const calendars = await holidayCalendars();
  const findCalendar = (v: string) => calendars.find((c) => c.name.trim().toLowerCase() === v.trim().toLowerCase());
  // ชุดที่ผู้นำเข้าแก้ได้ (ขอบเขตสาขาตัวเอง = ชุดของสาขาตัวเองเท่านั้น)
  const allowedCalendars = new Set<number>();
  for (const c of calendars) if (await managesCalendar(u, Number(c.id))) allowedCalendars.add(Number(c.id));
  const ws = wb.worksheets[0];
  const rows: { row: number; calendar_id: number; date: string; name: string }[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Map<string, number>();
  ws?.eachRow((row, n) => {
    if (n === 1) return; // หัวตาราง
    const d = cellValue(row.getCell(1).value);
    const name = cellValue(row.getCell(2).value);
    const calText = cellValue(row.getCell(3).value);
    if (d === null && name === null) return;
    const date = d === null ? undefined : toIsoDate(d);
    if (!date) return void errors.push({ row: n, message: t(req, "eam.holiday.date_invalid") });
    if (!name || name instanceof Date) return void errors.push({ row: n, message: t(req, "eam.holiday.name_required") });
    if (name.length > 255) return void errors.push({ row: n, message: t(req, "eam.asset_import.too_long", { column: t(req, "eam.holiday.col_name"), max: 255 }) });
    const cal = calText === null || calText instanceof Date || !calText.trim() ? (calendars.length === 1 ? calendars[0] : undefined) : findCalendar(calText);
    if (!cal) {
      const value = calText === null || calText instanceof Date ? "" : calText.trim();
      return void errors.push({ row: n, message: value ? t(req, "eam.holiday.calendar_unknown", { value }) : t(req, "eam.holiday.calendar_required") });
    }
    if (!allowedCalendars.has(cal.id)) return void errors.push({ row: n, message: t(req, "eam.holiday.branch_scope") });
    const key = `${cal.id}|${date}`;
    if (seen.has(key)) return void errors.push({ row: n, message: t(req, "eam.holiday.duplicate_row", { row: seen.get(key)! }) });
    seen.set(key, n);
    rows.push({ row: n, calendar_id: cal.id, date, name: name.trim() });
  });
  if (!rows.length && !errors.length) errors.push({ row: 0, message: t(req, "eam.asset_import.empty") });
  if (errors.length) return res.status(422).json({ message: t(req, "eam.asset_import.failed"), rows: errors });
  let created = 0;
  let updated = 0;
  await transaction(async () => {
    const now = nowDb();
    for (const r of rows) {
      const found = await first<{ id: number }>("SELECT id FROM company_holidays WHERE calendar_id = ? AND date = ?", [r.calendar_id, r.date]);
      if (found) {
        await update("company_holidays", { name: r.name, updated_at: now }, "id = ?", [found.id]);
        updated++;
      } else {
        await insert("company_holidays", { calendar_id: r.calendar_id, date: r.date, name: r.name, created_by: u.id, created_at: now, updated_at: now });
        created++;
      }
    }
  });
  await audit(req, { action: "holiday.imported", subjectType: "company_holiday", after: { created, updated } });
  res.json({ data: { created, updated } });
});

calendarRoutes.put("/holidays/:id", async (req, res) => {
  authorize(manages(me(req)));
  const id = Number(req.params.id) || 0;
  if (!(await first("SELECT 1 FROM company_holidays WHERE id = ?", [id]))) throw notFound();
  // แก้วันที่ / ชื่อ (ย้ายชุดได้ถ้าส่ง calendar_id — ไม่ส่ง = ชุดเดิม)
  const cur = (await first<{ calendar_id: number }>("SELECT calendar_id FROM company_holidays WHERE id = ?", [id]))!;
  await assertCalendar(req, Number(cur.calendar_id));
  req.input.calendar_id = req.input.calendar_id ?? cur.calendar_id;
  const v = await holidayInput(req, id);
  await update("company_holidays", { ...v, updated_at: nowDb() }, "id = ?", [id]);
  await audit(req, { action: "holiday.updated", subjectType: "company_holiday", subjectId: id, after: v });
  res.json({ data: { id, ...v } });
});

calendarRoutes.delete("/holidays/:id", async (req, res) => {
  authorize(manages(me(req)));
  const id = Number(req.params.id) || 0;
  const cur = await first<{ calendar_id: number }>("SELECT calendar_id FROM company_holidays WHERE id = ?", [id]);
  if (!cur) throw notFound();
  await assertCalendar(req, Number(cur.calendar_id));
  await exec("DELETE FROM company_holidays WHERE id = ?", [id]);
  await audit(req, { action: "holiday.deleted", subjectType: "company_holiday", subjectId: id });
  res.status(204).end();
});

