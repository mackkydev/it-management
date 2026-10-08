import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { first, insert, select, transaction, update } from "../db.js";
import type { Locale } from "../lib/i18n.js";
import { trans } from "../lib/i18n.js";
import { localToday, nowDb } from "../lib/time.js";
import type { AssetRow } from "../resources.js";
import { recordIfMoved, recordRegistration, recordUserChange } from "./asset-movements.js";
import { quickCreateLocation } from "./locations.js";
import { applyInstallations, licenseCatalog, SOFTWARE_SLOTS, softwareNamesOf, type SoftwareSlot, type WantedInstall } from "./asset-software.js";

/**
 * ทะเบียนคอมพิวเตอร์ (หมวด COMPUTER) — import / template Excel ตามไฟล์ทะเบียนของฝ่าย IT
 * - 1 แถว = เครื่อง 1 ชุด, asset_tag = Host Name (ไม่ซ้ำ) — เจอ Host Name เดิม = อัปเดต
 * - สาขาจับคู่จาก Work Group ของสาขา (branches.work_group) — ไม่พบ = ไม่ระบุสาขา (แจ้งเตือน ไม่ถือว่าผิด)
 * - วันที่ปี พ.ศ. (> 2400) แปลงเป็น ค.ศ. ให้, "-" หรือว่าง = ไม่มีข้อมูล
 * - ตรวจทุกแถวก่อน — มีแถวผิดแม้แถวเดียว ไม่บันทึกเลย (แจ้งแถวที่ผิดทั้งหมด)
 * - OS / Office / Anti Virus / Software อื่นๆ: ชื่อตรงกับ License ในระบบ = ผูกเป็นการติดตั้ง (นับ seat) — ไม่ตรง/seat เต็ม = เก็บข้อความ + แจ้งเตือน
 * - คอลัมน์ที่ไม่มีในไฟล์ (เช่น ไฟล์เดิมที่ไม่มี Software อื่นๆ) = ไม่แก้ข้อมูลเดิม
 * - ส่งออก (buildExport) ใช้คอลัมน์เดียวกัน — นำไฟล์กลับเข้ามาได้
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
  /** Software อื่นๆ ที่ยังไม่ผูก license (ขึ้นบรรทัดใหม่คั่น) */
  other_software: 1000,
} as const;
export const COMPUTER_DATE_FIELDS = ["received_date", "start_use_date"] as const;

type TextField = keyof typeof COMPUTER_TEXT_FIELDS;
type DateField = (typeof COMPUTER_DATE_FIELDS)[number];
/** ช่องของฟอร์มสินทรัพย์ (นอกเหนือข้อมูลเครื่อง) ที่นำเข้าได้ */
const ASSET_TEXT_FIELDS = { name: 255, brand: 100, model: 100, serial_number: 100, notes: 5000 } as const;
const ASSET_DATE_FIELDS = ["purchase_date", "warranty_expires_at"] as const;
/** อ้างอิงข้อมูลอื่นในระบบ (จับคู่ตอนบันทึก): สาขา / สถานที่ / ผู้ถือครอง */
const REF_FIELDS = ["branch", "location", "custodian"] as const;
type RefField = (typeof REF_FIELDS)[number];
const STATUSES = ["active", "in_storage", "in_repair", "lost", "disposed"] as const;

type Field =
  | Exclude<TextField, "other_software">
  | DateField
  | keyof typeof ASSET_TEXT_FIELDS
  | (typeof ASSET_DATE_FIELDS)[number]
  | RefField
  | "asset_tag"
  | "no"
  | "others"
  | "status"
  | "purchase_cost";

/** คอลัมน์ของ template — เรียงตามไฟล์ทะเบียนเดิม */
/** legacy = อ่านได้จากไฟล์เดิม แต่ไม่อยู่ใน template / ไฟล์ส่งออก (เอาออกจากฟอร์มแล้ว) */
export const IMPORT_COLUMNS: { header: string; field: Field; width: number; aliases?: string[]; legacy?: boolean }[] = [
  { header: "No.", field: "no", width: 7, aliases: ["ลำดับ"] },
  { header: "Department", field: "department", width: 14, aliases: ["แผนก"] },
  { header: "ชื่อ-สกุลผู้ใช้งาน(Thai)", field: "user_name", width: 24, aliases: ["ชื่อ-สกุลผู้ใช้งาน", "ผู้ใช้งาน"] },
  { header: "วันที่รับเข้า (Received Date)", field: "received_date", width: 22, aliases: ["วันที่รับเข้า", "Received Date"] },
  { header: "วันที่เริ่มใช้งาน", field: "start_use_date", width: 18 },
  { header: "Host Name", field: "asset_tag", width: 18, aliases: ["Hostname", "Computer Name"] },
  { header: "ชื่อสินทรัพย์", field: "name", width: 20, aliases: ["Asset Name", "Name"] },
  { header: "Work Group", field: "work_group", width: 16, aliases: ["Workgroup"] },
  { header: "MAC Address", field: "mac_address", width: 20, aliases: ["MAC"] },
  { header: "Computer Type", field: "computer_type", width: 15, aliases: ["Type"] },
  { header: "Brand", field: "brand", width: 14, aliases: ["ยี่ห้อ"] },
  { header: "รุ่น", field: "model", width: 16, aliases: ["Model"] },
  { header: "Serial Number", field: "serial_number", width: 18, aliases: ["S/N", "Serial", "SN"] },
  { header: "IP", field: "ip_address", width: 16, aliases: ["IP Address"] },
  { header: "OS", field: "os", width: 17 },
  { header: "Office", field: "office", width: 17 },
  { header: "Email 365", field: "email_365", width: 26, aliases: ["Email"], legacy: true },
  { header: "Anti Virus", field: "antivirus", width: 16, aliases: ["Antivirus"] },
  { header: "Software อื่นๆ", field: "others", width: 30, aliases: ["Software อื่น ๆ", "Software อื่น", "Other Software", "Software"] },
  { header: "เลขที่ทรัพย์สิน Notebook", field: "notebook_tag", width: 22 },
  { header: "เลขที่ทรัพย์สินCPU", field: "cpu_tag", width: 22, aliases: ["เลขที่ทรัพย์สิน CPU"] },
  { header: "เลขที่ทรัพย์สิน Monitor", field: "monitor_tag", width: 26 },
  // ช่องจากฟอร์มสินทรัพย์ (ไฟล์ทะเบียนเดิมไม่มี — ไม่มีคอลัมน์ = ไม่แก้ข้อมูลเดิม)
  { header: "สถานะ", field: "status", width: 13, aliases: ["Status"] },
  { header: "สาขา", field: "branch", width: 16, aliases: ["Branch"] },
  { header: "สถานที่", field: "location", width: 20, aliases: ["Location"] },
  { header: "ผู้ถือครอง", field: "custodian", width: 22, aliases: ["Custodian"] },
  { header: "วันที่ซื้อ", field: "purchase_date", width: 14, aliases: ["Purchase Date"] },
  { header: "มูลค่า (บาท)", field: "purchase_cost", width: 14, aliases: ["มูลค่า", "Cost", "Price"] },
  { header: "วันหมดประกัน", field: "warranty_expires_at", width: 15, aliases: ["Warranty", "Warranty Expires"] },
  { header: "หมายเหตุ", field: "notes", width: 30, aliases: ["Notes", "Remark"] },
];
/** คอลัมน์ใน template / ไฟล์ส่งออก */
const SHEET_COLUMNS = IMPORT_COLUMNS.filter((c) => !c.legacy);
const DATE_COLUMNS: readonly string[] = [...COMPUTER_DATE_FIELDS, ...ASSET_DATE_FIELDS];
const header = (field: Field) => IMPORT_COLUMNS.find((c) => c.field === field)!.header;

const TAG = /^[A-Za-z0-9\-_/]+$/;
/** ความยาวสูงสุดของเซลล์ Software อื่นๆ (รวมชื่อ license ที่ผูกแล้ว) */
const OTHERS_MAX = 5000;
const norm = (s: string) => s.toLowerCase().replace(/[\s.()\-_/:]/g, "");
const HEADER_MAP = new Map<string, Field>(IMPORT_COLUMNS.flatMap((c) => [c.header, ...(c.aliases ?? [])].map((h) => [norm(h), c.field] as [string, Field])));

/* ---------------------------------------------------------------- template */

/** template สำหรับ import — แผ่นแรก = ทะเบียน (หัวตาราง), แผ่นที่สอง = คำอธิบาย */
export async function buildTemplate(locale: Locale): Promise<Buffer> {
  return buildWorkbook(locale, []);
}

/** แผ่นทะเบียน (หัวตาราง + แถวข้อมูล) + แผ่นคำอธิบาย — ใช้ทั้ง template และส่งออก */
async function buildWorkbook(locale: Locale, rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(trans(locale, "eam.asset_import.sheet"), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 30;
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });
  for (const key of DATE_COLUMNS) ws.getColumn(key).numFmt = "dd/mm/yyyy";
  ws.getColumn("purchase_cost").numFmt = "#,##0.00";
  // Software อื่นๆ หลายรายการ = ขึ้นบรรทัดใหม่ในเซลล์
  for (const r of rows) ws.addRow(r).getCell("others").alignment = { wrapText: true, vertical: "top" };
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SHEET_COLUMNS.length } };

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
  /** Software อื่นๆ แยกรายการ — undefined = ไฟล์ไม่มีคอลัมน์นี้ (ไม่แตะของเดิม) */
  others?: string[];
  /** สาขา / สถานที่ / ผู้ถือครอง ตามที่พิมพ์ (จับคู่ตอนบันทึก) — ไม่มี key = ไฟล์ไม่มีคอลัมน์นั้น */
  refs: Partial<Record<RefField, string | null>>;
}

/** สถานะจากเซลล์: key (active) หรือชื่อภาษาไทย/อังกฤษ (ใช้งาน / Active) — ไม่รู้จัก = undefined */
function statusOf(text: string): (typeof STATUSES)[number] | undefined {
  const k = text.trim().toLowerCase();
  return STATUSES.find((st) => st === k || (["th", "en"] as const).some((l) => trans(l, `eam.status.${st}`).toLowerCase() === k));
}

/** มูลค่า: ตัวเลข ≥ 0 (ตัด , ฿ บาท ช่องว่าง) — ไม่ถูกต้อง = undefined */
function costOf(v: string): string | undefined {
  const n = Number(v.replace(/[,s฿]|บาท/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 9999999999999.99 ? n.toFixed(2) : undefined;
}
export interface ImportIssue {
  row: number;
  message: string;
}
export interface ImportResult {
  created: number;
  updated: number;
  /** แถวที่นำเข้าแล้วแต่ควรตรวจ: Work Group ไม่ตรงสาขา / ซอฟต์แวร์ไม่ตรง License หรือ seat เต็ม (เก็บเป็นข้อความ) */
  warnings: ImportIssue[];
}

/** ข้อความหลายรายการ → รายการไม่ซ้ำ (ค่าเริ่มต้นแยกด้วยขึ้นบรรทัดใหม่) */
export function splitSoftware(text: string | null, separator: RegExp = /[\r\n]+/): string[] {
  if (!text) return [];
  const items = text.split(separator).map((x) => x.trim()).filter((x) => x && x !== "-");
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

/** เทียบชื่อแบบไม่สนตัวพิมพ์และช่องว่างซ้ำ */
const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

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
    const refs: ImportRow["refs"] = {};
    let bad = false;
    const fail = (message: string) => (errors.push({ row: r, message }), (bad = true));
    for (const [field, v] of raw) {
      if (field === "asset_tag" || field === "no") continue;
      if ((REF_FIELDS as readonly string[]).includes(field)) {
        const text = v instanceof Date ? null : v;
        if (text && text.length > 255) fail(t("too_long", { column: header(field), max: 255 }));
        else refs[field as RefField] = text;
        continue;
      }
      if (field === "status") {
        if (v === null) continue; // ว่าง = ไม่เปลี่ยน (เพิ่มใหม่ = ใช้งาน)
        const st = v instanceof Date ? undefined : statusOf(v);
        if (!st) fail(t("status_invalid", { value: String(v), allowed: STATUSES.map((x) => trans(locale, `eam.status.${x}`)).join(", ") }));
        else values.status = st;
        continue;
      }
      if (field === "purchase_cost") {
        const cost = v === null ? null : v instanceof Date ? undefined : costOf(v);
        if (cost === undefined) fail(t("cost_invalid", { value: String(v) }));
        else values.purchase_cost = cost;
        continue;
      }
      if (field === "others") {
        const text = v instanceof Date ? null : v;
        if (text && text.length > OTHERS_MAX) {
          errors.push({ row: r, message: t("too_long", { column: IMPORT_COLUMNS.find((c) => c.field === field)!.header, max: OTHERS_MAX }) });
          bad = true;
        }
        continue;
      }
      if (DATE_COLUMNS.includes(field)) {
        const iso = v === null ? null : toIsoDate(v);
        if (iso === undefined) fail(t("date_invalid", { column: header(field) }));
        else if (field === "purchase_date" && iso && iso > localToday()) fail(t("purchase_future"));
        else values[field] = iso;
        continue;
      }
      const text = v instanceof Date ? toIsoDate(v) ?? null : v;
      const max = field in ASSET_TEXT_FIELDS ? ASSET_TEXT_FIELDS[field as keyof typeof ASSET_TEXT_FIELDS] : COMPUTER_TEXT_FIELDS[field as TextField];
      if (text && text.length > max) {
        errors.push({ row: r, message: t("too_long", { column: IMPORT_COLUMNS.find((c) => c.field === field)!.header, max }) });
        bad = true;
      } else values[field] = text;
    }
    if (bad) continue;
    const othersCell = raw.has("others") ? raw.get("others") : undefined;
    rows.push({ row: r, asset_tag: hostName, values, refs, ...(othersCell !== undefined ? { others: splitSoftware(othersCell instanceof Date ? null : othersCell) } : {}) });
  }
  if (rows.length === 0 && errors.length === 0) errors.push({ row: 0, message: t("empty") });
  return { rows, errors };
}

/* ---------------------------------------------------------------- บันทึก */

/** ตรวจกับข้อมูลในระบบ (Host Name ที่เป็นสินทรัพย์หมวดอื่น / ถูกลบไปแล้ว) แล้วบันทึกทั้งหมดใน transaction เดียว */
export async function importRows(rows: ImportRow[], userId: number, locale: Locale): Promise<{ errors: ImportIssue[] } | ImportResult> {
  const t = (key: string, replace: Record<string, string | number> = {}) => trans(locale, `eam.asset_import.${key}`, replace);
  const branches = await select<{ id: number; code: string; name: string; work_group: string | null }>("SELECT id, code, name, work_group FROM branches WHERE deleted_at IS NULL");
  const branchOf = (wg: string | null | undefined) => (wg ? (branches.find((b) => b.work_group && b.work_group.toUpperCase() === wg.toUpperCase())?.id ?? null) : null);
  const branchByName = (text: string) => branches.find((b) => key(b.name) === key(text) || key(b.code) === key(text))?.id ?? null;
  const locations = await select<{ id: number; code: string; name: string }>("SELECT id, code, name FROM locations WHERE deleted_at IS NULL");
  const people = await select<{ id: number; name: string; email: string | null; department: string | null }>("SELECT id, name, email, department FROM users WHERE is_active = true");
  const peopleNamed = (text: string) => people.filter((u) => key(u.name) === key(text) || (u.email !== null && key(u.email) === key(text)));
  const idOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

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
  const catalog = await licenseCatalog();
  await transaction(async () => {
    const now = nowDb();
    for (const r of rows) {
      let deviceId: number;
      const v = { ...r.values };
      const warn = (message: string) => result.warnings.push({ row: r.row, message });
      if (v.name === null) delete v.name; // ชื่อสินทรัพย์ต้องมีเสมอ — ว่าง = คงเดิม / ตั้งให้อัตโนมัติ

      // สาขา: คอลัมน์ "สาขา" (ชื่อหรือรหัส) ก่อน — ไม่มี/ไม่ตรง จึงใช้ Work Group
      let branchId: number | null = null;
      if (r.refs.branch) {
        branchId = branchByName(r.refs.branch);
        if (branchId === null) warn(t("branch_name_not_found", { value: r.refs.branch }));
      }
      if (branchId === null) {
        branchId = branchOf(v.work_group);
        if (v.work_group && branchId === null && !r.refs.branch) warn(t("branch_not_found", { value: v.work_group }));
      }

      // สถานที่: ชื่อหรือรหัส — ไม่มีในระบบ = เพิ่มให้ (เหมือนปุ่มเพิ่มสถานที่ในฟอร์ม), เว้นว่าง = ไม่ระบุ, ไม่มีคอลัมน์ = คงเดิม
      let locationId: number | null | undefined;
      if ("location" in r.refs) {
        const text = r.refs.location;
        if (!text) locationId = null;
        else {
          const found = locations.find((l) => key(l.code) === key(text) || key(l.name) === key(text));
          if (found) locationId = Number(found.id);
          else {
            const created = await quickCreateLocation(text);
            locations.push(created);
            locationId = created.id;
            warn(t("location_created", { value: text, code: created.code }));
          }
        }
      }

      // ผู้ถือครอง: ชื่อหรืออีเมลของผู้ใช้ในระบบ — ไม่พบ/ชื่อซ้ำหลายคน = คงเดิม + แจ้งเตือน
      let custodianId: number | null | undefined;
      if ("custodian" in r.refs) {
        const text = r.refs.custodian;
        if (!text) custodianId = null;
        else {
          const found = peopleNamed(text);
          if (found.length === 1) custodianId = Number(found[0].id);
          else warn(t(found.length ? "custodian_ambiguous" : "custodian_not_found", { value: text }));
        }
      }

      // ชื่อผู้ใช้งานตรงกับผู้ใช้ในระบบ + ไม่ได้กรอก Department = เติมแผนกให้ (เหมือนเลือกชื่อในฟอร์ม)
      if (v.user_name && !v.department) {
        const found = peopleNamed(v.user_name);
        if (found.length === 1 && found[0].department) v.department = found[0].department;
      }

      const current = existing.get(r.asset_tag.toUpperCase());
      if (current) {
        // อัปเดตเฉพาะคอลัมน์ที่มีในไฟล์ — Work Group / สาขา ไม่ตรงสาขาใด = คงสาขาเดิม
        await update(
          "assets",
          {
            ...v,
            ...(branchId !== null ? { branch_id: branchId } : {}),
            ...(locationId !== undefined ? { location_id: locationId } : {}),
            ...(custodianId !== undefined ? { custodian_id: custodianId } : {}),
            updated_by: userId,
            updated_at: now,
          },
          "id = ?",
          [current.id],
        );
        const from = { location: idOrNull(current.location_id), custodian: idOrNull(current.custodian_id) };
        await recordIfMoved(
          current.id,
          from,
          { location: locationId === undefined ? from.location : locationId, custodian: custodianId === undefined ? from.custodian : custodianId },
          userId,
          t("movement_reason"),
        );
        await recordUserChange(
          current.id,
          { user_name: current.user_name, department: current.department },
          { user_name: "user_name" in v ? (v.user_name as string | null) : current.user_name, department: "department" in v ? (v.department as string | null) : current.department },
          userId,
          "import",
        );
        deviceId = current.id;
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
          location_id: locationId ?? null,
          custodian_id: custodianId ?? null,
          created_by: userId,
          updated_by: userId,
          created_at: now,
          updated_at: now,
        });
        await recordRegistration(newId, locationId ?? null, custodianId ?? null, userId);
        await recordUserChange(newId, { user_name: null, department: null }, { user_name: (v.user_name as string) ?? null, department: (v.department as string) ?? null }, userId, "import");
        deviceId = newId;
        result.created++;
      }
      const sw = await importSoftware(deviceId, r, catalog, userId, locale);
      result.warnings.push(...sw.warnings.map((message) => ({ row: r.row, message })));
      if (Object.keys(sw.texts).length) await update("assets", sw.texts, "id = ?", [deviceId]);
    }
  });
  return result;
}

const SLOT_HEADER: Record<SoftwareSlot | "others", string> = Object.fromEntries(
  (["os", "office", "antivirus", "others"] as const).map((f) => [f, IMPORT_COLUMNS.find((c) => c.field === f)!.header]),
) as Record<SoftwareSlot | "others", string>;

/**
 * ซอฟต์แวร์ของแถว → การติดตั้ง license ของเครื่อง (เฉพาะคอลัมน์ที่มีในไฟล์)
 * - ชื่อ (หรือเลขครุภัณฑ์) ตรงกับ License = ผูก (ติดตั้งอยู่แล้ว = คงไว้, ใหม่ = ตรวจ seat) — คอลัมน์ข้อความใช้ชื่อ License
 * - ไม่ตรง / seat เต็ม = เก็บเป็นข้อความ (os / office / antivirus / other_software) + แจ้งเตือน
 * - ช่องว่าง = ถอนการติดตั้งในช่องนั้น (เก็บประวัติ)
 */
async function importSoftware(
  deviceId: number,
  r: ImportRow,
  catalog: { id: number; asset_tag: string; name: string }[],
  userId: number,
  locale: Locale,
): Promise<{ texts: Record<string, string | null>; warnings: string[] }> {
  const t = (k: string, replace: Record<string, string | number> = {}) => trans(locale, `eam.asset_import.${k}`, replace);
  const scope = new Set<SoftwareSlot | null>();
  for (const s of SOFTWARE_SLOTS) if (s in r.values) scope.add(s);
  if (r.others !== undefined) scope.add(null);
  if (!scope.size) return { texts: {}, warnings: [] };

  const device = (await first<{ id: number; custodian_id: number | null; branch_id: number | null }>("SELECT id, custodian_id, branch_id FROM assets WHERE id = ?", [deviceId]))!;
  const installedIds = new Set(
    (await select<{ license_asset_id: number }>("SELECT license_asset_id FROM license_installations WHERE device_asset_id = ? AND uninstalled_at IS NULL", [deviceId])).map((x) => Number(x.license_asset_id)),
  );
  // ชื่อซ้ำกันหลาย License → ใช้ตัวที่ติดตั้งบนเครื่องนี้อยู่แล้วก่อน
  const match = (text: string) => {
    const k = key(text);
    const found = catalog.filter((l) => key(l.name) === k);
    const list = found.length ? found : catalog.filter((l) => key(l.asset_tag) === k);
    return list.find((l) => installedIds.has(Number(l.id))) ?? list[0];
  };

  const warnings: string[] = [];
  const texts: Record<string, string | null> = {};
  const wanted: (WantedInstall & { raw: string })[] = [];
  const unlinked: string[] = []; // Software อื่นๆ ที่เก็บเป็นข้อความ
  const add = (slot: SoftwareSlot | null, raw: string) => {
    const lic = match(raw);
    if (!lic) {
      warnings.push(t("license_not_found", { column: SLOT_HEADER[slot ?? "others"], value: raw }));
      if (slot) texts[slot] = raw;
      else unlinked.push(raw);
      return;
    }
    // license เดียวกันซ้ำในแถว (เช่น ช่อง OS และ Software อื่นๆ) = ติดตั้งครั้งเดียว
    if (wanted.some((w) => w.id === Number(lic.id))) {
      if (slot) texts[slot] = lic.name.slice(0, 100);
      return;
    }
    wanted.push({ slot, id: Number(lic.id), name: lic.name, raw });
  };
  for (const s of SOFTWARE_SLOTS) {
    if (!scope.has(s)) continue;
    const raw = r.values[s];
    if (raw) add(s, raw);
    else texts[s] = null;
  }
  // Software อื่นๆ: ทีละบรรทัด — บรรทัดที่ไม่ตรง License ทั้งบรรทัดแยกด้วย , หรือ ; อีกชั้น (ชื่อ License ที่มี , ยังจับคู่ได้)
  for (const line of r.others ?? []) {
    if (match(line)) add(null, line);
    else for (const part of splitSoftware(line, /[,;]+/)) add(null, part);
  }

  const applied = await applyInstallations(device, wanted, scope, userId, (w, seats) => {
    warnings.push(t("license_seats_full", { column: SLOT_HEADER[w.slot ?? "others"], value: (w as (typeof wanted)[number]).raw, seats }));
  });
  for (const w of wanted) {
    if (applied.has(w)) {
      if (w.slot) texts[w.slot] = w.name.slice(0, 100);
    } else if (w.slot) texts[w.slot] = w.raw;
    else unlinked.push(w.raw);
  }
  if (scope.has(null)) {
    let text = [...new Map(unlinked.map((x) => [key(x), x])).values()].join("\n");
    if (text.length > COMPUTER_TEXT_FIELDS.other_software) {
      warnings.push(t("too_long", { column: SLOT_HEADER.others, max: COMPUTER_TEXT_FIELDS.other_software }));
      text = text.slice(0, COMPUTER_TEXT_FIELDS.other_software);
    }
    texts.other_software = text || null;
  }
  return { texts, warnings };
}

/* ---------------------------------------------------------------- ส่งออก */

/** ส่งออกทะเบียนคอมพิวเตอร์ — คอลัมน์เดียวกับ template (ชื่อ License ที่ผูกอยู่ + ข้อความที่ยังไม่ผูก) นำกลับเข้ามาได้ */
export async function buildExport(assets: AssetRow[], locale: Locale): Promise<Buffer> {
  const software = await softwareNamesOf(assets.map((a) => a.id));
  const names = async (table: "branches" | "locations" | "users", ids: unknown[]) => {
    const list = [...new Set(ids.filter((x) => x !== null && x !== undefined).map(Number))];
    const rows = list.length ? await select<{ id: number; name: string }>(`SELECT id, name FROM ${table} WHERE id IN (?)`, [list]) : [];
    return new Map(rows.map((x) => [Number(x.id), x.name]));
  };
  const [branchNames, locationNames, userNames] = await Promise.all([
    names("branches", assets.map((a) => a.branch_id)),
    names("locations", assets.map((a) => a.location_id)),
    names("users", assets.map((a) => a.custodian_id)),
  ]);
  const nameOf = (map: Map<number, string>, id: unknown) => (id === null || id === undefined ? null : (map.get(Number(id)) ?? null));
  const toDate = (v: unknown) => {
    const d = v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : null;
  };
  const rows = assets.map((a, i) => {
    const sw = software.get(a.id);
    const row: Record<string, unknown> = {
      no: i + 1,
      asset_tag: a.asset_tag,
      status: trans(locale, `eam.status.${a.status}`),
      branch: nameOf(branchNames, a.branch_id),
      location: nameOf(locationNames, a.location_id),
      custodian: nameOf(userNames, a.custodian_id),
      purchase_cost: a.purchase_cost === null || a.purchase_cost === undefined ? null : Number(a.purchase_cost),
    };
    for (const c of SHEET_COLUMNS) {
      if (c.field in row || c.field === "others") continue;
      const value = (a as unknown as Record<string, unknown>)[c.field];
      row[c.field] = DATE_COLUMNS.includes(c.field) ? toDate(value) : (value ?? null);
    }
    // ช่องที่ผูก License = ชื่อ License ปัจจุบัน (กรณีเปลี่ยนชื่อ License ภายหลัง)
    for (const s of SOFTWARE_SLOTS) if (sw?.[s]) row[s] = sw[s];
    const others = [...(sw?.others ?? []), ...splitSoftware(a.other_software)];
    row.others = others.length ? others.join("\n") : null;
    return row;
  });
  return buildWorkbook(locale, rows);
}
