import { insert, select } from "../db.js";
import { dateOnly, diffInDays, fromDbDate, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import type { Rule } from "../lib/validator.js";
import { storeUploadIn } from "./ticket-files.js";

/**
 * สัญญา vendor — ไฟล์แนบ + การแจ้งเตือนต่อสัญญา (ใช้ร่วมกันระหว่าง routes/it-data.ts และ jobs/notify-expiring.ts)
 *
 * แจ้งเตือน = ถึงช่วง "ก่อนหมดอายุ N วัน" (notify_days_before ของสัญญา หรือค่ากลาง contract_notify_days)
 *            หรือถึงวันที่แจ้งเตือนที่กำหนดเองวันใดวันหนึ่ง (notify_dates ≤ 10 วัน, ไม่เกินวันสิ้นสุด)
 * สถานะ "ใกล้หมดอายุ" / ตัวเลขเมนู / แท็บ ใช้เงื่อนไขเดียวกัน (contractStatus ↔ CONTRACT_EXPIRING_SQL)
 */

/** ตรงกับ DOC_MAX_BYTES / DOC_ACCEPT ของหน้าเว็บ (file-pickers.tsx) — ไฟล์ละ ≤ 5MB ครั้งละไม่เกิน 10 ไฟล์ */
export const CONTRACT_FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
export const CONTRACT_FILES_MAX = 10;
export const CONTRACT_NOTIFY_DATES_MAX = 10;

export interface ContractFileRow {
  id: number;
  contract_id: number;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

export const contractFileJson = (f: ContractFileRow) => ({
  id: Number(f.id),
  name: f.original_name,
  mime: f.mime,
  size: Number(f.size),
  url: `/contracts/${f.contract_id}/files/${f.id}`,
});

export const contractFilesOf = (ids: number[]) =>
  ids.length ? select<ContractFileRow>("SELECT * FROM contract_files WHERE contract_id IN (?) ORDER BY id", [ids]) : Promise.resolve([] as ContractFileRow[]);

export const uploadsOf = (v: unknown): UploadedFile[] =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : [];

export async function saveContractFiles(contractId: number, files: UploadedFile[], userId: number) {
  const now = nowDb();
  for (const file of files) {
    const stored = await storeUploadIn(`contracts/${contractId}`, file);
    await insert("contract_files", { contract_id: contractId, ...stored, uploaded_by: userId, created_at: now, updated_at: now });
  }
}

/** notify_dates จากฐาน (mysql2 คืน JSON เป็น array หรือข้อความ) → "YYYY-MM-DD" เรียง ไม่ซ้ำ */
export function notifyDatesOf(v: unknown): string[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

export interface ContractNotifyFields {
  end_date: string;
  notify_days_before: number | null;
  notify_dates?: unknown;
}

/** จำนวนวันที่เหลือ / สถานะ — ใกล้หมดอายุ = ถึงช่วง N วันก่อนหมด หรือถึงวันแจ้งเตือนที่กำหนดเองแล้ว (ยังไม่หมดอายุ) */
export function contractStatus(c: ContractNotifyFields, defaultDays: number, today = new Date()) {
  const daysLeft = diffInDays(today, fromDbDate(dateOnly(c.end_date)!));
  const notifyDays = c.notify_days_before ?? defaultDays;
  const dates = notifyDatesOf(c.notify_dates);
  const dateReached = dates.some((d) => diffInDays(today, fromDbDate(d)) <= 0);
  const status = daysLeft < 0 ? "expired" : daysLeft <= notifyDays || dateReached ? "expiring" : "active";
  const nextDate = dates.find((d) => diffInDays(today, fromDbDate(d)) > 0) ?? null;
  return { daysLeft, notifyDays, dates, nextDate, status } as const;
}

/**
 * เงื่อนไข SQL ของ "ใกล้หมดอายุ" (alias c) — พารามิเตอร์ [today, today, defaultDays, today] (today = "YYYY-MM-DD")
 * ตรงกับ contractStatus().status === "expiring"
 */
export const CONTRACT_EXPIRING_SQL = `c.end_date >= CAST(? AS DATE)
  AND (c.end_date <= DATE_ADD(CAST(? AS DATE), INTERVAL COALESCE(c.notify_days_before, ?) DAY)
       OR EXISTS (SELECT 1 FROM JSON_TABLE(c.notify_dates, '$[*]' COLUMNS (d DATE PATH '$')) nd WHERE nd.d <= CAST(? AS DATE)))`;
export const contractExpiringParams = (today: string, defaultDays: number) => [today, today, defaultDays, today];

/**
 * ถึงเวลาแจ้งเตือนสัญญานี้วันนี้หรือไม่ (scheduler notify-expiring)
 * - byDays: ถึงช่วง N วันก่อนหมด และยังไม่เคยแจ้งสำหรับวันสิ้นสุดนี้ (notified_for_end_date)
 * - dueDate: วันที่กำหนดเองล่าสุดที่ถึงแล้วและยังไม่แจ้ง (> notified_for_date) — แจ้งครั้งเดียวต่อวันที่ตั้งไว้
 */
export function contractNotifyDue(
  c: ContractNotifyFields & { notified_for_end_date: string | null; notified_for_date: string | null },
  defaultDays: number,
  today: Date,
) {
  const s = contractStatus(c, defaultDays, today);
  const already = c.notified_for_end_date !== null && dateOnly(c.notified_for_end_date) === dateOnly(c.end_date);
  const byDays = s.daysLeft <= s.notifyDays && !already;
  const last = c.notified_for_date ? dateOnly(c.notified_for_date)! : null;
  const due = s.dates.filter((d) => diffInDays(today, fromDbDate(d)) <= 0 && (last === null || d > last));
  return { byDays, dueDate: due.length ? due[due.length - 1] : null, daysLeft: s.daysLeft };
}
