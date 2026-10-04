import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, update } from "../db.js";
import { authorize, notFound } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { int, validate } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { can, type UserRow } from "../models/user.js";

/**
 * บันทึกการปฏิบัติงาน (KPI) — เหมือน KpiController ของ Laravel — เฉพาะฝ่าย IT (admin / เจ้าหน้าที่ IT / หัวหน้า IT)
 *   GET    /kpi?user_id=&from=&to=&per_page=   ของตัวเอง (admin / หัวหน้า IT ดูของผู้อื่นได้)
 *   POST   /kpi             { work_date, details }
 *   PATCH  /kpi/{id}        เจ้าของหรือ admin
 *   DELETE /kpi/{id}        เจ้าของหรือ admin
 */
export const kpiRoutes = Router();

interface KpiRow {
  id: number;
  user_id: number;
  work_date: string;
  details: string;
  created_at: string | null;
  updated_at: string | null;
  u_name: string | null;
}

/** ดูบันทึกของผู้อื่นได้: admin และหัวหน้า IT */
const canViewOthers = (u: UserRow) => can(u, "kpi.view_all");
const canEdit = (u: UserRow, row: { user_id: number }) => can(u, "kpi.use") && (row.user_id === u.id || can(u, "kpi.edit_all"));

const SELECT = "k.*, u.name AS u_name FROM kpi_entries k LEFT JOIN users u ON u.id = k.user_id";

const kpiJson = (k: KpiRow, viewer: UserRow) => ({
  id: k.id,
  work_date: dateOnly(k.work_date),
  details: k.details,
  user: { id: k.user_id, name: k.u_name },
  can_edit: canEdit(viewer, k),
  created_at: iso(k.created_at),
  updated_at: iso(k.updated_at),
});

async function findEntry(req: Request): Promise<KpiRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<KpiRow>(`SELECT ${SELECT} WHERE k.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

/** วันที่ปฏิบัติงานต้องไม่เป็นวันในอนาคต — "วันนี้" ตาม timezone ผู้ใช้ (EAM_LOCAL_TIMEZONE) ไม่ใช่ UTC ของ server */
const rules = (partial: boolean) => {
  const s = partial ? ["sometimes"] : [];
  return {
    work_date: [...s, "required", "date", `before_or_equal:${localToday()}`],
    details: [...s, "required", "string", "max:5000"],
  };
};
const messages = (req: Request) => ({ "work_date.before_or_equal": trans(req.locale, "eam.kpi.future_date") });

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

  const where: string[] = [];
  const params: unknown[] = [];
  // ไม่ระบุผู้ใช้: admin/หัวหน้า IT เห็นทั้งหมด, คนอื่นเห็นของตัวเอง
  if (userId !== null) (where.push("k.user_id = ?"), params.push(userId));
  else if (!canViewOthers(u)) (where.push("k.user_id = ?"), params.push(u.id));
  if (f.from) (where.push("k.work_date >= ?"), params.push(String(f.from).slice(0, 10)));
  if (f.to) (where.push("k.work_date <= ?"), params.push(String(f.to).slice(0, 10)));
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const perPage = int(f.per_page) ?? 20;
  const page = pageParam(req);

  const total = Number(await scalar(`SELECT COUNT(*) FROM kpi_entries k ${whereSql}`, params));
  const rows = await select<KpiRow>(`SELECT ${SELECT} ${whereSql} ORDER BY k.work_date DESC, k.id DESC LIMIT ? OFFSET ?`, [
    ...params, perPage, (page - 1) * perPage,
  ]);
  res.json({ data: rows.map((k) => kpiJson(k, u)), meta: shortMeta(total, page, perPage, rows.length) });
});

kpiRoutes.post("/kpi", async (req, res) => {
  const u = me(req);
  authorize(can(u, "kpi.use"));
  const data = await validate(req.input, rules(false), { locale: req.locale, messages: messages(req) });
  const now = nowDb();
  const id = await insert("kpi_entries", {
    user_id: u.id,
    work_date: String(data.work_date).slice(0, 10),
    details: data.details,
    created_at: now,
    updated_at: now,
  });
  res.status(201).json({ data: kpiJson((await first<KpiRow>(`SELECT ${SELECT} WHERE k.id = ?`, [id]))!, u) });
});

async function updateEntry(req: Request, res: import("express").Response) {
  const row = await findEntry(req);
  const u = me(req);
  authorize(canEdit(u, row));
  const data = await validate(req.input, rules(true), { locale: req.locale, messages: messages(req) });
  await update(
    "kpi_entries",
    {
      work_date: data.work_date === undefined ? undefined : String(data.work_date).slice(0, 10),
      details: data.details,
      updated_at: nowDb(),
    },
    "id = ?",
    [row.id],
  );
  res.json({ data: kpiJson((await first<KpiRow>(`SELECT ${SELECT} WHERE k.id = ?`, [row.id]))!, u) });
}
kpiRoutes.put("/kpi/:id", updateEntry);
kpiRoutes.patch("/kpi/:id", updateEntry);

kpiRoutes.delete("/kpi/:id", async (req, res) => {
  const row = await findEntry(req);
  authorize(canEdit(me(req), row));
  await exec("DELETE FROM kpi_entries WHERE id = ?", [row.id]);
  res.status(204).end();
});
