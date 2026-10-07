import ExcelJS from "exceljs";
import { kpiMonthRows, kpiTotals, MARKS, SERVICE_TYPES, SERVICE_TYPE_NOTE, type KpiRow } from "./kpi.js";

/**
 * Export KPI เป็น .xlsx รูปแบบเดียวกับ Template-KPI-IT-2569-Part2-Details-Rev00.xlsx
 *   ชีต ServiceType + ชีตละเดือน (ชื่อ Oct68 = เดือนอังกฤษ + ปี พ.ศ. 2 หลัก)
 *   คอลัมน์ A–J, ฟอนต์ Cordia New 14, หัวตารางตัวหนาพื้นเทา, วันที่แบบไทย (d mmmm yyyy พ.ศ.)
 *   Mark = สูตร IF ตามต้นฉบับ, แถว Total = SUM — แก้ Complexity ใน Excel แล้วคำนวณใหม่ได้
 *   แถววันหยุด = รวมเซลล์ B:G
 */

const HEADERS = ["วันที่แจ้ง", "ผู้แจ้ง", "สาขา", "ประเภทการแจ้ง", "รายการ", "ผู้รับแจ้ง", "วิธีการแก้ไข", "Complexity", "Mark", "วันที่แล้วเสร็จ"];
const WIDTHS = [15.44, 12, 10.89, 18, 34.44, 8.66, 44.66, 9, 8.33, 15.44];
const THAI_DATE = "[$-107041E]d mmmm yyyy;@";
const FONT: Partial<ExcelJS.Font> = { name: "Cordia New", size: 14, family: 2 };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-10" → "Oct68" */
export function sheetName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]}${String((y + 543) % 100).padStart(2, "0")}`;
}

/** ปีงบประมาณ พ.ศ. ของเดือน (ต.ค.–ก.ย.) เช่น 2025-10 → 2569 */
export function fiscalYear(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y + 543 + (m >= 10 ? 1 : 0);
}

/** "YYYY-MM" ทุกเดือนตั้งแต่ from ถึง to */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) (m = 1), y++;
  }
  return out;
}

/** สูตร Mark ของต้นฉบับ: =IF(H2=0.5,0.5,IF(H2=1, 1,IF(H2=2,2.25,...,IF(H2=8,45,0)))) */
function markFormula(row: number): string {
  // ลำดับเดียวกับต้นฉบับ (0.5 ก่อน) — Object.entries จะเรียง key ตัวเลขเต็มขึ้นก่อน จึงกำหนดลำดับเอง
  const order = ["0.5", "1", "2", "3", "4", "5", "6", "7", "8"];
  return order.reduceRight((inner, c) => `IF(H${row}=${c},${MARKS[c]},${inner})`, "0");
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

function serviceTypeSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("ServiceType");
  ws.columns = [{ width: 24 }, { width: 100 }];
  ws.addRow(["Category", "Description"]);
  for (const s of SERVICE_TYPES) ws.addRow([s.name, s.description]);
  ws.addRow([]);
  ws.addRow([SERVICE_TYPE_NOTE]);
}

function monthSheet(wb: ExcelJS.Workbook, month: string, rows: KpiRow[]) {
  const ws = wb.addWorksheet(sheetName(month));
  ws.columns = WIDTHS.map((width) => ({ width }));
  const header = ws.addRow(HEADERS);
  header.eachCell((c) => {
    c.font = { ...FONT, bold: true };
    c.fill = HEADER_FILL;
  });

  rows.forEach((r, i) => {
    const n = i + 2;
    const row = ws.getRow(n);
    row.getCell(1).value = asDate(r.work_date);
    if (r.kind === "holiday") {
      row.getCell(2).value = r.details;
      ws.mergeCells(`B${n}:G${n}`);
    } else {
      row.getCell(2).value = r.requester ?? null;
      row.getCell(3).value = r.branch ?? null;
      row.getCell(4).value = r.service_type ?? null;
      row.getCell(5).value = r.ticket ? `${r.details} (${r.ticket.ticket_no})` : r.details;
      row.getCell(6).value = r.assignee ?? null;
      row.getCell(7).value = r.solution ?? null;
    }
    row.getCell(8).value = r.complexity;
    row.getCell(9).value = { formula: markFormula(n), result: r.mark };
    // วันที่แล้วเสร็จ: ต้นฉบับตั้งเป็น =A (วันเดียวกับวันที่แจ้ง) — ใบงานที่ยังไม่เสร็จเว้นว่าง
    if (r.completed_date) row.getCell(10).value = asDate(r.completed_date);
    else if (r.kind === "work") row.getCell(10).value = { formula: `A${n}`, result: asDate(r.work_date) };
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = FONT;
      if (col === 1 || col === 10) c.numFmt = THAI_DATE;
      if (col === 5 || col === 7) c.alignment = { wrapText: true, vertical: "top" };
    });
  });

  const totals = kpiTotals(rows);
  const last = rows.length + 1;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(7).value = "Total";
  totalRow.getCell(8).value = rows.length ? { formula: `SUM(H2:H${last})`, result: totals.complexity } : 0;
  totalRow.getCell(9).value = rows.length ? { formula: `SUM(I2:I${last})`, result: totals.mark } : 0;
  totalRow.eachCell({ includeEmpty: true }, (c) => (c.font = FONT));
}

/** workbook ของเจ้าหน้าที่ 1 คน ตามช่วงเดือน */
export async function buildKpiWorkbook(userId: number, months: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IT-SYSTEM";
  // ให้ Excel คำนวณสูตรใหม่ตอนเปิดไฟล์ (exceljs ไม่เขียนผลลัพธ์ 0 ที่ cache ไว้)
  wb.calcProperties.fullCalcOnLoad = true;
  serviceTypeSheet(wb);
  for (const month of months) monthSheet(wb, month, await kpiMonthRows(userId, month));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
