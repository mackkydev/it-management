import { exec, first, select, update } from "../db.js";
import { readPath, readString } from "../lib/json-path.js";
import { nowDb } from "../lib/time.js";
import { deleteUserTokens } from "../lib/tokens.js";
import type { ApiConnectionRow } from "../models/api-connection.js";
import type { UserRow } from "../models/user.js";
import { callUpstream, mapProfile, provisionUser } from "./api-auth.js";
import { audit, type AuditActor } from "./audit.js";

/**
 * ซิงค์รายชื่อผู้ใช้จากระบบต้นทางตามเวลา (หรือกด "ซิงค์ตอนนี้")
 * - ดึงรายชื่อจาก users_list_path (ใช้การยืนยันตัวตนของการเชื่อมต่อ ไม่ใช้ token ผู้ใช้) — รองรับแบ่งหน้า
 * - คนที่ใช้งานได้: สร้างไว้ล่วงหน้า (ตั้งบทบาท/ลายเซ็นได้ก่อน login ครั้งแรก) หรืออัปเดตชื่อ/อีเมล — ไม่แตะบทบาท/สิทธิ์/ลายเซ็น
 * - ถูกปิดที่ต้นทาง (status ไม่อยู่ใน active_values) หรือหายจากรายชื่อ → ปิดใช้งาน + ตัด session ทันที
 * - กลับมาใช้งานได้ที่ต้นทาง → เปิดคืน เฉพาะคนที่ซิงค์เป็นคนปิด (คนที่ admin ปิดเองไม่เปิดคืน)
 * - ดึงรายชื่อไม่ได้ / ได้ 0 คน → ไม่ปิดใครเลย (กันปิดทั้งระบบเพราะต้นทางผิดพลาด)
 */

export interface SyncResult {
  ok: boolean;
  error?: string;
  fetched: number;
  created: number;
  updated: number;
  disabled: number;
  reactivated: number;
  missing: number;
  skipped: number;
}

const MAX_PAGES = 200;

const empty = (): SyncResult => ({ ok: true, fetched: 0, created: 0, updated: 0, disabled: 0, reactivated: 0, missing: 0, skipped: 0 });

function withQuery(path: string, params: Record<string, string | number>): string {
  const q = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path;
}

/** ดึงรายชื่อทั้งหมดจากต้นทาง (ทุกหน้า) */
async function fetchDirectory(conn: ApiConnectionRow): Promise<unknown[]> {
  const items: unknown[] = [];
  const paged = Boolean(conn.users_page_param);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params: Record<string, string | number> = {};
    if (paged) params[conn.users_page_param!] = page;
    if (conn.users_page_size_param) params[conn.users_page_size_param] = conn.users_page_size;
    const res = await callUpstream(conn, { method: "GET", path: withQuery(conn.users_list_path!, params) });
    if (res.status < 200 || res.status >= 300) throw new Error(`http_${res.status}`);
    const list = readPath(res.json, conn.users_list_root_path);
    if (!Array.isArray(list)) throw new Error("bad_format");
    items.push(...list);
    if (!paged || list.length === 0 || (conn.users_page_size_param && list.length < conn.users_page_size)) break;
  }
  return items;
}

async function deactivate(user: UserRow, status: "disabled" | "missing") {
  await update("users", { is_active: false, external_status: status, updated_at: nowDb() }, "id = ?", [user.id]);
  await deleteUserTokens(user.id); // ตัด session (external_sessions ถูกลบตาม)
}

export async function syncConnection(conn: ApiConnectionRow, actor: AuditActor = {}): Promise<SyncResult> {
  const result = empty();
  try {
    if (!conn.users_list_path) throw new Error("not_configured");
    const items = await fetchDirectory(conn);
    result.fetched = items.length;
    const activeValues = (Array.isArray(conn.active_values) ? conn.active_values : []).map((v) => String(v).trim().toLowerCase());
    const seen = new Set<string>();

    for (const item of items) {
      const profile = mapProfile(conn, item);
      if (!profile) {
        result.skipped++;
        continue;
      }
      seen.add(profile.external_id);
      const status = conn.field_map?.status ? readString(item, conn.field_map.status) : null;
      const active = activeValues.length === 0 || (status !== null && activeValues.includes(status.trim().toLowerCase()));
      const existing = await first<UserRow>("SELECT * FROM users WHERE connection_id = ? AND external_id = ?", [conn.id, profile.external_id]);

      if (!existing && !active) {
        result.skipped++; // ไม่สร้างบัญชีที่ถูกปิดอยู่แล้วที่ต้นทาง
        continue;
      }
      const user = await provisionUser(conn, profile, actor);
      if (!existing) result.created++;
      else result.updated++;

      if (!active) {
        if (user.is_active) {
          await deactivate(user, "disabled");
          result.disabled++;
        } else if (user.external_status !== "disabled") {
          await update("users", { external_status: "disabled" }, "id = ?", [user.id]);
        }
      } else if (!user.is_active && (user.external_status === "disabled" || user.external_status === "missing")) {
        await update("users", { is_active: true, external_status: "active", updated_at: nowDb() }, "id = ?", [user.id]);
        result.reactivated++;
      } else if (user.external_status !== "active") {
        await update("users", { external_status: "active" }, "id = ?", [user.id]);
      }
    }

    // หายจากรายชื่อ → ปิดใช้งาน (ต้องดึงได้อย่างน้อย 1 คน)
    if (result.fetched > 0) {
      const locals = await select<UserRow>("SELECT * FROM users WHERE connection_id = ? AND type = 'API' AND is_active = true", [conn.id]);
      for (const u of locals) {
        if (u.external_id && !seen.has(u.external_id)) {
          await deactivate(u, "missing");
          result.missing++;
        }
      }
    }
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? e.message : "error";
  }

  await exec("UPDATE api_connections SET last_synced_at = ?, last_sync_result = ? WHERE id = ?", [nowDb(), JSON.stringify(result), conn.id]);
  // บันทึก audit เมื่อมีการเปลี่ยนแปลงหรือผิดพลาด (ไม่บันทึกทุกรอบที่ไม่มีอะไรเปลี่ยน)
  if (!result.ok || result.created || result.disabled || result.reactivated || result.missing) {
    await audit(actor, { action: "api_connection.synced", subjectType: "api_connection", subjectId: conn.id, after: result });
  }
  return result;
}

/** การเชื่อมต่อที่ถึงรอบซิงค์ (เปิดใช้งาน + ตั้งรอบ + มี endpoint รายชื่อ) */
export async function dueConnections(now = Date.now()): Promise<ApiConnectionRow[]> {
  const rows = await select<ApiConnectionRow>(
    "SELECT * FROM api_connections WHERE is_enabled = true AND sync_interval_minutes > 0 AND users_list_path IS NOT NULL",
  );
  return rows.filter((c) => !c.last_synced_at || now - new Date(`${c.last_synced_at.replace(" ", "T")}Z`).getTime() >= c.sync_interval_minutes * 60_000);
}

/** รันซิงค์ทุกการเชื่อมต่อที่ถึงรอบ (เรียกจาก scheduler) */
export async function syncDueConnections(): Promise<number> {
  const due = await dueConnections();
  for (const conn of due) await syncConnection(conn);
  return due.length;
}
