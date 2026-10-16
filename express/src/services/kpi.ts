import { config } from "../config.js";
import { select } from "../db.js";
import { dateOnly, localToday } from "../lib/time.js";
import { trans, type Locale } from "../lib/i18n.js";
import { datesBetween, holidayCalendarFor, leaveSettings } from "./calendar.js";

/**
 * KPI ฝ่าย IT ตามไฟล์ Template-KPI-IT-2569-Part2-Details (ชีต ServiceType + ชีตรายเดือน)
 * แถวของเดือน = ใบแจ้งงานที่เจ้าหน้าที่รับงานแล้ว (ตามวันที่แจ้ง) + แถวที่กรอกเอง + แถววันหยุด
 */

/** ชีต ServiceType ของไฟล์ต้นฉบับ (ลำดับ/ข้อความตามไฟล์) */
export const SERVICE_TYPES = [
  { name: "Computer Service", description: "Printer, Monitor, CCTV, Desktop, Laptop, Mouse, Keyboard, CPU, Memory, Harddisk" },
  { name: "Server Service", description: "Config policy" },
  { name: "System Service", description: "File Server, Application(ERP, MS Office, Windows,Corpsys, EXI, AlertSys), Account Lock, AntiVirus" },
  { name: "Network Service", description: "LAN, WAN, WIFI, Access point, VPN, Telephone, Firewall,Website" },
  { name: "User Account Service", description: "Sign, Resign, E-mail, Finger Scan" },
  { name: "Graphic & Design", description: "Design - website , Catalog, Calendar, Publishing" },
  { name: "Document Service", description: "Audit, Procument" },
  { name: "ETC.", description: "Training, Help, Meeting" },
] as const;
export const SERVICE_TYPE_NAMES: readonly string[] = SERVICE_TYPES.map((s) => s.name);
export const SERVICE_TYPE_NOTE = "***เริ่มมีผลบังคับใช้ วันที่ 16 ตุลาคม 2563";

/** Complexity → Mark ตามสูตรคอลัมน์ I ของไฟล์ (=IF(H=0.5,0.5,IF(H=1,1,IF(H=2,2.25,...))) ค่าอื่น = 0 */
export const MARKS: Record<string, number> = { "0.5": 0.5, "1": 1, "2": 2.25, "3": 4.5, "4": 9, "5": 18, "6": 27, "7": 36, "8": 45 };
export const COMPLEXITY_VALUES = [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8];
export const markOf = (complexity: number | null | undefined): number => (complexity == null ? 0 : (MARKS[String(Number(complexity))] ?? 0));

/** ประเภทการแจ้งตั้งต้นของแถวใบงาน (แก้รายแถวได้) — เรื่อง "อื่นๆ" ที่เกี่ยวกับ VPN (เช่น ใบงานต่ออายุ / ยกเลิก VPN) = Network Service */
export function defaultServiceType(ticketType: string, typeOther: string | null = null): string {
  if (ticketType === "other" && typeOther && /\bvpn\b/i.test(typeOther)) return "Network Service";
  if (ticketType === "repair" || ticketType === "install") return "Computer Service";
  if (ticketType === "grant_access" || ticketType === "revoke_access") return "User Account Service";
  return "ETC.";
}

/**
 * ใบงานที่นับในชีต KPI = ผู้จัดการ IT อนุมัติผลแล้ว (รอผู้แจ้งรับงาน / เสร็จสิ้น)
 * กำลังทำ / รออนุมัติผล / ถูกส่งกลับแก้ไข ยังไม่ขึ้น — ค่าที่กรอกไว้ (kpi_entries) ไม่หาย แสดงอีกครั้งเมื่ออนุมัติ
 */
export const KPI_TICKET_STATUSES = ["pending_requester", "completed"];

export type KpiRowKind = "ticket" | "work" | "holiday";
export interface KpiRow {
  key: string;
  kind: KpiRowKind;
  entry_id: number | null;
  ticket: { id: string; ticket_no: string; status: string } | null;
  work_date: string;
  requester: string | null;
  branch: string | null;
  service_type: string | null;
  details: string;
  assignee: string | null;
  solution: string | null;
  complexity: number;
  mark: number;
  completed_date: string | null;
}

/** "YYYY-MM" → ช่วงวันในเดือน */
export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}

/** วันที่ตามเวลาท้องถิ่นของผู้ใช้ จาก DATETIME (UTC) ใน DB */
const localDateOf = (dbDateTime: string) => localToday(config.localTimezone, new Date(`${String(dbDateTime).replace(" ", "T")}Z`));

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** แถว KPI ของเจ้าหน้าที่ 1 คนในเดือนนั้น เรียงตามวันที่แจ้ง — ใบงานที่เป็นผู้รับงานหรือผู้ร่วมดำเนินการ (ประเภท/Complexity แยกต่อคน) */
export async function kpiMonthRows(userId: number, month: string, locale: Locale = "th"): Promise<KpiRow[]> {
  const { first, last } = monthRange(month);
  // ช่วง UTC กว้างกว่าเดือนเล็กน้อย แล้วกรองด้วยวันที่ท้องถิ่น (requested_at เก็บเป็น UTC)
  const tickets = await select<{
    id: number; uuid: string; ticket_no: string; type: string; type_other: string | null; status: string; requested_at: string; details: string; symptom: string | null;
    repair_details: string | null; cannot_reason: string | null; completed_on: string | null;
    requester: string | null; branch: string | null; assignee: string | null;
    k_id: number | null; k_service_type: string | null; k_complexity: string | null;
  }>(
    `SELECT t.id, t.uuid, t.ticket_no, t.type, t.type_other, t.status, t.requested_at, t.details, t.symptom, t.repair_details, t.cannot_reason, t.completed_on,
            r.name AS requester, b.name AS branch, o.name AS assignee, k.id AS k_id, k.service_type AS k_service_type, k.complexity AS k_complexity
       FROM it_tickets t
       JOIN users o ON o.id = ?
       LEFT JOIN users r ON r.id = t.requester_id
       LEFT JOIN branches b ON b.id = t.branch_id
       LEFT JOIN kpi_entries k ON k.ticket_id = t.id AND k.user_id = o.id
      WHERE (t.assignee_id = o.id OR EXISTS (SELECT 1 FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id AND h.user_id = o.id))
        AND t.status IN (?)
        AND t.requested_at >= DATE_SUB(?, INTERVAL 1 DAY) AND t.requested_at < DATE_ADD(?, INTERVAL 2 DAY)`,
    [userId, KPI_TICKET_STATUSES, first, last],
  );
  const entries = await select<{
    id: number; entry_type: string; work_date: string; details: string; requester_name: string | null; branch_name: string | null;
    service_type: string | null; solution: string | null; complexity: string | null; completed_date: string | null; assignee: string | null;
  }>(
    `SELECT k.id, k.entry_type, k.work_date, k.details, k.requester_name, k.branch_name, k.service_type, k.solution, k.complexity, k.completed_date,
            u.name AS assignee
       FROM kpi_entries k LEFT JOIN users u ON u.id = k.user_id
      WHERE k.user_id = ? AND k.ticket_id IS NULL AND k.work_date BETWEEN ? AND ?`,
    [userId, first, last],
  );

  const rows: KpiRow[] = [];
  for (const t of tickets) {
    const workDate = localDateOf(t.requested_at);
    if (workDate < first || workDate > last) continue;
    const complexity = num(t.k_complexity);
    rows.push({
      key: `t:${t.uuid}`,
      kind: "ticket",
      entry_id: t.k_id,
      ticket: { id: t.uuid, ticket_no: t.ticket_no, status: t.status },
      work_date: workDate,
      requester: t.requester,
      branch: t.branch,
      service_type: t.k_service_type ?? defaultServiceType(t.type, t.type_other),
      details: t.type === "repair" && t.symptom ? t.symptom : t.details,
      assignee: t.assignee,
      solution: t.repair_details ?? t.cannot_reason,
      complexity,
      mark: markOf(complexity),
      completed_date: dateOnly(t.completed_on),
    });
  }
  for (const e of entries) {
    const holiday = e.entry_type === "holiday";
    const complexity = holiday ? 0 : num(e.complexity);
    rows.push({
      key: `e:${e.id}`,
      kind: holiday ? "holiday" : "work",
      entry_id: e.id,
      ticket: null,
      work_date: dateOnly(e.work_date)!,
      requester: e.requester_name,
      branch: e.branch_name,
      service_type: e.service_type,
      details: e.details,
      assignee: holiday ? null : e.assignee,
      solution: e.solution,
      complexity,
      mark: markOf(complexity),
      completed_date: dateOnly(e.completed_date),
    });
  }
  rows.push(...(await calendarRows(userId, first, last, locale)));
  // เรียงตามวันที่แจ้ง → วันเดียวกัน: วันหยุด, ใบงาน (ตามเลขที่), แถวกรอกเอง (ตามลำดับที่เพิ่ม)
  const rank: Record<KpiRowKind, number> = { holiday: 0, ticket: 1, work: 2 };
  return rows.sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) ||
      rank[a.kind] - rank[b.kind] ||
      (a.ticket && b.ticket ? a.ticket.ticket_no.localeCompare(b.ticket.ticket_no) : (a.entry_id ?? 0) - (b.entry_id ?? 0)),
  );
}

export const kpiTotals = (rows: KpiRow[]) => ({
  complexity: rows.reduce((s, r) => s + r.complexity, 0),
  mark: rows.reduce((s, r) => s + r.mark, 0),
  rows: rows.length,
});

/**
 * แถววันหยุดจากปฏิทิน (อ่านอย่างเดียว — entry_id = null): วันหยุดบริษัท + ใบลาที่อนุมัติแล้วของเจ้าของชีต
 * ใบลาหลายวัน = 1 แถวต่อวันทำงาน (ไม่นับวันหยุดสุดสัปดาห์ / วันหยุดบริษัท ซึ่งมีแถวของตัวเองอยู่แล้ว)
 */
async function calendarRows(userId: number, first: string, last: string, locale: Locale): Promise<KpiRow[]> {
  // วันหยุดบริษัทตามชุดวันหยุดของสาขาเจ้าของชีต
  const owner = await select<{ branch_id: number | null }>("SELECT branch_id FROM users WHERE id = ?", [userId]);
  const cal = await holidayCalendarFor(owner[0]?.branch_id ? Number(owner[0].branch_id) : null);
  const holidays = await select<{ id: number; date: string; name: string }>(
    "SELECT id, date, name FROM company_holidays WHERE calendar_id = ? AND date BETWEEN ? AND ?",
    [cal ?? 0, first, last],
  );
  const holidaySet = new Set(holidays.map((h) => dateOnly(h.date)!));
  const leaves = await select<{ id: number; leave_type: string; unit: string; start_on: string; end_on: string; start_time: string | null; end_time: string | null }>(
    "SELECT id, leave_type, unit, start_on, end_on, start_time, end_time FROM leave_requests WHERE user_id = ? AND status = 'approved' AND start_on <= ? AND end_on >= ?",
    [userId, last, first],
  );
  const { work_days } = await leaveSettings();
  const row = (key: string, date: string, details: string): KpiRow => ({
    key, kind: "holiday", entry_id: null, ticket: null, work_date: date, requester: null, branch: null, service_type: null,
    details, assignee: null, solution: null, complexity: 0, mark: 0, completed_date: null,
  });
  const out = holidays.map((h) => row(`ch:${h.id}`, dateOnly(h.date)!, trans(locale, "eam.holiday.kpi_row", { name: h.name })));
  for (const l of leaves) {
    const unit = trans(locale, `eam.leave.units.${l.unit}`) + (l.unit === "hours" && l.start_time ? ` ${l.start_time}–${l.end_time}` : "");
    const text = trans(locale, "eam.leave.kpi_row", { type: trans(locale, `eam.leave.types.${l.leave_type}`), unit });
    for (const d of datesBetween(dateOnly(l.start_on)! < first ? first : dateOnly(l.start_on)!, dateOnly(l.end_on)! > last ? last : dateOnly(l.end_on)!)) {
      if (!work_days.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || holidaySet.has(d)) continue;
      out.push(row(`lv:${l.id}:${d}`, d, text));
    }
  }
  return out;
}
