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
 *   GET    /org-units/import-template · POST /org-units/import   Excel 2 แผ่น (ฝ่าย / แผนก) — แผนกเลือกฝ่ายจาก dropdown
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

const usage = (table: Table) =>
  `(SELECT COUNT(*) FROM users u WHERE LOWER(TRIM(u.${UNITS[table].userColumn})) = LOWER(o.name)) AS users_count`;

const json = (r: UnitRow & { users_count?: number | string }) => ({
  id: r.id,
  name: r.name,
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

/** SELECT ของแต่ละตาราง — แผนกพ่วงชื่อฝ่ายที่สังกัด */
const selectFrom = (table: Table) =>
  table === "departments"
    ? "SELECT o.*, dv.name AS division_name FROM departments o LEFT JOIN divisions dv ON dv.id = o.division_id"
    : "SELECT o.* FROM divisions o";

function register(table: Table) {
  const cfg = UNITS[table];
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
        is_active: "is_active" in data ? bool(data.is_active) : true,
        sort_order: data.sort_order ?? 0,
        ...(table === "departments" ? { division_id: data.division_id ? Number(data.division_id) : null } : {}),
        created_at: now,
        updated_at: now,
      });
      if (deps) await setDivisionDepartments(id, deps);
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
    await exec(`DELETE FROM ${table} WHERE id = ?`, [current.id]);
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

/**
 * GET /org-units/import-template — แผ่น "ฝ่าย" (ชื่อ | ลำดับ | สถานะ) + แผ่น "แผนก" (ชื่อ | ฝ่าย | ลำดับ | สถานะ)
 * เติมข้อมูลในระบบไว้แล้ว; คอลัมน์ฝ่ายของแผนกเป็น dropdown จากแผ่นฝ่าย (รวมฝ่ายที่เพิ่มใหม่ในไฟล์)
 */
orgUnitRoutes.get("/org-units/import-template", async (req, res) => {
  authorize(can(me(req), "org.manage"));
  const t = (k: string) => trans(req.locale, `eam.org.${k}`);
  const [active, inactive] = words(req);
  const divisions = await select<UnitRow>("SELECT * FROM divisions ORDER BY sort_order, name");
  const departments = await select<UnitRow>("SELECT o.*, dv.name AS division_name FROM departments o LEFT JOIN divisions dv ON dv.id = o.division_id ORDER BY o.sort_order, o.name");
  const wb = new ExcelJS.Workbook();
  const dv = wb.addWorksheet(t("sheet_divisions"));
  dv.columns = [{ header: t("col_name"), width: 34 }, { header: t("col_sort"), width: 10 }, { header: t("col_status"), width: 14 }];
  for (const d of divisions) dv.addRow([d.name, Number(d.sort_order), d.is_active ? active : inactive]);
  const dp = wb.addWorksheet(t("sheet_departments"));
  dp.columns = [{ header: t("col_name"), width: 34 }, { header: t("col_division"), width: 34 }, { header: t("col_sort"), width: 10 }, { header: t("col_status"), width: 14 }];
  for (const d of departments) dp.addRow([d.name, d.division_name ?? null, Number(d.sort_order), d.is_active ? active : inactive]);
  for (const ws of [dv, dp]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  // dropdown: ฝ่ายของแผนก = ชื่อในแผ่นฝ่าย (เผื่อแถวเพิ่มใหม่ 200 แถว), สถานะ = ใช้งาน / ปิดใช้งาน
  const divRef = `'${dv.name.replace(/'/g, "''")}'!$A$2:$A$${divisions.length + 201}`;
  const status = `"${active},${inactive}"`;
  for (let r = 2; r <= departments.length + 201; r++) {
    dp.getCell(`B${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [divRef], showErrorMessage: true };
    dp.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [status] };
  }
  for (let r = 2; r <= divisions.length + 201; r++) dv.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [status] };
  const help = wb.addWorksheet(trans(req.locale, "eam.asset_import.help_sheet"));
  help.columns = [{ width: 100 }];
  for (const line of t("import_help").split("\n")) help.addRow([line]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="divisions-departments.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/**
 * POST /org-units/import (multipart: file) — จับคู่ด้วยชื่อ (ไม่สนตัวพิมพ์): มีอยู่ = อัปเดตลำดับ/สถานะ/ฝ่าย, ไม่มี = เพิ่มใหม่ (ไม่ลบของเดิม)
 * ฝ่ายของแผนกต้องมีในระบบหรือในแผ่นฝ่ายของไฟล์ — เว้นว่าง = ไม่สังกัดฝ่าย; ผิดแม้แถวเดียว = ไม่บันทึกเลย
 */
orgUnitRoutes.post("/org-units/import", async (req, res) => {
  authorize(can(me(req), "org.manage"));
  const t = (k: string, p?: Record<string, string | number>) => trans(req.locale, `eam.org.${k}`, p);
  const file = req.input.file;
  if (!(file instanceof UploadedFile)) return res.status(422).json({ message: trans(req.locale, "eam.holiday.no_file"), rows: [] });
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
