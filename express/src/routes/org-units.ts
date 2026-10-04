import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, custom, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";

/**
 * ข้อมูลหลัก: แผนก / ฝ่าย (สิทธิ์ org.manage)
 *   GET    /departments | /divisions           ที่เปิดใช้งาน (ทุกคน — ใช้ในฟอร์ม) · ?include_inactive=1 (org.manage) = ทั้งหมด + จำนวนผู้ใช้
 *   POST   /departments | /divisions           { name, is_active?, sort_order? }
 *   PUT|PATCH /departments/{id} | /divisions/{id}  เปลี่ยนชื่อ → อัปเดตชื่อในผู้ใช้ (และสายอนุมัติสำหรับแผนก) ให้ด้วย
 *   DELETE /departments/{id} | /divisions/{id} ลบได้เมื่อไม่มีผู้ใช้ใช้อยู่ — มิฉะนั้นให้ปิดใช้งาน
 * users.department / users.division ยังเก็บเป็นชื่อ (ข้อความ) เหมือนเดิม
 */
export const orgUnitRoutes = Router();

interface UnitRow {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
}

const UNITS = {
  departments: { userColumn: "department", alsoIn: ["approval_routes"] as string[], label: "department" },
  divisions: { userColumn: "division", alsoIn: [] as string[], label: "division" },
} as const;

type Table = keyof typeof UNITS;

const usage = (table: Table) =>
  `(SELECT COUNT(*) FROM users u WHERE LOWER(TRIM(u.${UNITS[table].userColumn})) = LOWER(o.name)) AS users_count`;

const json = (r: UnitRow & { users_count?: number | string }) => ({
  id: r.id,
  name: r.name,
  is_active: Boolean(r.is_active),
  sort_order: Number(r.sort_order),
  ...(r.users_count !== undefined ? { users_count: Number(r.users_count) } : {}),
});

function register(table: Table) {
  const cfg = UNITS[table];
  const find = async (req: Request) => {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const row = Number.isNaN(id) ? null : await first<UnitRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw notFound();
    return row;
  };
  const input = (req: Request, current: UnitRow | null) =>
    validate(
      req.input,
      {
        name: [current ? "sometimes" : "required", "string", "max:100", custom(async (v) => {
          const dup = await scalar(`SELECT 1 FROM ${table} WHERE LOWER(name) = LOWER(?)${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()]);
          return dup === null;
        }, trans(req.locale, "eam.org.duplicate"))],
        is_active: ["sometimes", "boolean"],
        sort_order: ["sometimes", "integer", "min:0", "max:9999"],
      },
      { locale: req.locale },
    );

  orgUnitRoutes.get(`/${table}`, async (req, res) => {
    if (bool(req.query.include_inactive)) {
      authorize(can(me(req), "org.manage"));
      const rows = await select<UnitRow & { users_count: number }>(`SELECT o.*, ${usage(table)} FROM ${table} o ORDER BY o.sort_order, o.name`);
      return res.json({ data: rows.map(json) });
    }
    const rows = await select<UnitRow>(`SELECT * FROM ${table} WHERE is_active = true ORDER BY sort_order, name`);
    res.json({ data: rows.map(json) });
  });

  orgUnitRoutes.post(`/${table}`, async (req, res) => {
    authorize(can(me(req), "org.manage"));
    const data = await input(req, null);
    const now = nowDb();
    const id = await insert(table, {
      name: String(data.name).trim(),
      is_active: "is_active" in data ? bool(data.is_active) : true,
      sort_order: data.sort_order ?? 0,
      created_at: now,
      updated_at: now,
    });
    const row = (await first<UnitRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]))!;
    await audit(req, { action: `${cfg.label}.created`, subjectType: cfg.label, subjectId: id, after: json(row) });
    res.status(201).json({ data: json(row) });
  });

  const save = async (req: Request, res: import("express").Response) => {
    authorize(can(me(req), "org.manage"));
    const current = await find(req);
    const data = await input(req, current);
    const changes: Record<string, unknown> = { updated_at: nowDb() };
    if ("name" in data) changes.name = String(data.name).trim();
    if ("is_active" in data) changes.is_active = bool(data.is_active);
    if ("sort_order" in data) changes.sort_order = data.sort_order;
    await transaction(async () => {
      await update(table, changes, "id = ?", [current.id]);
      // เปลี่ยนชื่อ → ชื่อในข้อมูลที่อ้างถึงเปลี่ยนตาม
      if (typeof changes.name === "string" && changes.name !== current.name) {
        for (const t of ["users", ...cfg.alsoIn]) {
          await exec(`UPDATE ${t} SET ${cfg.userColumn} = ?, updated_at = ? WHERE LOWER(TRIM(${cfg.userColumn})) = LOWER(?)`, [changes.name, nowDb(), current.name]);
        }
      }
    });
    const row = (await first<UnitRow>(`SELECT * FROM ${table} WHERE id = ?`, [current.id]))!;
    await audit(req, { action: `${cfg.label}.updated`, subjectType: cfg.label, subjectId: current.id, before: json(current), after: json(row) });
    res.json({ data: json(row) });
  };
  orgUnitRoutes.put(`/${table}/:id`, save);
  orgUnitRoutes.patch(`/${table}/:id`, save);

  orgUnitRoutes.delete(`/${table}/:id`, async (req, res) => {
    authorize(can(me(req), "org.manage"));
    const current = await find(req);
    const used = Number(await scalar(`SELECT COUNT(*) FROM users WHERE LOWER(TRIM(${cfg.userColumn})) = LOWER(?)`, [current.name]));
    if (used > 0) throw ValidationError.withMessages({ name: trans(req.locale, "eam.org.in_use", { count: used }) });
    await exec(`DELETE FROM ${table} WHERE id = ?`, [current.id]);
    await audit(req, { action: `${cfg.label}.deleted`, subjectType: cfg.label, subjectId: current.id, before: json(current) });
    res.status(204).end();
  });
}

register("departments");
register("divisions");
