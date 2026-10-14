import { select } from "../db.js";
import { isSuperAdmin, type UserRow } from "../models/user.js";
import { groupsOf } from "./permissions.js";
import { getSetting } from "./settings.js";

/**
 * ขอบเขตห้องประชุม / รถ ตามสาขา ตั้งต่อกลุ่มสิทธิ์ (app_settings.booking_scope = { meeting: { group: scope }, vehicle: { … } })
 *   all    = เห็น/จองห้อง-รถทุกสาขา (เลือกกรองสาขาในหน้าเว็บได้) — กลุ่มที่ไม่ได้ตั้ง = all (เหมือนก่อนมีการตั้งค่านี้)
 *   branch = เห็น/จองเฉพาะห้อง-รถของสาขาตัวเอง + ที่ใช้ร่วมกันทุกสาขา (branch_id = NULL)
 * ผู้ใช้ได้ขอบเขตที่กว้างที่สุดของทุกกลุ่มที่สังกัด — ผู้ดูแลระบบสูงสุด = all เสมอ
 * จัดการ (เพิ่ม/แก้ห้อง-รถ, จัดการการจองของคนอื่น, จัดคิวรถ): ขอบเขต branch = เฉพาะของสาขาตัวเอง (ของที่ใช้ร่วมกัน = ขอบเขต all เท่านั้น)
 */
export const BOOKING_SCOPES = ["branch", "all"] as const;
export type BookingScope = (typeof BOOKING_SCOPES)[number];
export const BOOKING_KINDS = ["meeting", "vehicle"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export type BookingScopeSettings = Record<BookingKind, Record<string, BookingScope>>;

const isScope = (v: unknown): v is BookingScope => (BOOKING_SCOPES as readonly unknown[]).includes(v);

export async function bookingScopeSettings(): Promise<BookingScopeSettings> {
  const raw = (await getSetting("booking_scope")) as Record<string, unknown> | null;
  const pick = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (Object.fromEntries(Object.entries(v).filter(([, s]) => isScope(s))) as Record<string, BookingScope>) : {};
  return { meeting: pick(raw?.meeting), vehicle: pick(raw?.vehicle) };
}

/** ขอบเขตของผู้ใช้ (กว้างสุดของทุกกลุ่ม) */
export async function bookingScope(u: UserRow, kind: BookingKind): Promise<BookingScope> {
  if (isSuperAdmin(u)) return "all";
  const map = (await bookingScopeSettings())[kind];
  const groups = await groupsOf(u);
  return groups.some((g) => (map[g] ?? "all") === "all") ? "all" : "branch";
}

/** ขอบเขตที่คำนวณแล้วของผู้ใช้ 1 คน — ใช้ซ้ำในคำขอเดียว */
export interface ScopeOf {
  scope: BookingScope;
  /** สาขาของผู้ใช้ (null = ยังไม่ระบุสาขา → ขอบเขต branch เห็นเฉพาะของที่ใช้ร่วมกัน) */
  branchId: number | null;
}

export async function scopeOf(u: UserRow, kind: BookingKind): Promise<ScopeOf> {
  return { scope: await bookingScope(u, kind), branchId: u.branch_id ? Number(u.branch_id) : null };
}

/** เห็น/จองห้อง-รถของสาขานี้ได้ไหม (null = ใช้ร่วมกันทุกสาขา) */
export const canSeeBranch = (s: ScopeOf, branchId: number | null) => s.scope === "all" || branchId === null || (s.branchId !== null && Number(branchId) === s.branchId);

/** จัดการห้อง-รถ / การจองของสาขานี้ได้ไหม — ของที่ใช้ร่วมกันจัดการได้เฉพาะขอบเขต all */
export const canManageBranch = (s: ScopeOf, branchId: number | null) => s.scope === "all" || (branchId !== null && s.branchId !== null && Number(branchId) === s.branchId);

/**
 * เงื่อนไข SQL "branch_id ของ alias อยู่ในขอบเขตที่เห็นได้"
 * filter: ขอบเขต all เลือกดูเฉพาะสาขาได้ (รวมของที่ใช้ร่วมกัน), ขอบเขต branch ไม่สนค่า filter
 */
export function branchWhere(column: string, s: ScopeOf, filter?: number | null): { sql: string; params: unknown[] } {
  const only = s.scope === "all" ? (filter ?? null) : s.branchId;
  if (s.scope === "all" && only === null) return { sql: "1 = 1", params: [] };
  if (only === null) return { sql: `${column} IS NULL`, params: [] };
  return { sql: `(${column} IS NULL OR ${column} = ?)`, params: [only] };
}

/** ข้อมูลให้หน้าเว็บ: ขอบเขต, สาขาของผู้ใช้, รายชื่อสาขาที่เลือกดูได้ (ขอบเขต all) */
export async function scopeMeta(u: UserRow, kind: BookingKind) {
  const s = await scopeOf(u, kind);
  const branches =
    s.scope === "all" ? (await select<{ id: number; name: string }>("SELECT id, name FROM branches WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, name")).map((b) => ({ id: Number(b.id), name: b.name })) : [];
  return { scope: s.scope, branch_id: s.branchId, branches };
}
