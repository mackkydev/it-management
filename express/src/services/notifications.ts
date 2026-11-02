import { randomUUID } from "node:crypto";
import { exec } from "../db.js";
import { nowDb } from "../lib/time.js";

/**
 * แจ้งเตือนในระบบ (database channel ของ Laravel) — เขียนลงตาราง notifications รูปแบบเดียวกัน
 * type = ชื่อ class ของ Laravel เพื่อให้ทั้งสอง backend อ่านข้อมูลกันได้
 */
export const TICKET_ACTIVITY = "App\\Notifications\\TicketActivity";
const USER_TYPE = "App\\Models\\User";
export const EXPIRING_DIGEST = "App\\Notifications\\ExpiringItemsDigest";

export async function notifyUsers(userIds: number[], type: string, data: Record<string, unknown>): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const now = nowDb();
  // json_encode ของ PHP escape "/" และอักษร unicode — Laravel อ่าน JSON ปกติได้ทั้งสองแบบ
  const json = JSON.stringify(data);
  // ผู้รับหลายคน = INSERT ครั้งเดียว (subject_ref เป็นคอลัมน์ที่ฐานข้อมูลคำนวณจาก data — ห้ามใส่ค่าเอง)
  await exec(
    `INSERT INTO notifications (id, type, notifiable_type, notifiable_id, data, read_at, created_at, updated_at) VALUES ${ids.map(() => "(?, ?, ?, ?, ?, NULL, ?, ?)").join(", ")}`,
    ids.flatMap((id) => [randomUUID(), type, USER_TYPE, id, json, now, now]),
  );
}

/**
 * ทำเครื่องหมาย "อ่านแล้ว" ให้แจ้งเตือนของเรื่องหนึ่ง (ใบแจ้งงาน ticket_id / ใบลา leave_id)
 * — งานจบแล้ว / เปิดดูเรื่องนั้นแล้ว กระดิ่งจะได้ไม่ค้าง (ไปพร้อมตัวเลขบนเมนู)
 *   userId = เฉพาะคนนั้น, events = เฉพาะเหตุการณ์ที่ระบุ, exceptUserId = ยกเว้นคนนี้
 */
export async function markNoticesRead(
  field: "ticket_id" | "leave_id" | "vehicle_booking_id" | "loan_id" | "vpn_id" | "zoom_booking_id",
  value: string,
  opts: { userId?: number; events?: string[]; exceptUserId?: number | null } = {},
): Promise<void> {
  // subject_ref (index subject_ref + read_at) หาแถวของเรื่องนั้นก่อน แล้วยืนยันชนิดรหัสด้วย JSON — ไม่ต้อง parse ทุกแถวที่ยังไม่อ่าน
  const where = ["subject_ref = ?", "read_at IS NULL", "notifiable_type = ?", `JSON_UNQUOTE(JSON_EXTRACT(data, '$.${field}')) = ?`];
  const params: unknown[] = [value, USER_TYPE, value];
  if (opts.userId !== undefined) {
    where.push("notifiable_id = ?");
    params.push(opts.userId);
  }
  if (opts.exceptUserId) {
    where.push("notifiable_id <> ?");
    params.push(opts.exceptUserId);
  }
  if (opts.events?.length) {
    where.push("JSON_UNQUOTE(JSON_EXTRACT(data, '$.event')) IN (?)");
    params.push(opts.events);
  }
  await exec(`UPDATE notifications SET read_at = ? WHERE ${where.join(" AND ")}`, [nowDb(), ...params]);
}
