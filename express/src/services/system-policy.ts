import { first } from "../db.js";
import { iso } from "../lib/time.js";
import type { UserRow } from "../models/user.js";
import { getSetting } from "./settings.js";

/**
 * นโยบายของระบบที่ผู้ใช้ต้องยอมรับก่อนเข้าใช้งาน (app_settings.system_policy — หน้าตั้งค่าระบบ, settings.manage)
 *   เปิดใช้ + มีอย่างน้อย 1 หัวข้อ = ผู้ใช้ทุกคน (LOCAL และ API) ที่ยังไม่ยอมรับเวอร์ชันปัจจุบัน ใช้ได้เฉพาะ POLICY_ALLOWED
 *   (middleware auth ตอบ 403 code policy_required) — ยอมรับแล้วเก็บแถวใน policy_acceptances (วันเวลา + IP)
 *   แก้เนื้อหาโดยติ๊ก "ให้ทุกคนยอมรับใหม่" = เพิ่มเวอร์ชัน → ทุกคนต้องยอมรับอีกครั้ง
 */
export interface PolicySection {
  title: string;
  body: string;
}
export interface SystemPolicy {
  enabled: boolean;
  /** 0 = ยังไม่เคยบันทึกเนื้อหา */
  version: number;
  sections: PolicySection[];
  updated_at: string | null;
}

export const POLICY_DEFAULTS: SystemPolicy = { enabled: false, version: 0, sections: [], updated_at: null };
export const MAX_POLICY_SECTIONS = 30;

/** endpoint ที่ใช้ได้ระหว่างยังไม่ยอมรับนโยบาย (path ใต้ /api/v1) */
export const POLICY_ALLOWED: { method: string; path: string }[] = [
  { method: "GET", path: "/auth/me" },
  { method: "POST", path: "/auth/logout" },
  { method: "PUT", path: "/auth/password" },
  { method: "GET", path: "/policy" },
  { method: "POST", path: "/policy/accept" },
];

export async function systemPolicy(): Promise<SystemPolicy> {
  const raw = ((await getSetting("system_policy")) ?? {}) as Partial<Record<keyof SystemPolicy, unknown>>;
  const sections = Array.isArray(raw.sections)
    ? (raw.sections as Partial<PolicySection>[])
        .filter((s) => s && typeof s.title === "string")
        .map((s) => ({ title: String(s.title), body: String(s.body ?? "") }))
    : [];
  return {
    enabled: raw.enabled === true,
    version: Number.isInteger(Number(raw.version)) ? Number(raw.version) : 0,
    sections,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

/** ต้องยอมรับก่อนใช้งาน = เปิดใช้ + มีเนื้อหา */
export const policyActive = (p: SystemPolicy) => p.enabled && p.version > 0 && p.sections.length > 0;

/** การยอมรับเวอร์ชันนี้ของผู้ใช้ (null = ยังไม่ยอมรับ) */
export async function acceptanceOf(userId: number, version: number): Promise<{ accepted_at: string } | null> {
  const row = await first<{ accepted_at: string }>("SELECT accepted_at FROM policy_acceptances WHERE user_id = ? AND version = ?", [userId, version]);
  return row ? { accepted_at: iso(row.accepted_at)! } : null;
}

/** policy_required = ต้องยอมรับนโยบายก่อนใช้งาน, policy_accepted_at = วันเวลาที่ยอมรับเวอร์ชันปัจจุบัน */
export async function policyStatus(u: UserRow, policy?: SystemPolicy): Promise<{ policy_required: boolean; policy_accepted_at: string | null }> {
  const p = policy ?? (await systemPolicy());
  if (!policyActive(p)) return { policy_required: false, policy_accepted_at: null };
  const accepted = await acceptanceOf(u.id, p.version);
  return { policy_required: !accepted, policy_accepted_at: accepted?.accepted_at ?? null };
}
