import type { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";

type T = Awaited<ReturnType<typeof getI18n>>["t"];

/** "api_connection.updated" → ข้อความแปล (ไม่รู้จัก = แสดง key เดิม) — ใช้ทั้งหน้ารายการและไฟล์ Excel */
export function actionLabel(t: T, action: string): string {
  const key = `audit.actions.${action.replace(/\./g, "_")}` as MessageKey;
  const text = t(key);
  return text === key ? action : text;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ตัวกรองจาก query string ของหน้า (ตรวจรูปแบบก่อนส่งต่อ API) — ไม่รวมเลขหน้า */
export function auditQuery(get: (k: string) => string, actions: string[]): URLSearchParams {
  const q = new URLSearchParams();
  if (actions.includes(get("action"))) q.set("action", get("action"));
  if (ISO_DATE.test(get("from"))) q.set("from", get("from"));
  if (ISO_DATE.test(get("to"))) q.set("to", get("to"));
  if (/^\d+$/.test(get("branch_id"))) q.set("branch_id", get("branch_id"));
  const actor = get("actor").trim();
  if (actor) q.set("actor", actor.slice(0, 100));
  return q;
}
