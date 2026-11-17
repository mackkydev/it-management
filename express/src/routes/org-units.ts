import ExcelJS from "exceljs";
import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, custom, exists, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { cellValue } from "../services/asset-import.js";
import { audit } from "../services/audit.js";

/**
 * ข้อมูลหลัก: แผนก / ฝ่าย (สิทธิ์ org.manage)
 *   GET    /departments | /divisions           ที่เปิดใช้งาน (ทุกคน — ใช้ในฟอร์ม) · ?include_inactive=1 (org.manage) = ทั้งหมด + จำนวนผู้ใช้
 *   POST   /departments | /divisions           { name, is_active?, sort_order? } — แผนกส่ง division_id (ฝ่ายที่สังกัด, ไม่บังคับ) ได้
 *   GET    /departments?division_id=            เฉพาะแผนกในฝ่ายนั้น (ฟอร์มที่เลือกฝ่ายก่อน)
 *   ฝ่ายส่ง department_ids (แผนกในฝ่ายนี้) ได้ — ผลเหมือนตั้ง division_id ที่แผนกเหล่านั้น; GET ฝ่ายคืน departments ด้วย
 *   GET    /org-units/import-template · POST /org-units/import   รายการหน่วยงาน Unit Code | Description | ชื่อไทย (1 แถว = ทั้งฝ่ายและแผนก, .xlsx/.csv/.txt)
 *          ไฟล์ Excel 2 แผ่นแบบเดิม (ฝ่าย / แผนก) ยังนำเข้าได้
 *   PUT|PATCH /departments/{id} | /divisions/{id}  เปลี่ยนชื่อ → อัปเดตชื่อในผู้ใช้ (และสายอนุมัติสำหรับแผนก) ให้ด้วย
 *   DELETE /departments/{id} | /divisions/{id} ลบได้เมื่อไม่มีผู้ใช้ใช้อยู่ — มิฉะนั้นให้ปิดใช้งาน
 * users.department / users.division ยังเก็บเป็นชื่อ (ข้อความ) เหมือนเดิม
 */
export const orgUnitRoutes = Router();

interface UnitRow {
  id: number;
  name: string;
  /** ตัวย่อ (Unit Code ของ SyteLine) */
  code: string | null;
  /** ชื่ออังกฤษ (name = ชื่อไทย) */
  name_en: string | null;
  is_active: boolean;
  sort_order: number;
  /** เฉพาะแผนก */
  division_id?: number | null;
  division_name?: string | null;
  /** เฉพาะฝ่าย: แผนกในฝ่ายนี้ */
  departments?: { id: number; name: string }[];
}

const UNITS = {
  departments: { userColumn: "department", alsoIn: ["approval_routes"] as string[], label: "department" },
  divisions: { userColumn: "division", alsoIn: [] as string[], label: "division" },
} as const;

type Table = keyof typeof UNITS;

/** ตัวย่อ (Unit Code) — เดียวกับรหัสแผนก/หมวดของ SyteLine */
const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;
const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const usage = (table: Table) =>
  `(SELECT COUNT(*) FROM users u WHERE LOWER(TRIM(u.${UNITS[table].userColumn})) = LOWER(o.name)) AS users_count`;

const json = (r: UnitRow & { users_count?: number | string }) => ({
  id: r.id,
  name: r.name,
  code: r.code ?? null,
  name_en: r.name_en ?? null,
  is_active: Boolean(r.is_active),
  sort_order: Number(r.sort_order),
  ...(r.division_id !== undefined ? { division: r.division_id ? { id: Number(r.division_id), name: r.division_name ?? "" } : null } : {}),
  ...(r.departments !== undefined ? { departments: r.departments } : {}),
  ...(r.users_count !== undefined ? { users_count: Number(r.users_count) } : {}),
});

/** ฝ่าย: พ่วงรายชื่อแผนกในฝ่าย */
async function withDepartments<R extends UnitRow>(table: Table, rows: R[]): Promise<R[]> {
  if (table !== "divisions" || !rows.length) return rows;
  const deps = await select<{ id: number; name: string; division_id: number }>(
    "SELECT id, name, division_id FROM departments WHERE division_id IN (?) ORDER BY sort_order, name",
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({ ...r, departments: deps.filter((d) => Number(d.division_id) === Number(r.id)).map((d) => ({ id: Number(d.id), name: d.name })) }));
}

/** ฝ่าย: แผนกที่เลือก = อยู่ในฝ่ายนี้, แผนกที่เคยอยู่แต่ไม่ได้เลือกแล้ว = ไม่สังกัดฝ่าย */
async function setDivisionDepartments(divisionId: number, ids: number[]) {
  await exec(`UPDATE departments SET division_id = NULL, updated_at = ? WHERE division_id = ?${ids.length ? " AND id NOT IN (?)" : ""}`, ids.length ? [nowDb(), divisionId, ids] : [nowDb(), divisionId]);
  if (ids.length) await exec("UPDATE departments SET division_id = ?, updated_at = ? WHERE id IN (?)", [divisionId, nowDb(), ids]);
}

/**
 * หน้า "ฝ่ายและแผนก" แท็บเดียว — ฝ่ายกับแผนกใช้ชื่อเดียวกัน: แก้แผนกพร้อม mirror_division = ฝ่ายคู่กันเปลี่ยนตาม
 * ฝ่ายคู่กัน = ตัวย่อเดียวกัน ไม่งั้นชื่อเดียวกัน (ไม่มี = สร้างใหม่) แล้วผูกแผนกไว้ใต้ฝ่ายนั้น
 */
const pairedDivision = async (u: { name: string; code: string | null }) =>
  (u.code ? await first<UnitRow>("SELECT * FROM divisions WHERE code = ?", [u.code]) : null) ??
  (await first<UnitRow>("SELECT * FROM divisions WHERE LOWER(TRIM(name)) = LOWER(?)", [u.name.trim()]));

async function mirrorDivision(locale: import("../lib/i18n.js").Locale, before: UnitRow | null, after: UnitRow): Promise<void> {
  const pair = (before ? await pairedDivision(before) : null) ?? (await pairedDivision(after));
  const now = nowDb();
  // ชื่อ/ตัวย่อชนกับฝ่ายอื่น (ที่ไม่ใช่คู่กัน) = บันทึกไม่ได้ทั้งคู่
  const clash = await scalar(
    `SELECT 1 FROM divisions WHERE (LOWER(TRIM(name)) = LOWER(?)${after.code ? " OR code = ?" : ""}) AND id <> ? LIMIT 1`,
    after.code ? [after.name.trim(), after.code, pair?.id ?? 0] : [after.name.trim(), pair?.id ?? 0],
  );
  if (clash !== null) throw ValidationError.withMessages({ name: trans(locale, "eam.org.duplicate") });
  const values = { name: after.name, code: after.code, name_en: after.name_en, is_active: Boolean(after.is_active), sort_order: after.sort_order, updated_at: now };
  let divisionId: number;
  if (pair) {
    await update("divisions", values, "id = ?", [pair.id]);
    if (pair.name !== after.name) {
      await exec("UPDATE users SET division = ?, updated_at = ? WHERE LOWER(TRIM(division)) = LOWER(?)", [after.name, now, pair.name]);
    }
    divisionId = Number(pair.id);
  } else {
    divisionId = await insert("divisions", { ...values, created_at: now });
  }
  if (Number(after.division_id ?? 0) !== divisionId) await update("departments", { division_id: divisionId, updated_at: now }, "id = ?", [after.id]);
}

/** SELECT ของแต่ละตาราง — แผนกพ่วงชื่อฝ่ายที่สังกัด */
const selectFrom = (table: Table) =>
  table === "departments"
    ? "SELECT o.*, dv.name AS division_name FROM departments o LEFT JOIN divisions dv ON dv.id = o.division_id"
    : "SELECT o.* FROM divisions o";

function register(table: Table) {
  const cfg = UNITS[table];
  /** แผนกจากหน้าแท็บเดียว: body mirror_division / DELETE ?mirror_division=1 */
  const mirror = (req: Request) => table === "departments" && bool(req.input.mirror_division ?? req.query.mirror_division);
  const find = async (req: Request) => {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const row = Number.isNaN(id) ? null : await first<UnitRow>(`${selectFrom(table)} WHERE o.id = ?`, [id]);
    if (!row) throw notFound();
    return (await withDepartments(table, [row]))[0];
  };
  const load = async (id: number) => (await withDepartments(table, [(await first<UnitRow>(`${selectFrom(table)} WHERE o.id = ?`, [id]))!]))[0];
  /** ฝ่าย: department_ids (ไม่ส่ง = ไม่แตะ) */
  const departmentIds = async (req: Request): Promise<number[] | undefined> => {
    if (table !== "divisions" || req.input.department_ids === undefined) return undefined;
    const raw = req.input.department_ids;
    const ids = [...new Set((Array.isArray(raw) ? raw : raw === null || raw === "" ? [] : [raw]).map(Number))];
    if (ids.some((x) => !Number.isInteger(x) || x <= 0)) throw ValidationError.withMessages({ department_ids: trans(req.locale, "eam.org.departments_invalid") });
    if (ids.length && (await select("SELECT id FROM departments WHERE id IN (?)", [ids])).length !== ids.length) {
      throw ValidationError.withMessages({ department_ids: trans(req.locale, "eam.org.departments_invalid") });
    }
    return ids;
  };
  const input = (req: Request, current: UnitRow | null) =>
    validate(
      req.input,
      {
        name: [current ? "sometimes" : "required", "string", "max:100", custom(async (v) => {
          const dup = await scalar(`SELECT 1 FROM ${table} WHERE LOWER(name) = LOWER(?)${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()]);
          return dup === null;
        }, trans(req.locale, "eam.org.duplicate"))],
        code: ["sometimes", "nullable", "string", "max:20", custom((v) => CODE_RE.test(String(v).trim()), trans(req.locale, "eam.org.code_invalid")), custom(async (v) => {
          const dup = await scalar(`SELECT 1 FROM ${table} WHERE code = ?${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()]);
          return dup === null;
        }, trans(req.locale, "eam.org.code_duplicate"))],
        name_en: ["sometimes", "nullable", "string", "max:150"],
        is_active: ["sometimes", "boolean"],
        sort_order: ["sometimes", "integer", "min:0", "max:9999"],
        ...(table === "departments" ? { division_id: ["sometimes", "nullable", "integer", exists("divisions", "id")] } : {}),
      },
      { locale: req.locale },
    );

  orgUnitRoutes.get(`/${table}`, async (req, res) => {
    if (bool(req.query.include_inactive)) {
      authorize(can(me(req), "org.manage"));
      const rows = await select<UnitRow & { users_count: number }>(`${selectFrom(table).replace("SELECT o.*", `SELECT o.*, ${usage(table)}`)} ORDER BY o.sort_order, o.name`);
      return res.json({ data: (await withDepartments(table, rows)).map(json) });
    }
    const divisionId = table === "departments" && /^\d+$/.test(String(req.query.division_id ?? "")) ? Number(req.query.division_id) : null;
    const rows = await select<UnitRow>(
      `${selectFrom(table)} WHERE o.is_active = true${divisionId ? " AND o.division_id = ?" : ""} ORDER BY o.sort_order, o.name`,
      divisionId ? [divisionId] : [],
    );
    res.json({ data: (await withDepartments(table, rows)).map(json) });
  });

  orgUnitRoutes.post(`/${table}`, async (req, res) => {
    authorize(can(me(req), "org.manage"));
    const data = await input(req, null);
    const deps = await departmentIds(req);
    const now = nowDb();
    let id = 0;
    await transaction(async () => {
      id = await insert(table, {
        name: String(data.name).trim(),
        code: textOrNull(data.code),
        name_en: textOrNull(data.name_en),
        is_active: "is_active" in data ? bool(data.is_active) : true,
        sort_order: data.sort_order ?? 0,
        ...(table === "departments" ? { division_id: data.division_id ? Number(data.division_id) : null } : {}),
        created_at: now,
        updated_at: now,
      });
      if (deps) await setDivisionDepartments(id, deps);
      if (mirror(req)) await mirrorDivision(req.locale, null, (await first<UnitRow>("SELECT * FROM departments WHERE id = ?", [id]))!);
    });
    const row = await load(id);
    await audit(req, { action: `${cfg.label}.created`, subjectType: cfg.label, subjectId: id, after: json(row) });
    res.status(201).json({ data: json(row) });
  });

  const save = async (req: Request, res: import("express").Response) => {
    authorize(can(me(req), "org.manage"));
    const current = await find(req);
    const data = await input(req, current);
    const deps = await departmentIds(req);
    const changes: Record<string, unknown> = { updated_at: nowDb() };
    if ("name" in data) changes.name = String(data.name).trim();
    if ("code" in data) changes.code = textOrNull(data.code);
    if ("name_en" in data) changes.name_en = textOrNull(data.name_en);
    if ("is_active" in data) changes.is_active = bool(data.is_active);
    if ("sort_order" in data) changes.sort_order = data.sort_order;
    if (table === "departments" && "division_id" in data) changes.division_id = data.division_id ? Number(data.division_id) : null;
    await transaction(async () => {
      await update(table, changes, "id = ?", [current.id]);
      if (deps) await setDivisionDepartments(current.id, deps);
      // เปลี่ยนชื่อ → ชื่อในข้อมูลที่อ้างถึงเปลี่ยนตาม
      if (typeof changes.name === "string" && changes.name !== current.name) {
        for (const t of ["users", ...cfg.alsoIn]) {
          await exec(`UPDATE ${t} SET ${cfg.userColumn} = ?, updated_at = ? WHERE LOWER(TRIM(${cfg.userColumn})) = LOWER(?)`, [changes.name, nowDb(), current.name]);
        }
      }
      if (mirror(req)) await mirrorDivision(req.locale, current, (await first<UnitRow>("SELECT * FROM departments WHERE id = ?", [current.id]))!);
    });
    const row = await load(current.id);
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
    // แท็บเดียว: ลบฝ่ายคู่กันด้วย (ต้องไม่มีผู้ใช้ในฝ่ายนั้นเช่นกัน)
    const pair = mirror(req) ? await pairedDivision(current) : null;
    if (pair) {
      const inDivision = Number(await scalar("SELECT COUNT(*) FROM users WHERE LOWER(TRIM(division)) = LOWER(?)", [pair.name]));
      if (inDivision > 0) throw ValidationError.withMessages({ name: trans(req.locale, "eam.org.in_use", { count: inDivision }) });
    }
    await transaction(async () => {
      await exec(`DELETE FROM ${table} WHERE id = ?`, [current.id]);
      if (pair) {
        await exec("UPDATE departments SET division_id = NULL WHERE division_id = ?", [pair.id]);
        await exec("DELETE FROM divisions WHERE id = ?", [pair.id]);
      }
    });
    await audit(req, { action: `${cfg.label}.deleted`, subjectType: cfg.label, subjectId: current.id, before: json(current) });
    res.status(204).end();
  });
}

register("departments");
register("divisions");

/* ---------------------------------------------------------------- นำเข้า / template Excel (ฝ่าย + แผนก) */

const ACTIVE_WORDS = { th: ["ใช้งาน", "ปิดใช้งาน"], en: ["Active", "Inactive"] };
const words = (req: Request) => (req.locale === "en" ? ACTIVE_WORDS.en : ACTIVE_WORDS.th);
const isInactive = (v: string) => ["ปิดใช้งาน", "inactive", "no", "n", "0", "false", "ไม่"].includes(v.trim().toLowerCase());

/** หัวคอลัมน์ตัวย่อที่รู้จัก (ไฟล์ Unit Code ของ SyteLine / template ไทย-อังกฤษ) */
const CODE_HEADERS = ["unit code", "code", "ตัวย่อ", "รหัส"];

type UnitItem = { row: number; code: string; name: string; name_en: string | null };

/** ข้อความในไฟล์: BOM UTF-16 (ไฟล์ที่ SyteLine ส่งออก) / UTF-8 */
function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  return buf.toString("utf8").replace(/^﻿/, "");
}

/** แยกบรรทัด CSV/TSV (คั่นด้วย tab ถ้ามี ไม่งั้น comma — รองรับ "..." ที่มี comma) */
function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * ไฟล์รายการหน่วยงาน (ตัวย่อ | ชื่ออังกฤษ | ชื่อไทย) — ไฟล์ Unit Code ของ SyteLine (.csv/.txt UTF-16 คั่น tab) หรือ template แผ่นเดียว
 * ไม่ใช่รูปแบบนี้ (หัวคอลัมน์แรกไม่ใช่ตัวย่อ) = null → ใช้การนำเข้าแบบ 2 แผ่นเดิม (ฝ่าย / แผนก)
 */
async function readUnitList(file: UploadedFile): Promise<{ rows: string[][] } | null | "unreadable"> {
  const buf = file.buffer as Buffer;
  let rows: string[][];
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      return "unreadable";
    }
    const ws = wb.worksheets[0];
    const read: string[][] = [];
    ws?.eachRow({ includeEmpty: true }, (row, n) => {
      read[n - 1] = [1, 2, 3].map((c) => {
        const v = cellValue(row.getCell(c).value);
        return v === null || v instanceof Date ? "" : String(v).trim();
      });
    });
    rows = Array.from(read, (r) => r ?? ["", "", ""]);
  } else {
    rows = decodeText(buf).split(/\r?\n/).map(splitLine);
  }
  const head = (rows[0]?.[0] ?? "").toLowerCase();
  if (!CODE_HEADERS.some((h) => head === h || head.startsWith(`${h} `) || head.startsWith(`${h}(`))) return null;
  return { rows: rows.slice(1) };
}

/**
 * GET /org-units/import-template — แผ่นเดียว "หน่วยงาน" รูปแบบเดียวกับไฟล์ Unit Code ของ SyteLine: Unit Code | Description | ชื่อไทย
 * 1 แถว = ทั้งฝ่ายและแผนก (ไม่แยก) — เติมข้อมูลในระบบไว้แล้ว (แผนก + ฝ่ายที่ไม่มีแผนกชื่อ/ตัวย่อเดียวกัน)
 */
orgUnitRoutes.get("/org-units/import-template", async (req, res) => {
  authorize(can(me(req), "org.manage"));
  const t = (k: string) => trans(req.locale, `eam.org.${k}`);
  const all = [
    ...(await select<UnitRow>("SELECT * FROM departments ORDER BY sort_order, name")),
    ...(await select<UnitRow>("SELECT * FROM divisions ORDER BY sort_order, name")),
  ];
  const seen = new Set<string>();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t("sheet_units"));
  ws.columns = [
    { header: t("col_code"), width: 14 },
    { header: t("col_name_en"), width: 44 },
    { header: t("col_name_th"), width: 40 },
  ];
  for (const u of all) {
    const keys = [u.code ? `c:${u.code.toLowerCase()}` : null, `n:${u.name.trim().toLowerCase()}`].filter((k): k is string => k !== null);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    ws.addRow([u.code ?? "", u.name_en ?? "", u.name]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const help = wb.addWorksheet(trans(req.locale, "eam.asset_import.help_sheet"));
  help.columns = [{ width: 110 }];
  for (const line of t("units_help").split("\n")) help.addRow([line]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="units.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/**
 * นำเข้ารายการหน่วยงาน: 1 แถว = ทั้งฝ่ายและแผนก — จับคู่ด้วยตัวย่อก่อน แล้วชื่อไทย (ไม่สนตัวพิมพ์)
 * มีอยู่ = ตั้งตัวย่อ + ชื่ออังกฤษ (ไม่เปลี่ยนชื่อไทย), ไม่มี = เพิ่มใหม่; แผนกที่ยังไม่สังกัดฝ่าย = ผูกกับฝ่ายตัวย่อเดียวกัน
 * ผิดแม้แถวเดียว (ตัวย่อผิดรูปแบบ, ไม่มีชื่อ, ตัวย่อซ้ำในไฟล์, ชื่อเดิมมีตัวย่ออื่นอยู่แล้ว) = ไม่บันทึกเลย
 * ชื่อไทยซ้ำกับแถวก่อนหน้า (ตัวย่อต่างกัน) = เติมตัวย่อท้ายชื่อ "ชื่อ (CODE)"
 */
async function importUnits(req: Request, res: import("express").Response, rows: string[][]) {
  const t = (k: string, p?: Record<string, string | number>) => trans(req.locale, `eam.org.${k}`, p);
  const errors: { row: number; message: string }[] = [];
  const items: UnitItem[] = [];
  const codes = new Map<string, number>();
  const names = new Map<string, number>();
  rows.forEach((cells, i) => {
    const n = i + 2;
    const [code = "", en = "", th = ""] = cells;
    if (!code && !en && !th) return;
    const err = (message: string) => {
      errors.push({ row: n, message });
    };
    let name = th || en;
    if (!CODE_RE.test(code)) return err(t("code_invalid"));
    if (!name) return err(t("name_required"));
    if (en.length > 150) return err(trans(req.locale, "eam.asset_import.too_long", { column: t("col_name_en"), max: 150 }));
    const ck = code.toLowerCase();
    if (codes.has(ck)) return err(t("code_duplicate_row", { row: codes.get(ck)! }));
    // ชื่อไทยซ้ำกับแถวก่อนหน้า (ตัวย่อต่างกัน เช่น IS / QC "ควบคุมคุณภาพ") = เติมตัวย่อท้ายชื่อ "ควบคุมคุณภาพ (QC)"
    if (names.has(name.toLowerCase())) name = `${name} (${code})`;
    if (name.length > 100) return err(trans(req.locale, "eam.asset_import.too_long", { column: t("col_name_th"), max: 100 }));
    const nk = name.toLowerCase();
    if (names.has(nk)) return err(t("duplicate_row", { row: names.get(nk)! }));
    codes.set(ck, n);
    names.set(nk, n);
    items.push({ row: n, code, name, name_en: en || null });
  });
  // ชื่อไทยเดิมที่มีตัวย่ออื่นอยู่แล้ว (และตัวย่อในไฟล์ยังไม่มีใครใช้) — ไม่เดาว่าต้องการเปลี่ยนตัวย่อ
  for (const table of ["divisions", "departments"] as const) {
    const existing = await select<{ code: string | null; name: string }>(`SELECT code, name FROM ${table}`);
    const usedCodes = new Set(existing.filter((e) => e.code).map((e) => e.code!.toLowerCase()));
    for (const it of items) {
      if (usedCodes.has(it.code.toLowerCase()) || errors.some((e) => e.row === it.row)) continue;
      const same = existing.find((e) => e.name.trim().toLowerCase() === it.name.toLowerCase());
      if (same?.code) errors.push({ row: it.row, message: t("code_taken", { name: it.name, current: same.code, code: it.code }) });
    }
  }
  if (!items.length && !errors.length) errors.push({ row: 0, message: trans(req.locale, "eam.asset_import.empty") });
  if (errors.length) {
    return res.status(422).json({ message: trans(req.locale, "eam.asset_import.failed"), rows: errors.sort((a, b) => a.row - b.row) });
  }

  const counts = { created: 0, updated: 0 };
  await transaction(async () => {
    const now = nowDb();
    type Found = { id: number; division_id?: number | null };
    const upsert = async (table: Table, it: UnitItem, extra: (found: Found | null) => Record<string, unknown>) => {
      // จับคู่: ตัวย่อ → ชื่อไทย → ชื่ออังกฤษ → ชื่อที่ตั้งไว้เป็นตัวย่อ (เช่น แผนกเดิมชื่อ "IT") — รายการที่มีตัวย่ออื่นแล้วไม่นับ
      let found = await first<Found>(`SELECT * FROM ${table} WHERE code = ?`, [it.code]);
      for (const name of [it.name, it.name_en, it.code]) {
        if (found || !name) continue;
        found = await first<Found>(`SELECT * FROM ${table} WHERE LOWER(TRIM(name)) = ? AND code IS NULL`, [name.toLowerCase()]);
      }
      if (found) {
        await update(table, { code: it.code, ...(it.name_en ? { name_en: it.name_en } : {}), ...extra(found), updated_at: now }, "id = ?", [found.id]);
        counts.updated++;
        return Number(found.id);
      }
      const id = await insert(table, { name: it.name, code: it.code, name_en: it.name_en, sort_order: 0, is_active: true, ...extra(null), created_at: now, updated_at: now });
      counts.created++;
      return id;
    };
    for (const it of items) {
      const divisionId = await upsert("divisions", it, () => ({}));
      await upsert("departments", it, (found) => (found?.division_id ? {} : { division_id: divisionId }));
    }
  });
  await audit(req, { action: "org.imported", subjectType: "org", after: { ...counts, format: "units" } });
  res.json({ data: counts });
}

/**
 * POST /org-units/import (multipart: file) — จับคู่ด้วยชื่อ (ไม่สนตัวพิมพ์): มีอยู่ = อัปเดตลำดับ/สถานะ/ฝ่าย, ไม่มี = เพิ่มใหม่ (ไม่ลบของเดิม)
 * ฝ่ายของแผนกต้องมีในระบบหรือในแผ่นฝ่ายของไฟล์ — เว้นว่าง = ไม่สังกัดฝ่าย; ผิดแม้แถวเดียว = ไม่บันทึกเลย
 */
orgUnitRoutes.post("/org-units/import", async (req, res) => {
  authorize(can(me(req), "org.manage"));
  const t = (k: string, p?: Record<string, string | number>) => trans(req.locale, `eam.org.${k}`, p);
  const file = req.input.file;
  if (!(file instanceof UploadedFile)) return res.status(422).json({ message: trans(req.locale, "eam.holiday.no_file"), rows: [] });
  // ไฟล์รายการหน่วยงาน (Unit Code | Description | ชื่อไทย) = ทั้งฝ่ายและแผนก
  const units = await readUnitList(file);
  if (units === "unreadable") return res.status(422).json({ message: trans(req.locale, "eam.asset_import.unreadable"), rows: [] });
  if (units) return importUnits(req, res, units.rows);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    return res.status(422).json({ message: trans(req.locale, "eam.asset_import.unreadable"), rows: [] });
  }
  // แผ่นตามชื่อ (ไทย/อังกฤษ) — ไม่พบใช้ลำดับแผ่น 1 = ฝ่าย, 2 = แผนก
  const sheet = (key: string, index: number) =>
    wb.worksheets.find((w) => [trans("th", `eam.org.${key}`), trans("en", `eam.org.${key}`)].includes(w.name.trim())) ?? wb.worksheets[index];
  const dvSheet = sheet("sheet_divisions", 0);
  const dpSheet = sheet("sheet_departments", 1);
  const errors: { row: number; sheet: string; message: string }[] = [];
  const text = (v: ReturnType<typeof cellValue>) => (v === null ? "" : v instanceof Date ? "" : v.trim());
  type Item = { row: number; name: string; sort: number | null; active: boolean | null; division?: string };
  const read = (ws: ExcelJS.Worksheet | undefined, isDept: boolean): Item[] => {
    const out: Item[] = [];
    const seen = new Map<string, number>();
    ws?.eachRow((row, n) => {
      if (n === 1) return;
      const name = text(cellValue(row.getCell(1).value));
      const division = isDept ? text(cellValue(row.getCell(2).value)) : undefined;
      const sortText = text(cellValue(row.getCell(isDept ? 3 : 2).value));
      const statusText = text(cellValue(row.getCell(isDept ? 4 : 3).value));
      if (!name && !sortText && !statusText && !division) return;
      const err = (message: string) => errors.push({ row: n, sheet: ws.name, message });
      if (!name) return err(t("name_required"));
      if (name.length > 100) return err(trans(req.locale, "eam.asset_import.too_long", { column: t("col_name"), max: 100 }));
      const key = name.toLowerCase();
      if (seen.has(key)) return err(t("duplicate_row", { row: seen.get(key)! }));
      seen.set(key, n);
      const sort = sortText === "" ? null : Number(sortText);
      if (sort !== null && (!Number.isInteger(sort) || sort < 0 || sort > 9999)) return err(t("sort_invalid"));
      out.push({ row: n, name, sort, active: statusText === "" ? null : !isInactive(statusText), division });
    });
    return out;
  };
  const divs = read(dvSheet, false);
  const deps = read(dpSheet, true);
  const existingDivs = await select<{ id: number; name: string }>("SELECT id, name FROM divisions");
  const known = new Set([...existingDivs.map((d) => d.name.trim().toLowerCase()), ...divs.map((d) => d.name.toLowerCase())]);
  for (const d of deps) if (d.division && !known.has(d.division.toLowerCase())) errors.push({ row: d.row, sheet: dpSheet?.name ?? "", message: t("division_unknown", { value: d.division }) });
  if (!divs.length && !deps.length && !errors.length) errors.push({ row: 0, sheet: "", message: trans(req.locale, "eam.asset_import.empty") });
  if (errors.length) {
    return res.status(422).json({ message: trans(req.locale, "eam.asset_import.failed"), rows: errors.map((e) => ({ row: e.row, message: e.sheet ? `[${e.sheet}] ${e.message}` : e.message })) });
  }
  const counts = { created: 0, updated: 0 };
  await transaction(async () => {
    const now = nowDb();
    const upsert = async (table: Table, it: Item, extra: Record<string, unknown>) => {
      const found = await first<{ id: number }>(`SELECT id FROM ${table} WHERE LOWER(TRIM(name)) = ?`, [it.name.toLowerCase()]);
      const values: Record<string, unknown> = { ...extra, updated_at: now };
      if (it.sort !== null) values.sort_order = it.sort;
      if (it.active !== null) values.is_active = it.active;
      if (found) {
        await update(table, values, "id = ?", [found.id]);
        counts.updated++;
      } else {
        await insert(table, { name: it.name, sort_order: 0, is_active: true, ...values, created_at: now });
        counts.created++;
      }
    };
    for (const d of divs) await upsert("divisions", d, {});
    const divIds = new Map((await select<{ id: number; name: string }>("SELECT id, name FROM divisions")).map((d) => [d.name.trim().toLowerCase(), Number(d.id)]));
    for (const d of deps) await upsert("departments", d, { division_id: d.division ? divIds.get(d.division.toLowerCase()) ?? null : null });
  });
  await audit(req, { action: "org.imported", subjectType: "org", after: counts });
  res.json({ data: counts });
});
