import { createHash } from "node:crypto";
import { Router } from "express";
import { select } from "../db.js";
import { me } from "../http.js";

/**
 * GET /sync/version — "ลายนิ้วมือ" ของข้อมูลทั้งระบบ + การแจ้งเตือนของผู้ใช้ — เหมือน SyncController ของ Laravel
 * frontend ถามทุกไม่กี่วินาที ถ้าค่าเปลี่ยนจึงโหลดหน้าใหม่ (real-time แบบเบา ๆ ไม่ต้องเปิด websocket)
 * ใช้ COUNT + MAX(updated_at) ของแต่ละตาราง — เพิ่ม/แก้/ลบแถวใดก็ทำให้ค่าเปลี่ยน
 */
export const syncRoutes = Router();

const USER_TYPE = "App\\Models\\User";

/** ตารางที่หน้าจอแสดงผล (ไม่รวม personal_access_tokens ที่เปลี่ยนทุกครั้งที่เรียก API) */
export const SYNC_TABLES = [
  "announcements", "app_settings", "approval_route_steps", "approval_routes", "asset_files", "asset_licenses", "assets",
  "branches", "contracts", "credentials", "it_ticket_approval_steps", "it_ticket_attachments", "it_ticket_parts", "it_tickets",
  "kpi_entries", "license_installations", "locations", "users",
];

syncRoutes.get("/sync/version", async (req, res) => {
  const u = me(req);
  const parts = SYNC_TABLES.map((t) => `SELECT '${t}' AS k, COUNT(*) AS c, CAST(MAX(updated_at) AS TEXT) AS m FROM ${t}`);
  parts.push(
    "SELECT 'notifications' AS k, COUNT(*) AS c, CAST(COUNT(read_at) AS TEXT) AS m FROM notifications WHERE notifiable_type = ? AND notifiable_id = ?",
  );
  const rows = await select<{ k: string; c: number | string; m: string | null }>(parts.join(" UNION ALL "), [USER_TYPE, u.id]);
  const fingerprint = rows.map((r) => `${r.k}:${Number(r.c)}:${r.m ?? ""}`).sort().join("|");
  res.json({ data: { version: createHash("md5").update(fingerprint).digest("hex") } });
});
