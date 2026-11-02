import { createHash } from "node:crypto";
import { Router } from "express";
import { exec, first, onCommittedWrite, select } from "../db.js";
import { me } from "../http.js";

/**
 * GET /sync/version — "ลายนิ้วมือ" ของข้อมูลทั้งระบบ + การแจ้งเตือนของผู้ใช้
 * frontend ถามทุก 10 วินาทีต่อแท็บ ถ้าค่าเปลี่ยนจึงโหลดหน้าใหม่ (real-time แบบเบา ๆ ไม่ต้องเปิด websocket)
 * ประสิทธิภาพ: เดิมนับ COUNT(*) + MAX(updated_at) ทุกตารางทุกครั้งที่ถาม (สแกนทั้งตาราง × ผู้ใช้ × ทุก 10 วินาที) — ตอนนี้
 *   1) ตัวนับ sync_versions (แถว "data") — API เพิ่มค่าหลังบันทึกตารางใน SYNC_TABLES (db.ts onCommittedWrite) อ่านแถวเดียวด้วย primary key
 *   2) ลายนิ้วมือแบบนับแถว คำนวณใหม่ไม่เกินทุก SLOW_FINGERPRINT_MS ต่อ process — จับการแก้ข้อมูลนอก API (phpMyAdmin / สคริปต์)
 *   3) การแจ้งเตือนของผู้ใช้ — นับด้วย index (notifiable_type, notifiable_id, read_at)
 */
export const syncRoutes = Router();

const USER_TYPE = "App\\Models\\User";

/** ตารางที่หน้าจอแสดงผล (ไม่รวม personal_access_tokens ที่เปลี่ยนทุกครั้งที่เรียก API) */
export const SYNC_TABLES = [
  "announcements", "app_settings", "approval_route_steps", "approval_routes", "asset_files", "asset_licenses", "assets",
  "branches", "contracts", "credentials", "it_ticket_approval_steps", "it_ticket_attachments", "it_ticket_parts", "it_tickets",
  "kpi_entries", "license_installations", "locations", "users",
  // ปฏิทิน/ลา + ผู้ร่วมดำเนินการ — ตัวเลขเมนู (รออนุมัติลา) และหน้าปฏิทินอัปเดตทันที
  "leave_requests", "calendar_events", "company_holidays", "it_ticket_helpers",
];
const SYNC_SET = new Set(SYNC_TABLES);

/* ---------------------------------------------------------------- ตัวนับเวอร์ชัน */

let dirty = false;
let inflight: Promise<void> = Promise.resolve();
/** บันทึกตารางที่แสดงผล → เพิ่มตัวนับ (รวมการเขียนที่ติดกันเป็นครั้งเดียว) */
onCommittedWrite((tables) => {
  if (dirty || !tables.some((t) => SYNC_SET.has(t))) return;
  dirty = true;
  inflight = inflight.then(async () => {
    dirty = false;
    // upsert — ไม่มีแถว (ฐานใหม่ / ล้างตาราง) ก็สร้างให้
    await exec(
      "INSERT INTO sync_versions (name, version, updated_at) VALUES ('data', 1, UTC_TIMESTAMP()) AS new ON DUPLICATE KEY UPDATE version = sync_versions.version + 1, updated_at = new.updated_at",
    ).catch(() => undefined);
  });
});

/* ---------------------------------------------------------------- ลายนิ้วมือแบบนับแถว (สำรอง) */

const SLOW_FINGERPRINT_MS = 5 * 60_000;
let slow: { at: number; value: Promise<string> } | null = null;
function slowFingerprint(): Promise<string> {
  if (slow && Date.now() - slow.at < SLOW_FINGERPRINT_MS) return slow.value;
  const value = select<{ k: string; c: number | string; m: string | null }>(
    SYNC_TABLES.map((t) => `SELECT '${t}' AS k, COUNT(*) AS c, CAST(MAX(updated_at) AS CHAR) AS m FROM ${t}`).join(" UNION ALL "),
  ).then((rows) => rows.map((r) => `${r.k}:${Number(r.c)}:${r.m ?? ""}`).sort().join("|"));
  slow = { at: Date.now(), value };
  value.catch(() => (slow = null));
  return value;
}

syncRoutes.get("/sync/version", async (req, res) => {
  const u = me(req);
  // การบันทึกใน process นี้ที่เพิ่งเกิด → รอให้ตัวนับอัปเดตก่อน (ผู้ใช้เห็นผลทันทีหลังบันทึก)
  await inflight;
  const [counter, notices, rows] = await Promise.all([
    first<{ v: string }>("SELECT CAST(version AS CHAR) AS v FROM sync_versions WHERE name = 'data'"),
    first<{ c: number | string; r: number | string }>(
      "SELECT COUNT(*) AS c, COUNT(read_at) AS r FROM notifications WHERE notifiable_type = ? AND notifiable_id = ?",
      [USER_TYPE, u.id],
    ),
    slowFingerprint(),
  ]);
  const fingerprint = `${counter?.v ?? ""}|${rows}|notifications:${Number(notices?.c ?? 0)}:${Number(notices?.r ?? 0)}`;
  res.json({ data: { version: createHash("md5").update(fingerprint).digest("hex") } });
});
