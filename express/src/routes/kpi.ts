import { Router, type Request } from "express";
import { exec, first, insert, likeEscape, scalar, select, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { custom, int, regex, validate } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { can, findUser, type UserRow } from "../models/user.js";
import { buildKpiWorkbook, fiscalYear, monthsBetween } from "../services/kpi-export.js";
import { COMPLEXITY_VALUES, kpiMonthRows, kpiTotals, markOf, SERVICE_TYPE_NAMES, SERVICE_TYPES, SERVICE_TYPE_NOTE } from "../services/kpi.js";

/**
 * KPI ฝ่าย IT ตามไฟล์ Template-KPI-IT (Part2 Details) — เฉพาะฝ่าย IT (สิทธิ์ kpi.use)
 *   GET    /kpi/month?user_id=&month=YYYY-MM   ตารางรายเดือน = ใบงานที่รับแล้ว + แถวที่กรอกเอง + วันหยุด (+ Total)
 *   PUT    /kpi/tickets/{uuid}                  ประเภทการแจ้ง + Complexity ของแถวใบงาน (ผู้รับงานหรือ kpi.edit_all)
 *   POST   /kpi                                 เพิ่มแถวกรอกเอง / วันหยุด
 *   PATCH  /kpi/{id}, DELETE /kpi/{id}          เจ้าของหรือ kpi.edit_all
 *   GET    /kpi/export?user_id=&from=&to=       .xlsx รูปแบบเดียวกับไฟล์ต้นฉบับ (ชีตละเดือน)
 *   GET    /kpi?user_id=&from=&to=              รายการแถวที่กรอกเอง (แบบเดิม)
 * ดูของผู้อื่น: kpi.view_all
 */
export const kpiRoutes = Router();

interface KpiEntryRow {
  id: number;
  user_id: number;
  entry_type: string;
  ticket_id: number | null;
  work_date: string;
  details: string;
  requester_name: string | null;
  branch_name: string | null;
  service_type: string | null;
  solution: string | null;
  complexity: string | null;
  completed_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  u_name: string | null;
}

const canViewOthers = (u: UserRow) => can(u, "kpi.view_all");
const canEditFor = (u: UserRow, ownerId: number) => can(u, "kpi.use") && (ownerId === u.id || can(u, "kpi.edit_all"));

const SELECT = "k.*, u.name AS u_name FROM kpi_entries k LEFT JOIN users u ON u.id = k.user_id";
const kpiJson = (k: KpiEntryRow, viewer: UserRow) => {
  const complexity = k.complexity === null ? null : Number(k.complexity);
  return {
    id: k.id,
    entry_type: k.entry_type,
    work_date: dateOnly(k.work_date),
    details: k.details,
    requester_name: k.requester_name,
    branch_name: k.branch_name,
    service_type: k.service_type,
    solution: k.solution,
    complexity,
    mark: markOf(complexity),
    completed_date: dateOnly(k.completed_date),
    user: { id: k.user_id, name: k.u_name },
    can_edit: canEditFor(viewer, k.user_id),
    created_at: iso(k.created_at),
    updated_at: iso(k.updated_at),
  };
};

async function findEntry(req: Request): Promise<KpiEntryRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<KpiEntryRow>(`SELECT ${SELECT} WHERE k.id = ? AND k.ticket_id IS NULL`, [id]);
  if (!row) throw notFound();
  return row;
}

/** เจ้าของ KPI ที่จะดู: ไม่ระบุ = ตัวเอง, ผู้อื่น = ต้องมี kpi.view_all */
async function ownerFor(req: Request, userId: unknown): Promise<UserRow> {
  const u = me(req);
  authorize(can(u, "kpi.use"));
  const id = int(userId);
  if (id === null || id === u.id) return u;
  authorize(canViewOthers(u));
  const other = await findUser(id);
  if (!other) throw notFound();
  return other;
}

const serviceTypeRule = (req: Request) => custom((v) => v === null || v === "" || SERVICE_TYPE_NAMES.includes(String(v)), trans(req.locale, "eam.kpi.invalid_service_type"));
const complexityRule = (req: Request) =>
  custom((v) => v === null || v === "" || COMPLEXITY_VALUES.includes(Number(v)), trans(req.locale, "eam.kpi.invalid_complexity"));

/** วันที่แจ้งของแถวงานต้องไม่เป็นอนาคต ("วันนี้" ตาม timezone ผู้ใช้) — แถววันหยุดลงล่วงหน้าได้ */
function entryRules(req: Request, partial: boolean, entryType: string) {
  const s = partial ? ["sometimes"] : [];
  return {
    entry_type: ["sometimes", "in:work,holiday"],
    work_date: [...s, "required", "date", ...(entryType === "work" ? [`before_or_equal:${localToday()}`] : [])],
    details: [...s, "required", "string", "max:5000"],
    requester_name: ["sometimes", "nullable", "string", "max:255"],
    branch_name: ["sometimes", "nullable", "string", "max:100"],
    service_type: ["sometimes", "nullable", "string", serviceTypeRule(req)],
    solution: ["sometimes", "nullable", "string", "max:5000"],
    complexity: ["sometimes", "nullable", complexityRule(req)],
    completed_date: ["sometimes", "nullable", "date"],
    user_id: ["sometimes", "nullable", "integer"],
  };
}
const messages = (req: Request) => ({ "work_date.before_or_equal": trans(req.locale, "eam.kpi.future_date") });

/** ค่าที่บันทึก — แถววันหยุดเก็บแค่วันที่ + ชื่อวันหยุด */
function entryValues(data: Record<string, unknown>, entryType: string): Record<string, unknown> {
  const text = (k: string) => (k in data ? (String(data[k] ?? "").trim() || null) : undefined);
  const v: Record<string, unknown> = {
    work_date: data.work_date === undefined ? undefined : String(data.work_date).slice(0, 10),
    details: data.details === undefined ? undefined : String(data.details).trim(),
  };
  if (entryType === "holiday") {
    Object.assign(v, { requester_name: null, branch_name: null, service_type: null, solution: null, complexity: null, completed_date: null });
    return v;
  }
  Object.assign(v, {
    requester_name: text("requester_name"),
    branch_name: text("branch_name"),
    service_type: text("service_type"),
    solution: text("solution"),
    complexity: "complexity" in data ? (data.complexity === null || data.complexity === "" ? null : Number(data.complexity)) : undefined,
    completed_date: "completed_date" in data ? (data.completed_date ? String(data.completed_date).slice(0, 10) : null) : undefined,
  });
  return v;
}

function assertCompletedAfter(req: Request, workDate: string | null, completed: unknown) {
  if (workDate && completed && String(completed).slice(0, 10) < workDate) {
    throw ValidationError.withMessages({ completed_date: trans(req.locale, "eam.kpi.completed_before") });
  }
}

/* ---------------------------------------------------------------- ตารางรายเดือน */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

kpiRoutes.get("/kpi/month", async (req, res) => {
  const f = await validate(req.input, { user_id: ["nullable", "integer"], month: ["required", "string", regex(MONTH)] }, { locale: req.locale });
  const owner = await ownerFor(req, f.user_id);
  const month = String(f.month);
  const rows = await kpiMonthRows(owner.id, month);
  const editable = canEditFor(me(req), owner.id);
  res.json({
    data: rows.map((r) => ({ ...r, can_edit: editable })),
    totals: kpiTotals(rows),
    user: { id: owner.id, name: owner.name },
    month,
    service_types: SERVICE_TYPES,
    service_type_note: SERVICE_TYPE_NOTE,
    complexity_values: COMPLEXITY_VALUES.map((c) => ({ value: c, mark: markOf(c) })),
  });
});

/** ประเภทการแจ้ง + Complexity ของแถวใบงาน — ข้อมูลอื่นอ่านจากใบงานจริงเสมอ */
kpiRoutes.put("/kpi/tickets/:uuid", async (req, res) => {
  const u = me(req);
  authorize(can(u, "kpi.use"));
  const ticket = await first<{ id: number; assignee_id: number | null; requested_at: string }>(
    "SELECT id, assignee_id, requested_at FROM it_tickets WHERE uuid = ?",
    [String(req.params.uuid)],
  );
  if (!ticket || ticket.assignee_id === null) throw notFound();
  authorize(canEditFor(u, ticket.assignee_id));
  const data = await validate(
    req.input,
    { service_type: ["sometimes", "nullable", "string", serviceTypeRule(req)], complexity: ["sometimes", "nullable", complexityRule(req)] },
    { locale: req.locale },
  );
  const values: Record<string, unknown> = { user_id: ticket.assignee_id, updated_at: nowDb() };
  if ("service_type" in data) values.service_type = data.service_type || null;
  if ("complexity" in data) values.complexity = data.complexity === null || data.complexity === "" ? null : Number(data.complexity);

  const existing = await first<{ id: number }>("SELECT id FROM kpi_entries WHERE ticket_id = ?", [ticket.id]);
  if (existing) await update("kpi_entries", values, "id = ?", [existing.id]);
  else {
    await insert("kpi_entries", {
      ...values,
      ticket_id: ticket.id,
      entry_type: "work",
      work_date: String(ticket.requested_at).slice(0, 10),
      details: "",
      created_at: nowDb(),
    });
  }
  const saved = (await first<{ service_type: string | null; complexity: string | null }>("SELECT service_type, complexity FROM kpi_entries WHERE ticket_id = ?", [ticket.id]))!;
  const complexity = saved.complexity === null ? 0 : Number(saved.complexity);
  res.json({ data: { service_type: saved.service_type, complexity, mark: markOf(complexity) } });
});

/**
 * GET /kpi/people?search= — ช่องผู้แจ้ง: ค้นหาผู้ใช้ทั้งในระบบ (LOCAL) และจาก API (type API) ที่ยังใช้งาน
 * พิมพ์หลายคำได้ (เช่น "สมชาย ลำพูน") — ทุกคำต้องตรงกับชื่อ / ชื่อผู้ใช้ / อีเมล / สาขา / แผนก อย่างใดอย่างหนึ่ง
 * คืนสาขาของผู้ใช้ด้วย เพื่อเติมช่องสาขาให้อัตโนมัติ (สูงสุด 10 คน)
 */
kpiRoutes.get("/kpi/people", async (req, res) => {
  authorize(can(me(req), "kpi.use"));
  const f = await validate(req.input, { search: ["nullable", "string", "max:100"] }, { locale: req.locale });
  const terms = String(f.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where = ["u.is_active = true"];
  const params: unknown[] = [];
  for (const term of terms) {
    const like = `%${likeEscape(term)}%`;
    where.push("(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR b.name LIKE ? OR u.department LIKE ?)");
    params.push(like, like, like, like, like);
  }
  const rows = await select<{ id: number; name: string; type: string; department: string | null; b_id: number | null; b_name: string | null }>(
    `SELECT u.id, u.name, u.type, u.department, b.id AS b_id, b.name AS b_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ${where.join(" AND ")} ORDER BY u.name, u.id LIMIT 10`,
    params,
  );
  res.json({
    data: rows.map((r) => ({ id: r.id, name: r.name, type: r.type, department: r.department, branch: r.b_id ? { id: r.b_id, name: r.b_name } : null })),
  });
});

/* ---------------------------------------------------------------- export */

kpiRoutes.get("/kpi/export", async (req, res) => {
  const f = await validate(
    req.input,
    { user_id: ["nullable", "integer"], from: ["required", "string", regex(MONTH)], to: ["required", "string", regex(MONTH)] },
    { locale: req.locale },
  );
  const owner = await ownerFor(req, f.user_id);
  const from = String(f.from) <= String(f.to) ? String(f.from) : String(f.to);
  const to = String(f.from) <= String(f.to) ? String(f.to) : String(f.from);
  const months = monthsBetween(from, to);
  if (months.length > 24) throw ValidationError.withMessages({ to: trans(req.locale, "eam.kpi.month_range") });

  const safeName = owner.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || `user-${owner.id}`;
  const name = `KPI-IT-${fiscalYear(from)}-${safeName}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="KPI-IT-${fiscalYear(from)}.xlsx"; filename*=utf-8''${encodeURIComponent(name)}`);
  res.send(await buildKpiWorkbook(owner.id, months));
});

/* ---------------------------------------------------------------- แถวที่กรอกเอง */

kpiRoutes.get("/kpi", async (req, res) => {
  const u = me(req);
  authorize(can(u, "kpi.use"));
  const f = await validate(
    req.input,
    {
      user_id: ["nullable", "integer"],
      from: ["nullable", "date"],
      to: ["nullable", "date", "after_or_equal:from"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const userId = int(f.user_id);
  authorize(userId === null || userId === u.id || canViewOthers(u));

  const where: string[] = ["k.ticket_id IS NULL"];
  const params: unknown[] = [];
  // ไม่ระบุผู้ใช้: admin/หัวหน้า IT เห็นทั้งหมด, คนอื่นเห็นของตัวเอง
  if (userId !== null) (where.push("k.user_id = ?"), params.push(userId));
  else if (!canViewOthers(u)) (where.push("k.user_id = ?"), params.push(u.id));
  if (f.from) (where.push("k.work_date >= ?"), params.push(String(f.from).slice(0, 10)));
  if (f.to) (where.push("k.work_date <= ?"), params.push(String(f.to).slice(0, 10)));
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const perPage = int(f.per_page) ?? 20;
  const page = pageParam(req);

  const total = Number(await scalar(`SELECT COUNT(*) FROM kpi_entries k ${whereSql}`, params));
  const rows = await select<KpiEntryRow>(`SELECT ${SELECT} ${whereSql} ORDER BY k.work_date DESC, k.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    perPage,
    (page - 1) * perPage,
  ]);
  res.json({ data: rows.map((k) => kpiJson(k, u)), meta: shortMeta(total, page, perPage, rows.length) });
});

kpiRoutes.post("/kpi", async (req, res) => {
  const u = me(req);
  authorize(can(u, "kpi.use"));
  const entryType = req.input.entry_type === "holiday" ? "holiday" : "work";
  const data = await validate(req.input, entryRules(req, false, entryType), { locale: req.locale, messages: messages(req) });
  // เพิ่มให้ผู้อื่น (หัวหน้า/admin) ต้องมี kpi.edit_all
  const ownerId = int(data.user_id) ?? u.id;
  authorize(canEditFor(u, ownerId));
  if (ownerId !== u.id && !(await findUser(ownerId))) throw notFound();
  assertCompletedAfter(req, String(data.work_date).slice(0, 10), data.completed_date);

  const now = nowDb();
  const id = await insert("kpi_entries", { ...entryValues(data, entryType), entry_type: entryType, user_id: ownerId, created_at: now, updated_at: now });
  res.status(201).json({ data: kpiJson((await first<KpiEntryRow>(`SELECT ${SELECT} WHERE k.id = ?`, [id]))!, u) });
});

async function updateEntry(req: Request, res: import("express").Response) {
  const row = await findEntry(req);
  const u = me(req);
  authorize(canEditFor(u, row.user_id));
  const data = await validate(req.input, entryRules(req, true, row.entry_type), { locale: req.locale, messages: messages(req) });
  const values = entryValues(data, row.entry_type);
  assertCompletedAfter(
    req,
    (values.work_date as string | undefined) ?? dateOnly(row.work_date),
    "completed_date" in values ? values.completed_date : dateOnly(row.completed_date),
  );
  await update("kpi_entries", { ...values, updated_at: nowDb() }, "id = ?", [row.id]);
  res.json({ data: kpiJson((await first<KpiEntryRow>(`SELECT ${SELECT} WHERE k.id = ?`, [row.id]))!, u) });
}
kpiRoutes.put("/kpi/:id", updateEntry);
kpiRoutes.patch("/kpi/:id", updateEntry);

kpiRoutes.delete("/kpi/:id", async (req, res) => {
  const row = await findEntry(req);
  authorize(canEditFor(me(req), row.user_id));
  await exec("DELETE FROM kpi_entries WHERE id = ?", [row.id]);
  res.status(204).end();
});
