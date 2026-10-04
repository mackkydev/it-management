import { Router, type Request, type Response } from "express";
import { exec, first, insert, select, update } from "../db.js";
import { authorize, notFound } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { bool, int, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";

/**
 * ประกาศจากฝ่าย IT บนหน้า login — เหมือน AnnouncementController ของ Laravel
 *   GET    /announcements/public       (ไม่ต้อง login) ประกาศที่เปิดอยู่และอยู่ในช่วงวันที่ ≤ 5 รายการ
 *   GET    /announcements              ทั้งหมด (admin / ฝ่าย IT)
 *   POST   /announcements              { title, body, level, is_active, starts_on, ends_on, sort_order }
 *   PUT|PATCH|DELETE /announcements/{id}
 */
export const announcementRoutes = Router();
export const publicAnnouncementRoutes = Router();

const LEVELS = ["info", "warning", "danger"];

interface Row {
  id: number;
  title: string;
  body: string | null;
  level: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
  cb_id: number | null;
  cb_name: string | null;
}

const SELECT = "a.*, u.id AS cb_id, u.name AS cb_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by";

const publicJson = (r: Row) => ({ id: r.id, title: r.title, body: r.body, level: r.level, starts_on: dateOnly(r.starts_on), ends_on: dateOnly(r.ends_on) });

const json = (r: Row) => ({
  ...publicJson(r),
  is_active: Boolean(r.is_active),
  sort_order: Number(r.sort_order),
  created_by: r.cb_id ? { id: r.cb_id, name: r.cb_name } : null,
  updated_at: iso(r.updated_at),
});

/** ไม่ต้อง login — หน้า login ดึงไปแสดง */
publicAnnouncementRoutes.get("/announcements/public", async (_req, res) => {
  const today = localToday();
  const rows = await select<Row>(
    `SELECT ${SELECT}
      WHERE a.is_active = true AND (a.starts_on IS NULL OR a.starts_on <= ?) AND (a.ends_on IS NULL OR a.ends_on >= ?)
      ORDER BY a.sort_order, a.id DESC LIMIT 5`,
    [today, today],
  );
  res.json({ data: rows.map(publicJson) });
});

const manage = (req: Request) => authorize(can(me(req), "announcements.manage"));

announcementRoutes.get("/announcements", async (req, res) => {
  manage(req);
  const rows = await select<Row>(`SELECT ${SELECT} ORDER BY a.sort_order, a.id DESC`);
  res.json({ data: rows.map(json) });
});

async function findRow(req: Request): Promise<Row> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<Row>(`SELECT ${SELECT} WHERE a.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

const validated = (req: Request) =>
  validate(
    req.input,
    {
      title: ["required", "string", "max:200"],
      body: ["nullable", "string", "max:2000"],
      level: ["required", `in:${LEVELS.join(",")}`],
      is_active: ["sometimes", "boolean"],
      starts_on: ["nullable", "date"],
      ends_on: ["nullable", "date"],
      sort_order: ["nullable", "integer", "min:0", "max:999"],
    },
    {
      locale: req.locale,
      after: ({ data, errors }) => {
        const s = data.starts_on;
        const e = data.ends_on;
        if (typeof s === "string" && typeof e === "string" && s && e && e.slice(0, 10) < s.slice(0, 10) && !errors.has("ends_on")) {
          errors.add("ends_on", trans(req.locale, "eam.announcement.ends_before_starts"));
        }
      },
    },
  );

function values(data: Record<string, unknown>, input: Record<string, unknown>) {
  const date = (v: unknown) => (typeof v === "string" && v !== "" ? v.slice(0, 10) : null);
  return {
    title: String(data.title).trim(),
    body: typeof data.body === "string" && data.body.trim() !== "" ? data.body.trim() : null,
    level: data.level,
    is_active: "is_active" in input ? bool(input.is_active) : true,
    starts_on: date(data.starts_on),
    ends_on: date(data.ends_on),
    sort_order: int(data.sort_order) ?? 0,
    updated_at: nowDb(),
  };
}

announcementRoutes.post("/announcements", async (req, res) => {
  manage(req);
  const data = await validated(req);
  const id = await insert("announcements", { ...values(data, req.input), created_by: me(req).id, created_at: nowDb() });
  res.status(201).json({ data: json((await first<Row>(`SELECT ${SELECT} WHERE a.id = ?`, [id]))!) });
});

async function updateRow(req: Request, res: Response) {
  const row = await findRow(req);
  manage(req);
  const data = await validated(req);
  await update("announcements", values(data, req.input), "id = ?", [row.id]);
  res.json({ data: json((await first<Row>(`SELECT ${SELECT} WHERE a.id = ?`, [row.id]))!) });
}
announcementRoutes.put("/announcements/:id", updateRow);
announcementRoutes.patch("/announcements/:id", updateRow);

announcementRoutes.delete("/announcements/:id", async (req, res) => {
  const row = await findRow(req);
  manage(req);
  await exec("DELETE FROM announcements WHERE id = ?", [row.id]);
  res.status(204).end();
});
