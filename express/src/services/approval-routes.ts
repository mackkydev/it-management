import { first, insert, select } from "../db.js";
import { nowDb } from "../lib/time.js";
import { rolesAbove, type UserRow } from "../models/user.js";

/**
 * สายอนุมัติใบแจ้งงาน — เหมือน App\Services\ApprovalRouteResolver ของ Laravel
 *
 * ลำดับการจับคู่ (เฉพาะสายที่เปิดใช้งาน):
 *   1. กำหนดรายบุคคล (users.approval_route_id)
 *   2. สาขา+แผนกตรง → 3. สาขาตรง+ทุกแผนก → 4. ทุกสาขา+แผนกตรง → 5. ทุกสาขา+ทุกแผนก
 *   6. ไม่พบ หรือทุกขั้นไม่เหลือผู้อนุมัติ → ระบบเดิม (หัวหน้าตามสาย supervisor_id → admin)
 * ผู้อนุมัติในแต่ละขั้น: ตัดผู้แจ้งเอง (กันอนุมัติตัวเอง) และผู้ใช้ที่ปิดใช้งาน — ขั้นที่ไม่เหลือใครถูกข้าม
 */

export type RouteSource = "user" | "branch_department" | "branch" | "department" | "default" | "legacy";

export interface RouteRow {
  id: number;
  name: string;
  branch_id: number | null;
  department: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

type Person = { id: number; name: string };

export interface RouteStep {
  step_no: number;
  name: string;
  approvers: Array<Person & { is_active: boolean }>;
}

export interface PlannedStep {
  step_no: number;
  name: string;
  approvers: Person[];
  skipped: boolean;
}

export interface ApprovalPlan {
  source: RouteSource;
  route: { id: number; name: string } | null;
  steps: PlannedStep[];
  /** ระบบเดิม: หัวหน้าตามสาย (null = admin อนุมัติแทน) */
  legacy_approver: Person | null;
}

/** แผนกเทียบแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย */
export const normDept = (d: string | null | undefined): string | null => {
  const v = (d ?? "").trim();
  return v === "" ? null : v.toLowerCase();
};

const SOURCE_BY_SCORE: RouteSource[] = ["default", "department", "branch", "branch_department"];

/** สายที่ใช้กับผู้ใช้คนนี้ (ยังไม่ดูว่ามีผู้อนุมัติเหลือหรือไม่) */
export async function matchRoute(user: Pick<UserRow, "approval_route_id" | "branch_id" | "department">): Promise<{ route: RouteRow; source: RouteSource } | null> {
  if (user.approval_route_id) {
    const own = await first<RouteRow>("SELECT * FROM approval_routes WHERE id = ? AND is_active = true", [user.approval_route_id]);
    if (own) return { route: own, source: "user" };
  }
  const dept = normDept(user.department);
  const candidates = await select<RouteRow>(
    `SELECT * FROM approval_routes
      WHERE is_active = true
        AND (branch_id IS NULL OR branch_id = ?)
        AND (department IS NULL OR LOWER(TRIM(department)) = ?)
      ORDER BY id`,
    [user.branch_id, dept ?? ""],
  );
  let best: { route: RouteRow; score: number } | null = null;
  for (const r of candidates) {
    if (r.department !== null && normDept(r.department) === null) continue; // แผนกว่าง = ไม่ใช่ "ทุกแผนก"
    const score = (r.branch_id !== null ? 2 : 0) + (r.department !== null ? 1 : 0);
    if (!best || score > best.score) best = { route: r, score };
  }
  return best ? { route: best.route, source: SOURCE_BY_SCORE[best.score] } : null;
}

/** ขั้น + ผู้อนุมัติของสาย (เรียงตาม step_no, ผู้อนุมัติเรียงตามชื่อ) */
export async function routeSteps(routeId: number): Promise<RouteStep[]> {
  const steps = await select<{ id: number; step_no: number; name: string }>(
    "SELECT id, step_no, name FROM approval_route_steps WHERE approval_route_id = ? ORDER BY step_no",
    [routeId],
  );
  if (steps.length === 0) return [];
  const rows = await select<{ step_id: number; id: number; name: string; is_active: boolean }>(
    `SELECT a.approval_route_step_id AS step_id, u.id, u.name, u.is_active
       FROM approval_step_approvers a JOIN users u ON u.id = a.user_id
      WHERE a.approval_route_step_id IN (${steps.map(() => "?").join(", ")})
      ORDER BY u.name, u.id`,
    steps.map((s) => s.id),
  );
  return steps.map((s) => ({
    step_no: s.step_no,
    name: s.name,
    approvers: rows.filter((r) => r.step_id === s.id).map((r) => ({ id: r.id, name: r.name, is_active: Boolean(r.is_active) })),
  }));
}

/** แผนการอนุมัติของผู้แจ้งคนนี้ — ใช้ทั้งตอนแจ้งงานจริง (snapshot) และหน้าทดสอบ/ฟอร์มแจ้งงาน (preview) */
export async function planFor(user: UserRow): Promise<ApprovalPlan> {
  const matched = await matchRoute(user);
  if (matched) {
    const steps: PlannedStep[] = (await routeSteps(matched.route.id)).map((s) => {
      const approvers = s.approvers.filter((a) => a.is_active && a.id !== user.id).map(({ id, name }) => ({ id, name }));
      return { step_no: s.step_no, name: s.name, approvers, skipped: approvers.length === 0 };
    });
    if (steps.some((s) => !s.skipped)) {
      return { source: matched.source, route: { id: matched.route.id, name: matched.route.name }, steps, legacy_approver: null };
    }
  }
  const supervisor = user.supervisor_id
    ? await first<Person>("SELECT id, name FROM users WHERE id = ? AND is_active = true", [user.supervisor_id])
    : null;
  return { source: "legacy", route: null, steps: [], legacy_approver: supervisor };
}

/**
 * ผู้อนุมัติที่ผู้แจ้งเลือกได้: เปิดใช้งาน มีสาขา และตำแหน่งสูงกว่าผู้แจ้ง (ไม่รวมตัวเอง)
 * ฟอร์มกรองตามสาขาที่เลือกอีกชั้น — branchId = ตรวจเฉพาะสาขานั้น
 */
export async function approverCandidates(user: UserRow, branchId?: number): Promise<Array<Person & { branch_id: number; role: string }>> {
  const roles = rolesAbove(user.role);
  if (roles.length === 0) return [];
  const params: unknown[] = [user.id, ...roles];
  let sql = `SELECT id, name, branch_id, role FROM users
             WHERE is_active = true AND branch_id IS NOT NULL AND id <> ? AND role IN (${roles.map(() => "?").join(", ")})`;
  if (branchId !== undefined) (sql += " AND branch_id = ?"), params.push(branchId);
  return select(`${sql} ORDER BY name, id`, params);
}

/** ผู้แจ้งเลือกผู้อนุมัติเอง → แทนผู้อนุมัติของขั้นแรกที่ต้องอนุมัติ (ขั้นถัดไปตามสายเดิม); ไม่มีสาย = ผู้อนุมัติคนเดียวแบบระบบเดิม */
export function withChosenApprover(plan: ApprovalPlan, approver: Person): ApprovalPlan {
  const index = plan.steps.findIndex((s) => !s.skipped);
  if (plan.source === "legacy" || index < 0) return { ...plan, legacy_approver: approver };
  return { ...plan, steps: plan.steps.map((s, i) => (i === index ? { ...s, approvers: [approver], skipped: false } : s)) };
}

/**
 * คัดลอกแผนอนุมัติลงใบแจ้งงาน (เรียกภายใน transaction ตอนแจ้งงาน)
 * คืน step_no ของขั้นแรกที่ต้องอนุมัติ — null = ใช้ระบบเดิม (approver_id = หัวหน้าตามสาย)
 */
export async function snapshotPlan(ticketId: number, plan: ApprovalPlan): Promise<number | null> {
  if (plan.source === "legacy") return null;
  const now = nowDb();
  for (const s of plan.steps) {
    await insert("it_ticket_approval_steps", {
      it_ticket_id: ticketId,
      step_no: s.step_no,
      name: s.name,
      approver_ids: JSON.stringify(s.approvers.map((a) => a.id)),
      status: s.skipped ? "skipped" : "pending",
      acted_at: s.skipped ? now : null,
      created_at: now,
      updated_at: now,
    });
  }
  return plan.steps.find((s) => !s.skipped)?.step_no ?? null;
}

export interface TicketStepRow {
  id: number;
  step_no: number;
  name: string;
  approver_ids: number[];
  status: string;
  acted_by: number | null;
  acted_at: string | null;
  comment: string | null;
}

export const ticketSteps = (ticketId: number) =>
  select<TicketStepRow>("SELECT * FROM it_ticket_approval_steps WHERE it_ticket_id = ? ORDER BY step_no", [ticketId]);
