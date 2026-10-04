import { randomUUID } from "node:crypto";
import { insert } from "../db.js";
import { nowDb } from "../lib/time.js";

/**
 * แจ้งเตือนในระบบ (database channel ของ Laravel) — เขียนลงตาราง notifications รูปแบบเดียวกัน
 * type = ชื่อ class ของ Laravel เพื่อให้ทั้งสอง backend อ่านข้อมูลกันได้
 */
export const TICKET_ACTIVITY = "App\\Notifications\\TicketActivity";
export const EXPIRING_DIGEST = "App\\Notifications\\ExpiringItemsDigest";

export async function notifyUsers(userIds: number[], type: string, data: Record<string, unknown>): Promise<void> {
  const now = nowDb();
  for (const id of new Set(userIds)) {
    await insert("notifications", {
      id: randomUUID(),
      type,
      notifiable_type: "App\\Models\\User",
      notifiable_id: id,
      // json_encode ของ PHP escape "/" และอักษร unicode — Laravel อ่าน JSON ปกติได้ทั้งสองแบบ
      data: JSON.stringify(data),
      read_at: null,
      created_at: now,
      updated_at: now,
    });
  }
}
