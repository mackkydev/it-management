import { Router, type Request, type Response } from "express";
import { exec, first, insert, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, exists, int, validate, type Rules } from "../lib/validator.js";
import { me } from "../http.js";
import { can, findUser } from "../models/user.js";
import { normDept, planFor, routeSteps, type RouteRow } from "../services/approval-routes.js";

/**
 * สายอนุมัติใบแจ้งงาน — เหมือน ApprovalRouteController ของ Laravel
 *   GET    /approval-routes                 รายการ (admin)
 *   GET    /approval-routes/departments     แผนกที่มีในผู้ใช้ (admin)
 *   GET    /approval-routes/resolve?user_id=   แผนอนุมัติของผู้ใช้ (ไม่ระบุ = ตัวเอง; ดูของคนอื่นต้องเป็น admin)
 *   POST   /approval-routes                 { name, branch_id, department, is_active, steps:[{name, approver_ids}] }
 *   GET|PUT|PATCH|DELETE /approval-routes/{id}
 */
export const approvalRouteRoutes = Router();

type Row = RouteRow & { b_name: string | null };

const SELECT = "r.*, b.name AS b_name FROM approval_routes r LEFT JOIN branches b ON b.id = r.branch_id";

async function routeJson(r: Row) {
  return {
    id: r.id,
    name: r.name,
    branch: r.branch_id ? { id: r.branch_id, name: r.b_name } : null,
    department: r.department,
    is_active: Boolean(r.is_active),
    steps: (await routeSteps(r.id)).map((s) => ({ step_no: s.step_no, name: s.name, approvers: s.approvers })),
    users_count: Number(await scalar("SELECT COUNT(*) FROM users WHERE approval_route_id = ?", [r.id])),
  };
}

async function findRoute(req: Request): Promise<Row> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<Row>(`SELECT ${SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

const RULES: Rules = {
  name: ["required", "string", "max:255"],
  branch_id: ["nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
  department: ["nullable", "string", "max:100"],
  is_active: ["sometimes", "boolean"],
  steps: ["required", "array", "min:1", "max:5"],
  "steps.*.name": ["required", "string", "max:100"],
  "steps.*.approver_ids": ["required", "array", "min:1", "max:20"],
  "steps.*.approver_ids.*": ["integer", "distinct", exists("users", "id", "is_active = true")],
};

function messages(req: Request) {
  const t = (k: string) => trans(req.locale, `eam.approval.${k}`);
  return {
    "steps.required": t("steps_required"),
    "steps.array": t("steps_required"),
    "steps.min": t("steps_required"),
    "steps.max": t("steps_max"),
    "steps.*.name.required": t("step_name"),
    "steps.*.approver_ids.required": t("approvers_required"),
    "steps.*.approver_ids.array": t("approvers_required"),
    "steps.*.approver_ids.min": t("approvers_required"),
    "steps.*.approver_ids.max": t("approvers_max"),
    "steps.*.approver_ids.*.integer": t("approver_invalid"),
    "steps.*.approver_ids.*.distinct": t("approver_invalid"),
    "steps.*.approver_ids.*.exists": t("approver_invalid"),
  };
}

/** ตรวจข้อมูล + กันสายที่เปิดใช้งานซ้ำขอบเขตเดียวกัน (สาขา+แผนก) */
async function validated(req: Request, ignoreId?: number) {
  authorize(can(me(req), "approval_routes.manage"));
  const input = req.input;
  return validate(input, RULES, {
    locale: req.locale,
    messages: messages(req),
    after: async ({ errors }) => {
      if (!errors.empty || ("is_active" in input && !bool(input.is_active))) return;
      const dup = await scalar(
        `SELECT 1 FROM approval_routes
          WHERE is_active = true AND id <> ?
            AND branch_id <=> ?
            AND COALESCE(LOWER(TRIM(department)), '') = ?
          LIMIT 1`,
        [ignoreId ?? 0, int(input.branch_id), normDept(input.department as string | null) ?? ""],
      );
      if (dup) errors.add("department", trans(req.locale, "eam.approval.duplicate_scope"));
    },
  });
}

type StepInput = { name: string; approver_ids: unknown[] };

async function save(data: Record<string, unknown>, input: Record<string, unknown>, existing?: Row): Promise<number> {
  return transaction(async () => {
    const now = nowDb();
    const dept = typeof data.department === "string" && data.department.trim() !== "" ? data.department.trim() : null;
    const values = {
      name: String(data.name).trim(),
      branch_id: int(data.branch_id),
      department: dept,
      is_active: "is_active" in input ? bool(input.is_active) : (existing?.is_active ?? true),
      updated_at: now,
    };
    let id: number;
    if (existing) {
      id = existing.id;
      await update("approval_routes", values, "id = ?", [id]);
      await exec("DELETE FROM approval_route_steps WHERE approval_route_id = ?", [id]);
    } else {
      id = await insert("approval_routes", { ...values, created_at: now });
    }
    const steps = Object.values(data.steps as Record<string, StepInput>);
    for (const [i, s] of steps.entries()) {
      const stepId = await insert("approval_route_steps", { approval_route_id: id, step_no: i + 1, name: String(s.name).trim(), created_at: now, updated_at: now });
      for (const userId of Object.values(s.approver_ids)) {
        await exec("INSERT INTO approval_step_approvers (approval_route_step_id, user_id) VALUES (?, ?)", [stepId, int(userId)]);
      }
    }
    return id;
  });
}

approvalRouteRoutes.get("/approval-routes", async (req, res) => {
  authorize(can(me(req), "approval_routes.manage"));
  const rows = await select<Row>(`SELECT ${SELECT} ORDER BY r.id`);
  res.json({ data: await Promise.all(rows.map(routeJson)) });
});

approvalRouteRoutes.get("/approval-routes/departments", async (req, res) => {
  authorize(can(me(req), "approval_routes.manage"));
  const rows = await select<{ department: string }>(
    "SELECT DISTINCT TRIM(department) AS department FROM users WHERE department IS NOT NULL AND TRIM(department) <> '' ORDER BY 1",
  );
  res.json({ data: rows.map((r) => r.department) });
});

approvalRouteRoutes.get("/approval-routes/resolve", async (req, res) => {
  const u = me(req);
  const f = await validate(req.input, { user_id: ["nullable", "integer"] }, { locale: req.locale });
  const userId = int(f.user_id);
  authorize(userId === null || userId === u.id || can(u, "approval_routes.manage"));
  const target = userId === null || userId === u.id ? u : await findUser(userId);
  if (!target) throw notFound();
  res.json({ data: await planFor(target) });
});

approvalRouteRoutes.post("/approval-routes", async (req, res) => {
  const data = await validated(req);
  const id = await save(data, req.input);
  res.status(201).json({ data: await routeJson((await first<Row>(`SELECT ${SELECT} WHERE r.id = ?`, [id]))!) });
});

approvalRouteRoutes.get("/approval-routes/:id", async (req, res) => {
  const row = await findRoute(req); // หาก่อนตรวจสิทธิ์ เหมือน route model binding ของ Laravel
  authorize(can(me(req), "approval_routes.manage"));
  res.json({ data: await routeJson(row) });
});

async function updateRoute(req: Request, res: Response) {
  const row = await findRoute(req);
  const data = await validated(req, row.id);
  await save(data, req.input, row);
  res.json({ data: await routeJson((await first<Row>(`SELECT ${SELECT} WHERE r.id = ?`, [row.id]))!) });
}
approvalRouteRoutes.put("/approval-routes/:id", updateRoute);
approvalRouteRoutes.patch("/approval-routes/:id", updateRoute);

/** ลบสาย — ผู้ใช้ที่กำหนดรายบุคคลกลับไปจับคู่อัตโนมัติ (FK set null), ใบแจ้งงานที่แจ้งไปแล้วใช้ snapshot ของตัวเองต่อ */
approvalRouteRoutes.delete("/approval-routes/:id", async (req, res) => {
  const row = await findRoute(req);
  authorize(can(me(req), "approval_routes.manage"));
  await exec("DELETE FROM approval_routes WHERE id = ?", [row.id]);
  res.status(204).end();
});
