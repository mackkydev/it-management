import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { first, insert, select, transaction, update } from "../db.js";
import type { Locale } from "../lib/i18n.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import type { AssetRow } from "../resources.js";
import { recordUserChange } from "./asset-movements.js";

/**
 * ทะเบียนคอมพิวเตอร์ (หมวด COMPUTER) — import / template Excel ตามไฟล์ทะเบียนของฝ่าย IT
 * - 1 แถว = เครื่อง 1 ชุด, asset_tag = Host Name (ไม่ซ้ำ) — เจอ Host Name เดิม = อัปเดต
 * - สาขาจับคู่จาก Work Group ของสาขา (branches.work_group) — ไม่พบ = ไม่ระบุสาขา (แจ้งเตือน ไม่ถือว่าผิด)
 * - วันที่ปี พ.ศ. (> 2400) แปลงเป็น ค.ศ. ให้, "-" หรือว่าง = ไม่มีข้อมูล
 * - ตรวจทุกแถวก่อน — มีแถวผิดแม้แถวเดียว ไม่บันทึกเลย (แจ้งแถวที่ผิดทั้งหมด)
 */

export const COMPUTER_CATEGORY = "COMPUTER";

/** ช่องข้อความของข้อมูลเครื่อง → ความยาวสูงสุด (ตรงกับคอลัมน์ใน DB) */
export const COMPUTER_TEXT_FIELDS = {
  department: 100,
  user_name: 255,
  work_group: 50,
  mac_address: 50,
  computer_type: 30,
  ip_address: 45,
  os: 100,
  office: 100,
  email_365: 255,
  antivirus: 100,
  notebook_tag: 100,
  cpu_tag: 100,
  monitor_tag: 255,
} as const;
export const COMPUTER_DATE_FIELDS = ["received_date", "start_use_date"] as const;

type TextField = keyof typeof COMPUTER_TEXT_FIELDS;
type DateField = (typeof COMPUTER_DATE_FIELDS)[number];
type Field = TextField | DateField | "asset_tag" | "brand" | "no";

/** คอลัมน์ของ template — เรียงตามไฟล์ทะเบียนเดิม */
export const IMPORT_COLUMNS: { header: string; field: Field; width: number; aliases?: string[] }[] = [
  { header: "No.", field: "no", width: 7, aliases: ["ลำดับ"] },
  { header: "Department", field: "department", width: 14, aliases: ["แผนก"] },
  { header: "ชื่อ-สกุลผู้ใช้งาน(Thai)", field: "user_name", width: 24, aliases: ["ชื่อ-สกุลผู้ใช้งาน", "ผู้ใช้งาน"] },
  { header: "วันที่รับเข้า (Received Date)", field: "received_date", width: 22, aliases: ["วันที่รับเข้า", "Received Date"] },
  { header: "วันที่เริ่มใช้งาน", field: "start_use_date", width: 18 },
  { header: "Host Name", field: "asset_tag", width: 18, aliases: ["Hostname", "Computer Name"] },
  { header: "Work Group", field: "work_group", width: 16, aliases: ["Workgroup"] },
  { header: "MAC Address", field: "mac_address", width: 20, aliases: ["MAC"] },
  { header: "Computer Type", field: "computer_type", width: 15, aliases: ["Type"] },
  { header: "Brand", field: "brand", width: 14, aliases: ["ยี่ห้อ"] },
  { header: "IP", field: "ip_address", width: 16, aliases: ["IP Address"] },
  { header: "OS", field: "os", width: 17 },
  { header: "Office", field: "office", width: 17 },
  { header: "Email 365", field: "email_365", width: 26, aliases: ["Email"] },
  { header: "Anti Virus", field: "antivirus", width: 16, aliases: ["Antivirus"] },
  { header: "เลขที่ทรัพย์สิน Notebook", field: "notebook_tag", width: 22 },
  { header: "เลขที่ทรัพย์สินCPU", field: "cpu_tag", width: 22, aliases: ["เลขที่ทรัพย์สิน CPU"] },
  { header: "เลขที่ทรัพย์สิน Monitor", field: "monitor_tag", width: 26 },
];

const TAG = /^[A-Za-z0-9\-_/]+$/;
const norm = (s: string) => s.toLowerCase().replace(/[\s.()\-_/:]/g, "");
const HEADER_MAP = new Map<string, Field>(IMPORT_COLUMNS.flatMap((c) => [c.header, ...(c.aliases ?? [])].map((h) => [norm(h), c.field] as [string, Field])));

/* ---------------------------------------------------------------- template */

/** template สำหรับ import — แผ่นแรก = ทะเบียน (หัวตาราง), แผ่นที่สอง = คำอธิบาย */
export async function buildTemplate(locale: Locale): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(trans(locale, "eam.asset_import.sheet"), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 30;
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });
  for (const key of COMPUTER_DATE_FIELDS) ws.getColumn(key).numFmt = "dd/mm/yyyy";

  const help = wb.addWorksheet(trans(locale, "eam.asset_import.help_sheet"));
  help.columns = [{ width: 30 }, { width: 90 }];
  const lines = trans(locale, "eam.asset_import.help").split("\n");
  lines.forEach((line, i) => {
    const [a, b] = line.split("|");
    const row = help.addRow([a?.trim() ?? "", b?.trim() ?? ""]);
    if (i === 0) row.font = { bold: true, size: 13 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------------------------------------- อ่านไฟล์ */

const pad = (n: number) => String(n).padStart(2, "0");

/** ค่าในเซลล์ → ข้อความ (Date คืนเป็น Date) — "-" / ว่าง = null */
function cellValue(v: ExcelJS.CellValue): string | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) v = v.richText.map((r) => r.text).join("");
    else if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    else if ("text" in v) v = String(v.text);
    else return null;
  }
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

/** วันที่จากเซลล์ → "YYYY-MM-DD" (ปี > 2400 = พ.ศ.) — ค่าไม่ถูกต้อง = undefined */
function toIsoDate(v: string | Date): string | undefined {
  let y: number, m: number, d: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else {
    const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
    if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    else if (ymd) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    else return undefined;
  }
  if (y > 2400) y -= 543;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface ImportRow {
  row: number;
  asset_tag: string;
  values: Record<string, string | null>;
}
export interface ImportIssue {
  row: number;
  message: string;
}
export interface ImportResult {
  created: number;
  updated: number;
  /** แถวที่ Work Group ไม่ตรงกับสาขาใด (นำเข้าแล้ว แต่ไม่ระบุสาขา) */
  warnings: ImportIssue[];
}

/** อ่านแผ่นแรกของไฟล์ → แถวข้อมูล + ข้อผิดพลาดรายแถว */
export async function parseWorkbook(buffer: Buffer, locale: Locale): Promise<{ rows: ImportRow[]; errors: ImportIssue[] }> {
  const t = (key: string, replace: Record<string, string | number> = {}) => trans(locale, `eam.asset_import.${key}`, replace);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { rows: [], errors: [{ row: 0, message: t("unreadable") }] };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, message: t("no_header") }] };

  // หาแถวหัวตาราง (มีคอลัมน์ Host Name) ใน 10 แถวแรก
  let headerRow = 0;
  const columns = new Map<number, Field>();
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const found = new Map<number, Field>();
    ws.getRow(r).eachCell((cell, col) => {
      const text = cellValue(cell.value);
      const field = typeof text === "string" ? HEADER_MAP.get(norm(text)) : undefined;
      if (field && field !== "no") found.set(col, field);
    });
    if ([...found.values()].includes("asset_tag")) {
      headerRow = r;
      for (const [col, field] of found) columns.set(col, field);
    }
  }
  if (!headerRow) return { rows: [], errors: [{ row: 0, message: t("no_header") }] };

  const rows: ImportRow[] = [];
  const errors: ImportIssue[] = [];
  const seen = new Map<string, number>();
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const raw = new Map<Field, string | Date | null>();
    for (const [col, field] of columns) raw.set(field, cellValue(ws.getRow(r).getCell(col).value));
    if ([...raw.values()].every((v) => v === null)) continue; // แถวว่าง

    const tag = raw.get("asset_tag");
    const hostName = tag instanceof Date ? null : tag;
    if (!hostName) {
      errors.push({ row: r, message: t("host_required") });
      continue;
    }
    if (hostName.length > 50 || !TAG.test(hostName)) {
      errors.push({ row: r, message: t("host_invalid", { value: hostName }) });
      continue;
    }
    const key = hostName.toUpperCase();
    if (seen.has(key)) {
      errors.push({ row: r, message: t("host_duplicate", { value: hostName, row: seen.get(key)! }) });
      continue;
    }
    seen.set(key, r);

    const values: Record<string, string | null> = {};
    let bad = false;
    for (const [field, v] of raw) {
      if (field === "asset_tag" || field === "no") continue;
      if ((COMPUTER_DATE_FIELDS as readonly string[]).includes(field)) {
        const iso = v === null ? null : toIsoDate(v);
        if (iso === undefined) {
          errors.push({ row: r, message: t("date_invalid", { column: IMPORT_COLUMNS.find((c) => c.field === field)!.header }) });
          bad = true;
        } else values[field] = iso;
        continue;
      }
      const text = v instanceof Date ? toIsoDate(v) ?? null : v;
      const max = field === "brand" ? 100 : COMPUTER_TEXT_FIELDS[field as TextField];
      if (text && text.length > max) {
        errors.push({ row: r, message: t("too_long", { column: IMPORT_COLUMNS.find((c) => c.field === field)!.header, max }) });
        bad = true;
      } else values[field] = text;
    }
    if (!bad) rows.push({ row: r, asset_tag: hostName, values });
  }
  if (rows.length === 0 && errors.length === 0) errors.push({ row: 0, message: t("empty") });
  return { rows, errors };
}

/* ---------------------------------------------------------------- บันทึก */

/** ตรวจกับข้อมูลในระบบ (Host Name ที่เป็นสินทรัพย์หมวดอื่น / ถูกลบไปแล้ว) แล้วบันทึกทั้งหมดใน transaction เดียว */
export async function importRows(rows: ImportRow[], userId: number, locale: Locale): Promise<{ errors: ImportIssue[] } | ImportResult> {
  const t = (key: string, replace: Record<string, string | number> = {}) => trans(locale, `eam.asset_import.${key}`, replace);
  const branches = await select<{ id: number; work_group: string }>("SELECT id, work_group FROM branches WHERE work_group IS NOT NULL AND deleted_at IS NULL");
  const branchOf = (wg: string | null | undefined) => (wg ? (branches.find((b) => b.work_group.toUpperCase() === wg.toUpperCase())?.id ?? null) : null);

  const errors: ImportIssue[] = [];
  const existing = new Map<string, AssetRow>();
  for (const r of rows) {
    const found = await first<AssetRow & { deleted_at: string | null }>("SELECT * FROM assets WHERE asset_tag = ?", [r.asset_tag]);
    if (!found) continue;
    if (found.deleted_at) errors.push({ row: r.row, message: t("host_deleted", { value: r.asset_tag }) });
    else if (found.category !== COMPUTER_CATEGORY) errors.push({ row: r.row, message: t("host_other_category", { value: r.asset_tag }) });
    else existing.set(r.asset_tag.toUpperCase(), found);
  }
  if (errors.length) return { errors };

  const result: ImportResult = { created: 0, updated: 0, warnings: [] };
  await transaction(async () => {
    const now = nowDb();
    for (const r of rows) {
      const v = r.values;
      const branchId = branchOf(v.work_group);
      if (v.work_group && branchId === null) result.warnings.push({ row: r.row, message: t("branch_not_found", { value: v.work_group }) });
      const current = existing.get(r.asset_tag.toUpperCase());
      if (current) {
        // อัปเดตเฉพาะคอลัมน์ที่มีในไฟล์ — Work Group ไม่ตรงสาขาใด = คงสาขาเดิม
        await update("assets", { ...v, ...(branchId !== null ? { branch_id: branchId } : {}), updated_by: userId, updated_at: now }, "id = ?", [current.id]);
        await recordUserChange(
          current.id,
          { user_name: current.user_name, department: current.department },
          { user_name: "user_name" in v ? (v.user_name as string | null) : current.user_name, department: "department" in v ? (v.department as string | null) : current.department },
          userId,
          "import",
        );
        result.updated++;
      } else {
        const name = [v.computer_type || "Computer", v.brand].filter(Boolean).join(" ");
        const newId = await insert("assets", {
          uuid: randomUUID(),
          asset_tag: r.asset_tag,
          name,
          category: COMPUTER_CATEGORY,
          status: "active",
          ...v,
          branch_id: branchId,
          created_by: userId,
          updated_by: userId,
          created_at: now,
          updated_at: now,
        });
        await recordUserChange(newId, { user_name: null, department: null }, { user_name: (v.user_name as string) ?? null, department: (v.department as string) ?? null }, userId, "import");
        result.created++;
      }
    }
  });
  return result;
}
