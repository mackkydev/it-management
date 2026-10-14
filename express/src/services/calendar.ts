import { first, insert, select } from "../db.js";
import { dateOnly, localToday, nowDb } from "../lib/time.js";
import { trans, type Locale } from "../lib/i18n.js";
import { isSuperAdmin, type UserRow } from "../models/user.js";
import { groupsOf } from "./permissions.js";
import { getSetting } from "./settings.js";

/**
 * ปฏิทินกลาง — รวม 4 แหล่ง: ใบลาที่อนุมัติแล้ว, ไปทำงานหน้างาน (จากใบแจ้งงาน), กิจกรรม, วันหยุดบริษัท
 * ขอบเขตการมองเห็นต่อกลุ่มสิทธิ์ (app_settings.calendar_scope): all > branch > department (ไม่ตั้ง = department)
 * ผู้ใช้เห็นตามขอบเขตที่กว้างที่สุดของทุกกลุ่มที่สังกัด — ผู้ดูแลระบบสูงสุดเห็นทั้งหมดเสมอ
 */
/** ขอบเขตการมองเห็น (แคบ → กว้าง): เฉพาะตัวเอง / แผนก / สาขา / ทั้งหมด */
export const SCOPES = ["self", "department", "branch", "all"] as const;
/** ตั้งแยกกัน: calendar = กิจกรรม/งานหน้างานในปฏิทิน, leave = วันลาของคนอื่นในปฏิทิน */
export type ScopeKind = "calendar" | "leave";
const SCOPE_SETTING: Record<ScopeKind, "calendar_scope" | "leave_scope"> = { calendar: "calendar_scope", leave: "leave_scope" };
export type Scope = (typeof SCOPES)[number];
export const LEAVE_TYPES = ["sick", "personal", "vacation", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_UNITS = ["full", "half_am", "half_pm", "hours"] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];

/* ---------------------------------------------------------------- ตั้งค่า */

export interface LeaveSettings {
  /** โควตาต่อปีต่อประเภท (วัน) — null = ไม่จำกัด */
  quotas: Record<LeaveType, number | null>;
  /** ลาป่วยตั้งแต่กี่วันต้องแนบใบรับรองแพทย์ (0 = ไม่บังคับ) */
  sick_cert_days: number;
  /** วันทำงาน 0 = อาทิตย์ … 6 = เสาร์ */
  work_days: number[];
}
export const DEFAULT_LEAVE_SETTINGS: LeaveSettings = {
  quotas: { sick: 30, personal: 6, vacation: 10, other: null },
  sick_cert_days: 3,
  work_days: [1, 2, 3, 4, 5],
};

export async function leaveSettings(): Promise<LeaveSettings> {
  const raw = (await getSetting("leave_settings")) as Partial<LeaveSettings> | null;
  if (!raw || typeof raw !== "object") return DEFAULT_LEAVE_SETTINGS;
  return {
    quotas: { ...DEFAULT_LEAVE_SETTINGS.quotas, ...(raw.quotas ?? {}) },
    sick_cert_days: typeof raw.sick_cert_days === "number" ? raw.sick_cert_days : DEFAULT_LEAVE_SETTINGS.sick_cert_days,
    work_days: Array.isArray(raw.work_days) && raw.work_days.length ? raw.work_days.map(Number) : DEFAULT_LEAVE_SETTINGS.work_days,
  };
}

/** ขอบเขตตั้งต่อกลุ่ม { group_key: scope } — ปฏิทิน / การลา ตั้งแยกกัน */
export async function scopeSettings(kind: ScopeKind = "calendar"): Promise<Record<string, Scope>> {
  const raw = await getSetting(SCOPE_SETTING[kind]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => (SCOPES as readonly unknown[]).includes(v))) as Record<string, Scope>;
}

/** ขอบเขตสูงสุดที่ผู้ใช้เห็นได้ (กว้างสุดของทุกกลุ่ม; กลุ่มที่ไม่ได้ตั้ง = แผนก) */
export async function maxScope(u: UserRow, kind: ScopeKind = "calendar"): Promise<Scope> {
  if (isSuperAdmin(u)) return "all";
  const map = await scopeSettings(kind);
  const groups = await groupsOf(u);
  return groups.reduce<Scope>((best, g) => {
    const s = map[g] ?? "department";
    return SCOPES.indexOf(s) > SCOPES.indexOf(best) ? s : best;
  }, "self");
}

/** ขอบเขตที่แคบกว่า */
export const narrower = (a: Scope, b: Scope): Scope => (SCOPES.indexOf(a) <= SCOPES.indexOf(b) ? a : b);

/** ขอบเขตที่เลือกได้ (ไม่เกินสิทธิ์) */
export const allowedScopes = (max: Scope) => SCOPES.slice(0, SCOPES.indexOf(max) + 1);

/**
 * เงื่อนไข SQL "เจ้าของรายการอยู่ในขอบเขต" (alias ของตาราง users = o) — ของตัวเองเห็นเสมอ
 * branchId: เมื่อขอบเขต all เลือกกรองเฉพาะสาขาได้
 */
export function scopeWhere(u: UserRow, scope: Scope, branchId?: number | null): { sql: string; params: unknown[] } {
  if (scope === "self") return { sql: "o.id = ?", params: [u.id] };
  if (scope === "all") return branchId ? { sql: "(o.branch_id = ? OR o.id = ?)", params: [branchId, u.id] } : { sql: "1 = 1", params: [] };
  if (scope === "branch") return u.branch_id ? { sql: "(o.branch_id = ? OR o.id = ?)", params: [u.branch_id, u.id] } : { sql: "o.id = ?", params: [u.id] };
  const dept = u.department?.trim();
  return dept ? { sql: "(LOWER(TRIM(o.department)) = LOWER(?) OR o.id = ?)", params: [dept, u.id] } : { sql: "o.id = ?", params: [u.id] };
}

/* ---------------------------------------------------------------- วันทำงาน / วันหยุด */

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};

/* ---------------------------------------------------------------- ปฏิทินวันหยุด (แยกชุดตามประกาศ เช่น สำนักงานใหญ่ / สำนักงานโรงงาน) */

/** ชุดวันหยุดที่สาขานี้ใช้ — สาขาไม่ได้เลือก / ผู้ใช้ไม่มีสาขา = ชุดตั้งต้น (null = ยังไม่มีชุดใดเลย) */
export async function holidayCalendarFor(branchId: number | null | undefined): Promise<number> {
  if (branchId) {
    const b = await first<{ holiday_calendar_id: number | null }>("SELECT holiday_calendar_id FROM branches WHERE id = ?", [branchId]);
    if (b?.holiday_calendar_id) return Number(b.holiday_calendar_id);
  }
  const d = await first<{ id: number }>("SELECT id FROM holiday_calendars ORDER BY is_default DESC, sort_order, id LIMIT 1");
  if (d) return Number(d.id);
  // ยังไม่มีชุดใดเลย (ฐานใหม่/ล้างข้อมูล) — สร้างชุดตั้งต้นให้ เหมือนที่ migration สร้าง
  const now = nowDb();
  return insert("holiday_calendars", { name: "วันหยุดบริษัท", is_default: true, sort_order: 0, created_at: now, updated_at: now });
}

/** วันหยุดของสาขา (ตามชุดวันหยุดที่สาขาใช้) ในช่วงวัน */
export async function holidayDates(from: string, to: string, branchId: number | null = null): Promise<Set<string>> {
  const cal = await holidayCalendarFor(branchId);
  const rows = await select<{ date: string }>("SELECT date FROM company_holidays WHERE calendar_id = ? AND date BETWEEN ? AND ?", [cal ?? 0, from, to]);
  return new Set(rows.map((r) => dateOnly(r.date)!));
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** จำนวนวันลา (วันทำงานจริง) — เต็มวัน = นับวันทำงาน (ไม่นับวันหยุดของสาขาผู้ลา), ครึ่งวัน = 0.5, รายชั่วโมง = ชม./8 */
export async function leaveDays(unit: LeaveUnit, start: string, end: string, startTime: string | null, endTime: string | null, branchId: number | null = null): Promise<number> {
  const { work_days } = await leaveSettings();
  const holidays = await holidayDates(start, end, branchId);
  const working = datesBetween(start, end).filter((d) => work_days.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && !holidays.has(d));
  if (unit === "full") return working.length;
  if (!working.length) return 0;
  if (unit === "hours" && startTime && endTime) return Math.round(((minutes(endTime) - minutes(startTime)) / 60 / 8) * 100) / 100;
  return 0.5;
}

/* ---------------------------------------------------------------- รายการในปฏิทิน */

export interface CalendarItem {
  id: string;
  kind: "leave" | "onsite" | "event" | "holiday";
  title: string;
  start: string;
  end: string;
  user: { id: number; name: string } | null;
  status?: string;
  leave?: { id: string; type: string; unit: string; start_time: string | null; end_time: string | null; days: number };
  ticket?: { id: string; ticket_no: string } | null;
  /** งานหน้างานจากใบแจ้งงาน: ผู้ร่วมดำเนินการ (นอกจากผู้รับงาน) */
  helpers?: string[];
  note?: string | null;
  all_company?: boolean;
  event_id?: number;
  can_edit?: boolean;
  /** กิจกรรมที่ไม่รวมเสาร์-อาทิตย์: แถบแยกเป็นช่วงวันธรรมดา — range = ช่วงวันเต็มที่ตั้งไว้ (ใช้แก้ไข/แสดงรายละเอียด) */
  skip_weekends?: boolean;
  range?: { start: string; end: string };
}

export async function calendarItems(
  u: UserRow,
  opts: { from: string; to: string; scope: Scope; branchId?: number | null; locale: Locale; canManage: boolean },
): Promise<CalendarItem[]> {
  const { from, to, scope, branchId, locale } = opts;
  const w = scopeWhere(u, scope, branchId);
  // วันลาของคนอื่น: ขอบเขตการลา (ตั้งแยก) — ไม่เกินขอบเขตที่เลือกดูอยู่
  const lw = scopeWhere(u, narrower(scope, await maxScope(u, "leave")), branchId);
  const items: CalendarItem[] = [];

  // ใบลา: อนุมัติแล้วในขอบเขต + ใบที่รออนุมัติของตัวเอง
  const leaves = await select<{
    uuid: string; leave_type: string; unit: string; start_on: string; end_on: string; start_time: string | null; end_time: string | null;
    days: string; status: string; reason: string | null; uid: number; uname: string;
  }>(
    `SELECT l.uuid, l.leave_type, l.unit, l.start_on, l.end_on, l.start_time, l.end_time, l.days, l.status, l.reason, o.id AS uid, o.name AS uname
       FROM leave_requests l JOIN users o ON o.id = l.user_id
      WHERE l.start_on <= ? AND l.end_on >= ?
        AND ((l.status = 'approved' AND ${lw.sql}) OR (l.status = 'pending' AND l.user_id = ?))`,
    [to, from, ...lw.params, u.id],
  );
  for (const l of leaves) {
    items.push({
      id: `leave-${l.uuid}`,
      kind: "leave",
      title: `${l.uname} — ${trans(locale, `eam.leave.types.${l.leave_type}`)}`,
      start: dateOnly(l.start_on)!,
      end: dateOnly(l.end_on)!,
      user: { id: Number(l.uid), name: l.uname },
      status: l.status,
      leave: { id: l.uuid, type: l.leave_type, unit: l.unit, start_time: l.start_time, end_time: l.end_time, days: Number(l.days) },
    });
  }

  // หน้างาน / กิจกรรม: เจ้าของในขอบเขต (งานหน้างาน: หรือผู้ร่วมดำเนินการคนใดคนหนึ่งในขอบเขต) หรือกิจกรรมทั้งบริษัท
  const helperInScope = w.sql.replace(/\bo\./g, "hu.");
  const events = await select<{
    id: number; type: string; title: string; start_on: string; end_on: string; note: string | null; all_company: number | boolean;
    skip_weekends: number | boolean; uid: number; uname: string; created_by: number | null; t_uuid: string | null; ticket_no: string | null; helpers: string[] | string | null;
  }>(
    `SELECT e.id, e.type, e.title, e.start_on, e.end_on, e.note, e.all_company, e.skip_weekends, o.id AS uid, o.name AS uname, e.created_by, t.uuid AS t_uuid, t.ticket_no,
            (SELECT JSON_ARRAYAGG(hn.name) FROM it_ticket_helpers h JOIN users hn ON hn.id = h.user_id
              WHERE h.it_ticket_id = e.ticket_id) AS helpers
       FROM calendar_events e JOIN users o ON o.id = e.user_id LEFT JOIN it_tickets t ON t.id = e.ticket_id
      WHERE e.start_on <= ? AND e.end_on >= ? AND (e.all_company = true OR ${w.sql}
        OR (e.ticket_id IS NOT NULL AND EXISTS (SELECT 1 FROM it_ticket_helpers h JOIN users hu ON hu.id = h.user_id
              WHERE h.it_ticket_id = e.ticket_id AND ${helperInScope})))`,
    [to, from, ...w.params, ...w.params],
  );
  for (const e of events) {
    // JSON_ARRAYAGG — driver คืนเป็น array แล้ว (กันกรณีได้ข้อความ JSON)
    const raw: unknown = typeof e.helpers === "string" ? JSON.parse(e.helpers) : e.helpers;
    const helpers = Array.isArray(raw) ? raw.map(String) : [];
    const item: CalendarItem = {
      id: `${e.type}-${e.id}`,
      kind: e.type === "onsite" ? "onsite" : "event",
      // งานหน้างาน: ชื่อผู้รับงาน + ผู้ร่วมดำเนินการทุกคน
      title: e.type === "onsite" ? `${[e.uname, ...helpers].join(", ")} — ${e.title}` : e.title,
      ...(e.type === "onsite" ? { helpers } : {}),
      start: dateOnly(e.start_on)!,
      end: dateOnly(e.end_on)!,
      user: { id: Number(e.uid), name: e.uname },
      ticket: e.t_uuid ? { id: e.t_uuid, ticket_no: e.ticket_no! } : null,
      note: e.note,
      all_company: Boolean(e.all_company),
      event_id: Number(e.id),
      can_edit: e.type === "event" && (Number(e.created_by) === u.id || opts.canManage),
    };
    if (!e.skip_weekends) {
      items.push(item);
      continue;
    }
    // ไม่รวมเสาร์-อาทิตย์: 1 แถบต่อช่วงวันธรรมดาที่ต่อเนื่อง (id ต่อท้ายลำดับ) — event_id / range เดิม ใช้แก้ไขทั้งกิจกรรม
    weekdayRuns(item.start, item.end).forEach((r, n) =>
      items.push({ ...item, id: `${item.id}-${n}`, start: r.start, end: r.end, skip_weekends: true, range: { start: item.start, end: item.end } }),
    );
  }

  // วันหยุดบริษัท: ทุกคนเห็น
  // วันหยุดตามชุดของสาขาที่เลือกดู (ขอบเขตทั้งหมด + เลือกสาขา) หรือสาขาของผู้ดู
  const cal = await holidayCalendarFor(branchId ?? (u.branch_id ? Number(u.branch_id) : null));
  const holidays = await select<{ id: number; date: string; name: string }>(
    "SELECT id, date, name FROM company_holidays WHERE calendar_id = ? AND date BETWEEN ? AND ? ORDER BY date",
    [cal ?? 0, from, to],
  );
  for (const h of holidays) items.push({ id: `holiday-${h.id}`, kind: "holiday", title: h.name, start: dateOnly(h.date)!, end: dateOnly(h.date)!, user: null });

  return items.sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind));
}

/** ช่วงวันธรรมดา (จ.–ศ.) ที่ต่อเนื่องกันภายในช่วงวัน — ใช้กับกิจกรรมที่ไม่รวมเสาร์-อาทิตย์ */
export function weekdayRuns(start: string, end: string): { start: string; end: string }[] {
  const runs: { start: string; end: string }[] = [];
  for (const d of datesBetween(start, end)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const last = runs[runs.length - 1];
    if (last && addDays(last.end, 1) === d) last.end = d;
    else runs.push({ start: d, end: d });
  }
  return runs;
}

/** ผู้ใช้ไม่ว่าง (ลาอนุมัติแล้ว/รออนุมัติ หรือออกหน้างาน) ในช่วงวัน — ใช้เตือนตอนรับงาน/เลือกเจ้าหน้าที่ */
export async function busyOf(userIds: number[], from: string, to: string, exceptTicketId?: number): Promise<Map<number, { kind: "leave" | "onsite"; start: string; end: string; label: string }[]>> {
  const out = new Map<number, { kind: "leave" | "onsite"; start: string; end: string; label: string }[]>();
  if (!userIds.length) return out;
  const push = (id: number, v: { kind: "leave" | "onsite"; start: string; end: string; label: string }) => out.set(id, [...(out.get(id) ?? []), v]);
  const leaves = await select<{ user_id: number; start_on: string; end_on: string; leave_type: string }>(
    "SELECT user_id, start_on, end_on, leave_type FROM leave_requests WHERE user_id IN (?) AND status IN ('approved', 'pending') AND start_on <= ? AND end_on >= ?",
    [userIds, to, from],
  );
  for (const l of leaves) push(Number(l.user_id), { kind: "leave", start: dateOnly(l.start_on)!, end: dateOnly(l.end_on)!, label: l.leave_type });
  const onsite = await select<{ user_id: number; start_on: string; end_on: string; title: string; ticket_id: number | null }>(
    "SELECT user_id, start_on, end_on, title, ticket_id FROM calendar_events WHERE type = 'onsite' AND user_id IN (?) AND start_on <= ? AND end_on >= ?",
    [userIds, to, from],
  );
  // ผู้ร่วมดำเนินการของใบงานนั้นก็ออกหน้างานด้วย
  const asHelper = await select<{ user_id: number; start_on: string; end_on: string; title: string; ticket_id: number | null }>(
    `SELECT h.user_id, e.start_on, e.end_on, e.title, e.ticket_id FROM calendar_events e JOIN it_ticket_helpers h ON h.it_ticket_id = e.ticket_id
      WHERE e.type = 'onsite' AND h.user_id IN (?) AND e.start_on <= ? AND e.end_on >= ?`,
    [userIds, to, from],
  );
  for (const e of [...onsite, ...asHelper]) if (!exceptTicketId || Number(e.ticket_id) !== exceptTicketId) push(Number(e.user_id), { kind: "onsite", start: dateOnly(e.start_on)!, end: dateOnly(e.end_on)!, label: e.title });
  return out;
}

/* ---------------------------------------------------------------- iCal */

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");

/** ปฏิทิน .ics (ทั้งวัน — DTEND เป็นวันถัดไปตามมาตรฐาน) */
export function toIcs(items: CalendarItem[], name: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IT-SYSTEM//Calendar//TH", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(name)}`];
  for (const i of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${i.id}@it-system`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(i.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(i.end, 1))}`,
      `SUMMARY:${icsEscape(i.title)}`,
      ...(i.note ? [`DESCRIPTION:${icsEscape(i.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export const findUserByCalendarToken = (token: string) =>
  /^[A-Za-z0-9]{32,64}$/.test(token) ? first<UserRow>("SELECT * FROM users WHERE calendar_token = ? AND is_active = true", [token]) : Promise.resolve(null);

export const todayLocal = () => localToday();
export { addDays };
