import { config } from "../config.js";
import { first, select } from "../db.js";
import { cached } from "../lib/request-cache.js";
import { iso, localToday } from "../lib/time.js";
import type { UserRow } from "../models/user.js";
import { getSetting } from "./settings.js";

/**
 * นโยบายของระบบที่ผู้ใช้ต้องยอมรับก่อนเข้าใช้งาน
 *   app_settings.system_policy = { enabled, display, pace } (หน้าตั้งค่าระบบ, settings.manage)
 *   แต่ละเรื่อง = แถวใน policy_groups (current_version = ฉบับที่แสดงให้ผู้ใช้, sort_order = ลำดับที่ให้ยอมรับ)
 *   แต่ละฉบับ = แถวใน policy_versions (routes/policy-versions.ts) — ฉบับที่คัดลอกมาอยู่เรื่องเดียวกัน
 *   เปิดใช้ = ผู้ใช้ทุกคน (LOCAL และ API) ที่ยังไม่ยอมรับฉบับที่แสดงของทุกเรื่อง ใช้ได้เฉพาะ POLICY_ALLOWED
 *   (middleware auth ตอบ 403 code policy_required) — pace "daily" = วันละ 1 เรื่องตามลำดับ (ยอมรับเรื่องใดแล้วในวันนั้น = ใช้งานต่อได้)
 */
/** สิทธิ์จัดการนโยบายแต่ละฉบับ + นโยบายอื่นๆ — เปิด-ปิด / ที่แสดง / จังหวะ ยังเป็น settings.manage ที่หน้าตั้งค่าระบบ */
export const POLICY_MANAGE = "policy.manage";

export interface PolicySection {
  title: string;
  body: string;
}
/** ให้ยอมรับที่ไหน: after_login = หน้ายอมรับหลังเข้าสู่ระบบ (ค่าเดิม) / login = ติ๊กยอมรับในหน้า login — ทั้งสองแบบ API ยังบังคับ policy_required เหมือนกัน */
export type PolicyDisplay = "after_login" | "login";
export const POLICY_DISPLAYS: PolicyDisplay[] = ["after_login", "login"];
/** หลายเรื่องที่ต้องยอมรับ: all = ยอมรับให้ครบทุกเรื่องในวันเดียว / daily = วันละ 1 เรื่องตามลำดับ */
export type PolicyPace = "all" | "daily";
export const POLICY_PACES: PolicyPace[] = ["all", "daily"];

export interface SystemPolicy {
  enabled: boolean;
  display: PolicyDisplay;
  pace: PolicyPace;
}

export const POLICY_DEFAULTS: SystemPolicy = { enabled: false, display: "after_login", pace: "all" };
export const MAX_POLICY_SECTIONS = 30;

/** endpoint ที่ใช้ได้ระหว่างยังไม่ยอมรับนโยบาย (path ใต้ /api/v1) */
export const POLICY_ALLOWED: { method: string; path: string }[] = [
  { method: "GET", path: "/auth/me" },
  { method: "POST", path: "/auth/logout" },
  { method: "PUT", path: "/auth/password" },
  { method: "GET", path: "/policy" },
  { method: "POST", path: "/policy/accept" },
];
/** ไฟล์แนบประกาศ เปิดอ่านได้ระหว่างยังไม่ยอมรับนโยบาย */
export const POLICY_FILE_PATH = /^\/policy\/files\/\d+$/;

export async function systemPolicy(): Promise<SystemPolicy> {
  const raw = ((await getSetting("system_policy")) ?? {}) as Partial<Record<keyof SystemPolicy, unknown>>;
  return {
    enabled: raw.enabled === true,
    display: raw.display === "login" ? "login" : "after_login",
    pace: raw.pace === "daily" ? "daily" : "all",
  };
}

/** sections จากคอลัมน์ JSON (driver คืนได้ทั้ง string และ object) — MySQL เรียง key ใหม่ จึงจัดรูปให้เทียบเนื้อหากันได้ */
export function parseSections(raw: unknown): PolicySection[] {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? (value as Partial<PolicySection>[]).map((s) => ({ title: String(s.title ?? ""), body: String(s.body ?? "") })) : [];
}

export interface PolicyFileRow {
  id: number;
  version: number | null;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

export const policyFilesOf = (versions: number[]) =>
  versions.length ? select<PolicyFileRow>("SELECT * FROM policy_files WHERE version IN (?) ORDER BY id", [versions]) : Promise.resolve([] as PolicyFileRow[]);

export const policyFileJson = (f: PolicyFileRow, base = "/policy/files") => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: Number(f.size), url: `${base}/${f.id}` });

/** ฉบับที่แสดงให้ผู้ใช้ของแต่ละเรื่อง เรียงตามลำดับที่ให้ยอมรับ */
export interface ShownPolicy {
  group_id: number;
  version: number;
  title: string;
  sections: PolicySection[];
  updated_at: string | null;
}

/** ทุกเรื่องที่ตั้งฉบับที่แสดงไว้และมีหัวข้อ (ไม่สนสวิตช์เปิดใช้) — อ่านครั้งเดียวต่อ request (แก้แล้วใน request เดียวกัน = forgetCached("policy:")) */
export const shownPolicies = (): Promise<ShownPolicy[]> =>
  cached("policy:shown", async () => {
    const rows = await select<{ group_id: number; version: number; title: string; sections: unknown; updated_at: string | null; published_at: string | null }>(
      `SELECT g.id AS group_id, v.version, v.title, v.sections, v.updated_at, v.published_at
         FROM policy_groups g JOIN policy_versions v ON v.version = g.current_version
        ORDER BY g.sort_order, g.id`,
    );
    return rows
      .map((r) => ({ group_id: Number(r.group_id), version: Number(r.version), title: r.title, sections: parseSections(r.sections), updated_at: iso(r.updated_at ?? r.published_at) }))
      .filter((p) => p.sections.length > 0);
  });

/** นโยบายที่ผู้ใช้ต้องยอมรับ = เปิดใช้ + เรื่องที่แสดงอยู่ (ว่าง = ไม่บังคับ) */
export async function activePolicies(policy?: SystemPolicy): Promise<ShownPolicy[]> {
  const p = policy ?? (await systemPolicy());
  return p.enabled ? shownPolicies() : [];
}

/** การยอมรับเวอร์ชันนี้ของผู้ใช้ (null = ยังไม่ยอมรับ) */
export async function acceptanceOf(userId: number, version: number): Promise<{ accepted_at: string } | null> {
  const row = await first<{ accepted_at: string }>("SELECT accepted_at FROM policy_acceptances WHERE user_id = ? AND version = ?", [userId, version]);
  return row ? { accepted_at: iso(row.accepted_at)! } : null;
}

/** วันเวลาที่ผู้ใช้ยอมรับแต่ละฉบับ (เฉพาะฉบับที่ถาม) */
export async function acceptedVersions(userId: number, versions: number[]): Promise<Map<number, string>> {
  if (!versions.length) return new Map();
  const rows = await select<{ version: number; accepted_at: string }>("SELECT version, accepted_at FROM policy_acceptances WHERE user_id = ? AND version IN (?)", [userId, versions]);
  return new Map(rows.map((r) => [Number(r.version), iso(r.accepted_at)!]));
}

/** ยอมรับนโยบายเรื่องใดก็ได้ไปแล้วในวันนี้ (เวลาไทย) — โหมดวันละเรื่อง */
async function acceptedToday(userId: number, now = new Date()): Promise<boolean> {
  const row = await first<{ accepted_at: string }>("SELECT accepted_at FROM policy_acceptances WHERE user_id = ? ORDER BY accepted_at DESC LIMIT 1", [userId]);
  const at = row ? iso(row.accepted_at) : null;
  return at !== null && localToday(config.localTimezone, new Date(at)) === localToday(config.localTimezone, now);
}

export interface PolicyProgress {
  active: ShownPolicy[];
  accepted: Map<number, string>;
  /** ฉบับที่ต้องยอมรับตอนนี้ตามลำดับ — ว่าง = ใช้งานได้ */
  required: number[];
}

/** สถานะการยอมรับของผู้ใช้: all = ทุกเรื่องที่ยังไม่ยอมรับ, daily = เรื่องถัดไป 1 เรื่อง เว้นแต่ยอมรับไปแล้ววันนี้ */
export const policyProgress = (userId: number): Promise<PolicyProgress> =>
  cached(`policy:progress:${userId}`, async () => {
    const p = await systemPolicy();
    const active = await activePolicies(p);
    const accepted = await acceptedVersions(
      userId,
      active.map((a) => a.version),
    );
    const pending = active.filter((a) => !accepted.has(a.version)).map((a) => a.version);
    const required = pending.length && p.pace === "daily" ? ((await acceptedToday(userId)) ? [] : pending.slice(0, 1)) : pending;
    return { active, accepted, required };
  });

/** policy_required = ต้องยอมรับนโยบายก่อนใช้งาน, policy_accepted_at = วันเวลาที่ยอมรับล่าสุด เมื่อยอมรับครบทุกเรื่องที่แสดงอยู่แล้ว */
export async function policyStatus(u: UserRow): Promise<{ policy_required: boolean; policy_accepted_at: string | null }> {
  const { active, accepted, required } = await policyProgress(u.id);
  if (!active.length) return { policy_required: false, policy_accepted_at: null };
  const all = active.every((a) => accepted.has(a.version));
  const latest = [...accepted.values()].sort().at(-1) ?? null;
  return { policy_required: required.length > 0, policy_accepted_at: all ? latest : null };
}
