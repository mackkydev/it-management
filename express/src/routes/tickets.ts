import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { exec, first, insert, isUuid, likeEscape, lockNamed, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { exists, int, validate, type Rule } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { person } from "../resources.js";
import { getSetting } from "../services/settings.js";
import { readStored, storeSignature, storeUpload, deleteTicketFiles } from "../services/ticket-files.js";
import {
  actionsFor, canAccept, canApprove, canClose, canConfirmClose, canProgress, canRecordResult, canView, IT_STAFF_WHERE, itStaff, notify, PRE_APPROVAL, TICKET_APPROVAL_COLUMNS, type TicketRow, canDecideCancel, canDelete, canEdit, canRequestCancel, canWithdrawCancel,
} from "../services/ticket-workflow.js";
import { activeSignature, copySignatureTo, mimeOf, readSignature } from "../services/signatures.js";
import { audit } from "../services/audit.js";
import { ACCEPTED_TICKET_STATUSES } from "../services/kpi.js";
import { OWN_SQL } from "./assets.js";
import { approverCandidates, planFor, snapshotPlan, ticketSteps, withChosenApprover } from "../services/approval-routes.js";
import { trans } from "../lib/i18n.js";

/**
 * 4.2 / 4.3 ใบแจ้งดำเนินงาน IT — เหมือน TicketController ของ Laravel
 * ไฟล์ไม่ส่ง path จริง ส่งเป็น URL /tickets/{uuid}/files/... (ตรวจสิทธิ์ทุกครั้ง)
 */
export const ticketRoutes = Router();

const TYPES = ["repair", "install", "grant_access", "revoke_access", "other"];
const STATUSES = ["pending_supervisor", "approved", "in_progress", "pending_it_head", "pending_requester", "completed", "rejected", "pending_cancel", "cancelled"];
const PHOTO_RULE: Rule[] = ["image", "mimes:jpg,jpeg,png,webp", "max:1024"]; // ≤ 1MB
const DOC_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"]; // ≤ 5MB
const FILLABLE = [
  "type", "type_other", "branch_id", "department", "division", "details", "due_date",
  "person_name_th", "person_name_en", "device_name", "asset_tag", "symptom", "assignee_id",
] as const;

/** โหลดใบแจ้งงาน + ข้อมูลขั้นอนุมัติที่กติกาสิทธิ์ใช้ (TICKET_APPROVAL_COLUMNS) */
const loadTicket = (where: string, param: unknown) =>
  first<TicketRow>(`SELECT t.*, ${TICKET_APPROVAL_COLUMNS} FROM it_tickets t WHERE ${where}`, [param]);

async function findTicket(uuid: string): Promise<TicketRow> {
  if (!isUuid(uuid)) throw notFound();
  const t = await loadTicket("t.uuid = ?", uuid);
  if (!t) throw notFound();
  return t;
}

/** ไฟล์ทั้งหมดใน input ของฟิลด์ที่เป็นรายการ (photos[] / documents[]) */
const filesOf = (v: unknown): UploadedFile[] =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : [];

/** mb_strimwidth($details, 0, 160, '…') */
function strimwidth(s: string, width = 160): string {
  const chars = [...s];
  return chars.length <= width ? s : `${chars.slice(0, width - 1).join("")}…`;
}

/* ---------------------------------------------------------------- JSON */

type SummaryRow = TicketRow & { r_name: string | null; as_name: string | null; b_id: number | null; b_name: string | null };

const SUMMARY_SELECT = `t.*, r.name AS r_name, asg.name AS as_name, b.id AS b_id, b.name AS b_name, ${TICKET_APPROVAL_COLUMNS}
  FROM it_tickets t
  LEFT JOIN users r ON r.id = t.requester_id
  LEFT JOIN users asg ON asg.id = t.assignee_id
  LEFT JOIN branches b ON b.id = t.branch_id AND b.deleted_at IS NULL`;

function summary(t: SummaryRow, viewer: UserRow) {
  return {
    id: t.uuid,
    ticket_no: t.ticket_no,
    type: t.type,
    type_other: t.type_other,
    status: t.status,
    details: strimwidth(t.details),
    requester: person(t.requester_id, t.r_name),
    assignee: person(t.assignee_id, t.as_name),
    branch: t.b_id ? { id: t.b_id, name: t.b_name } : null,
    due_date: dateOnly(t.due_date),
    requested_at: iso(t.requested_at),
    actions: actionsFor(viewer, t),
  };
}

async function detail(t: TicketRow, viewer: UserRow) {
  const row = (await first<SummaryRow>(`SELECT ${SUMMARY_SELECT} WHERE t.id = ?`, [t.id]))!;
  const name = async (id: number | null) => (id ? first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [id]) : null);
  const requester = await first<{ id: number; name: string; email: string; has_signature: boolean }>(
    "SELECT id, name, email, EXISTS (SELECT 1 FROM user_signatures us WHERE us.user_id = users.id AND us.is_active = true) AS has_signature FROM users WHERE id = ?",
    [row.requester_id],
  );
  // relation asset ใช้ SoftDeletes scope → สินทรัพย์ที่ถูกลบไม่แสดง
  const asset = row.asset_id ? await first<{ uuid: string; asset_tag: string; name: string }>("SELECT uuid, asset_tag, name FROM assets WHERE id = ? AND deleted_at IS NULL", [row.asset_id]) : null;
  const attachments = await select<{ id: number; kind: string; original_name: string | null; mime: string | null; size: number }>(
    "SELECT id, kind, original_name, mime, size FROM it_ticket_attachments WHERE it_ticket_id = ? ORDER BY id",
    [row.id],
  );
  const parts = await select<{ id: number; name: string; quantity: number; photo_path: string | null }>(
    "SELECT id, name, quantity, photo_path FROM it_ticket_parts WHERE it_ticket_id = ? ORDER BY id",
    [row.id],
  );
  const events = await select<{ id: number; action: string; comment: string | null; created_at: string; u_id: number | null; u_name: string | null }>(
    `SELECT e.id, e.action, e.comment, e.created_at, u.id AS u_id, u.name AS u_name
       FROM it_ticket_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.it_ticket_id = ? ORDER BY e.id`,
    [row.id],
  );
  const file = (kind: string, id?: number) => `/tickets/${row.uuid}/files/${kind}${id ? `/${id}` : ""}`;
  const steps = await ticketSteps(row.id);
  const stepUserIds = [...new Set(steps.flatMap((s) => [...s.approver_ids.map(Number), ...(s.acted_by ? [Number(s.acted_by)] : [])]))];
  const stepNames = new Map(
    stepUserIds.length
      ? (await select<{ id: number; name: string }>(`SELECT id, name FROM users WHERE id IN (${stepUserIds.map(() => "?").join(", ")})`, stepUserIds)).map((r) => [r.id, r.name])
      : [],
  );

  return {
    ...summary(row, viewer),
    details: row.details,
    department: row.department,
    division: row.division,
    requester: requester ? { id: requester.id, name: requester.name, email: requester.email } : null,
    person_name_th: row.person_name_th,
    person_name_en: row.person_name_en,
    device_name: row.device_name,
    asset_tag: row.asset_tag,
    asset: asset ? { id: asset.uuid, asset_tag: asset.asset_tag, name: asset.name } : null,
    symptom: row.symptom,
    approver: await name(row.approver_id),
    approved_at: iso(row.approved_at),
    accepted_at: iso(row.accepted_at),
    result: row.result,
    completed_on: dateOnly(row.completed_on),
    cannot_reason: row.cannot_reason,
    repair_method: row.repair_method,
    external_vendor: row.external_vendor,
    warranty: row.warranty,
    repair_details: row.repair_details,
    resulted_at: iso(row.resulted_at),
    it_head: await name(row.it_head_id),
    closed_at: iso(row.closed_at),
    cancel_reason: row.cancel_reason,
    cancel_requested_at: iso(row.cancel_requested_at),
    cancel_requested_status: row.cancel_requested_status,
    cancelled_at: iso(row.cancelled_at),
    cancelled_by: await name(row.cancelled_by),
    current_step: row.current_step,
    approval_steps: steps.map((s) => ({
      step_no: s.step_no,
      name: s.name,
      status: s.status,
      approvers: s.approver_ids.map((id) => person(Number(id), stepNames.get(Number(id)) ?? null)).filter((p) => p !== null),
      acted_by: s.acted_by ? person(Number(s.acted_by), stepNames.get(Number(s.acted_by)) ?? null) : null,
      acted_at: iso(s.acted_at),
      comment: s.comment,
    })),
    signatures: {
      // สำเนาตอนแจ้งงาน หรือลายเซ็นปัจจุบันในโปรไฟล์ผู้แจ้ง (แสตมป์ตอนดู/พิมพ์)
      requester: row.requester_signature || requester?.has_signature ? file("requester-signature") : null,
      staff: row.staff_signature ? file("staff-signature") : null,
      it_head: row.it_head_signature ? file("it-head-signature") : null,
    },
    attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.original_name, mime: a.mime, size: Number(a.size), url: file("attachment", a.id) })),
    parts: parts.map((p) => ({ id: p.id, name: p.name, quantity: Number(p.quantity), photo_url: p.photo_path ? file("part", p.id) : null })),
    events: events.map((e) => ({ id: e.id, action: e.action, comment: e.comment, user: person(e.u_id, e.u_name), created_at: iso(e.created_at) })),
  };
}

async function respondDetail(req: Request, res: Response, ticketId: number, status = 200) {
  const t = (await loadTicket("t.id = ?", ticketId))!;
  res.status(status).json({ data: await detail(t, me(req)) });
}

const log = (ticketId: number, userId: number | null, action: string, comment: string | null = null) =>
  insert("it_ticket_events", { it_ticket_id: ticketId, user_id: userId, action, comment, created_at: nowDb() });

/** รหัสแบบฟอร์ม "ใบแจ้งดำเนินงาน IT" — ส่วนหน้าของเลขที่ใบงาน (เดิม "IT") */
const TICKET_NO_PREFIX = "FM-ITR-01";

/**
 * เลขที่ใบแจ้งงาน FM-ITR-01-YYYY-NNNNN (เริ่ม 00001 ใหม่ทุกปี) — ต้องเรียกภายใน transaction
 * ลำดับนับต่อจากใบรูปแบบเดิม IT-YYYY-NNNNN ของปีเดียวกัน (เลขลำดับไม่ซ้ำกับใบเก่า)
 * ล็อกด้วย named lock (GET_LOCK — ปลดเมื่อจบ transaction) กันเลขซ้ำเมื่อแจ้งพร้อมกัน
 */
async function nextTicketNo(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `${TICKET_NO_PREFIX}-${year}-`;
  await lockNamed("it_tickets.ticket_no");
  const last = await scalar<number>(
    "SELECT MAX(CAST(SUBSTRING_INDEX(ticket_no, '-', -1) AS UNSIGNED)) FROM it_tickets WHERE ticket_no LIKE ? OR ticket_no LIKE ?",
    [`${prefix}%`, `IT-${year}-%`],
  );
  return prefix + String(Number(last ?? 0) + 1).padStart(5, "0");
}

/* ---------------------------------------------------------------- list / options */

/**
 * เงื่อนไข "รออนุมัติของฉัน"
 * - สายอนุมัติ: ผู้ใช้อยู่ในกลุ่มผู้อนุมัติของขั้นปัจจุบัน
 * - ระบบเดิม: approver_id = ผู้ใช้ (admin เห็นใบที่ไม่มีผู้อนุมัติด้วย)
 */
const approvalsWhere = (u: UserRow) => {
  const legacy = can(u, "tickets.approve_any") ? "(t.approver_id = ? OR t.approver_id IS NULL)" : "t.approver_id = ?";
  return {
    sql: `t.status = 'pending_supervisor' AND (
      (t.current_step IS NULL AND ${legacy})
      OR (t.current_step IS NOT NULL AND EXISTS (SELECT 1 FROM it_ticket_approval_steps s
            WHERE s.it_ticket_id = t.id AND s.step_no = t.current_step AND JSON_CONTAINS(s.approver_ids, ?))))`,
    params: [u.id, JSON.stringify([u.id])],
  };
};

async function counts(u: UserRow) {
  const count = async (sql: string, params: unknown[] = []) => Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${sql}`, params));
  const ap = approvalsWhere(u);
  const out: Record<string, number> = {
    mine_open: await count("t.requester_id = ? AND t.status NOT IN ('completed', 'rejected', 'cancelled')", [u.id]),
    approvals: await count(ap.sql, ap.params),
  };
  if (can(u, "it_tickets.queue")) {
    out.it_new = await count("t.status = 'approved'");
    out.it_in_progress = await count("t.status = 'in_progress'");
    out.it_mine = await count("t.status = 'in_progress' AND t.assignee_id = ?", [u.id]);
    out.it_review = await count("t.status = 'pending_it_head'");
    out.it_cancel = await count("t.status = 'pending_cancel'");
  }
  return out;
}

/**
 * GET /menu-badges — ตัวเลขบนเมนู = งานที่ "รอฉันทำ" (เงื่อนไขเดียวกับปุ่มใน ticket-workflow.ts)
 *   /tickets           ใบของฉันที่รอฉันกดรับงาน (รอปิดงาน)
 *   /tickets/approvals ใบที่รอฉันอนุมัติ
 *   /it/tickets        รอรับงาน (ที่ฉันรับได้) + งานของฉันที่กำลังทำ + รอหัวหน้า IT อนุมัติผล (ถ้ามีสิทธิ์) + รอยืนยันยกเลิก
 *   /kpi               ใบงานที่ฉันรับแล้วแต่ยังไม่กรอก Complexity ใน KPI
 */
ticketRoutes.get("/menu-badges", async (req, res) => {
  const u = me(req);
  const count = async (sql: string, params: unknown[] = []) => Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${sql}`, params));
  const ap = approvalsWhere(u);
  const data: Record<string, number> = {
    "/tickets": await count("t.status = 'pending_requester' AND t.requester_id = ?", [u.id]),
    "/tickets/approvals": await count(ap.sql, ap.params),
  };
  if (can(u, "it_tickets.queue")) {
    const all = can(u, "it_tickets.manage_all");
    const unassigned = can(u, "it_tickets.accept") ? "OR t.assignee_id IS NULL" : "";
    const mineOrOpen = all ? "1 = 1" : `(t.assignee_id = ? ${unassigned})`;
    const p = all ? [] : [u.id];
    data["/it/tickets"] =
      (await count(`t.status = 'approved' AND ${mineOrOpen}`, p)) +
      (await count("t.status = 'in_progress' AND t.assignee_id = ?", [u.id])) +
      (can(u, "it_tickets.close") ? await count("t.status = 'pending_it_head'") : 0) +
      (await count(`t.status = 'pending_cancel' AND ${mineOrOpen}`, p));
  }
  if (can(u, "kpi.use")) {
    data["/kpi"] = await count(
      `t.assignee_id = ? AND t.status IN (?) AND NOT EXISTS (SELECT 1 FROM kpi_entries k WHERE k.ticket_id = t.id AND k.complexity > 0)`,
      [u.id, ACCEPTED_TICKET_STATUSES],
    );
  }
  res.json({ data });
});

/** GET /tickets?scope=mine|approvals|it&status=&type=&assigned=me&search= */
ticketRoutes.get("/tickets", async (req, res) => {
  const u = me(req);
  const f = await validate(
    req.input,
    {
      scope: ["nullable", "in:mine,approvals,it"],
      status: ["nullable", `in:${STATUSES.join(",")}`],
      type: ["nullable", `in:${TYPES.join(",")}`],
      assigned: ["nullable", "in:me"],
      search: ["nullable", "string", "max:100"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const scope = (f.scope as string | null) ?? "mine";
  authorize(scope !== "it" || can(u, "it_tickets.queue"));

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (scope === "mine") (where.push("t.requester_id = ?"), params.push(u.id));
  // คิวงาน IT: เฉพาะใบที่หัวหน้าอนุมัติแล้ว
  if (scope === "it") where.push(`t.status NOT IN (${PRE_APPROVAL.map((s) => `'${s}'`).join(", ")})`);
  if (scope === "approvals") {
    const ap = approvalsWhere(u);
    where.push(ap.sql);
    params.push(...ap.params);
  }
  if (f.assigned === "me") (where.push("t.assignee_id = ?"), params.push(u.id));
  if (f.status) (where.push("t.status = ?"), params.push(f.status));
  if (f.type) (where.push("t.type = ?"), params.push(f.type));
  const term = likeEscape(String(f.search ?? "").trim());
  if (term) {
    where.push("(t.ticket_no LIKE ? OR t.details LIKE ? OR t.asset_tag LIKE ? OR t.person_name_th LIKE ?)");
    params.push(`%${term}%`, `%${term}%`, `${term}%`, `%${term}%`);
  }
  const whereSql = where.join(" AND ");
  const perPage = int(f.per_page) ?? 20;
  const page = pageParam(req);

  const total = Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${whereSql}`, params));
  const rows = await select<SummaryRow>(`SELECT ${SUMMARY_SELECT} WHERE ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [
    ...params, perPage, (page - 1) * perPage,
  ]);
  res.json({ data: rows.map((t) => summary(t, u)), meta: shortMeta(total, page, perPage, rows.length), counts: await counts(u) });
});

/** ตัวเลือกของฟอร์มแจ้งงาน: สาขาที่เปิดใช้งาน, แผนก/ฝ่าย (ข้อมูลหลัก), ผู้อนุมัติที่เลือกได้, เจ้าหน้าที่ IT, ตัวเลือกเรื่อง "อื่นๆ" */
ticketRoutes.get("/tickets/form-options", async (req, res) => {
  const branches = await select<{ id: number; code: string; name: string }>(
    "SELECT id, code, name FROM branches WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, name",
  );
  const units = (table: "departments" | "divisions") =>
    select<{ name: string }>(`SELECT name FROM ${table} WHERE is_active = true ORDER BY sort_order, name`).then((rows) => rows.map((r) => r.name));
  const u = me(req);
  // สินทรัพย์ของฉัน (ผู้ถือครอง หรือชื่อผู้ใช้งานในทะเบียนคอมพิวเตอร์ตรงกับชื่อ) — เลือกเครื่องที่ส่งซ่อม / ติดตั้ง
  const myAssets = select<{ uuid: string; asset_tag: string; name: string; brand: string | null; model: string | null; category: string }>(
    `SELECT a.uuid, a.asset_tag, a.name, a.brand, a.model, a.category FROM assets a
      WHERE a.deleted_at IS NULL AND a.status NOT IN ('disposed', 'lost') AND ${OWN_SQL} ORDER BY a.asset_tag LIMIT 200`,
    [u.id, u.name],
  );
  const [staff, otherTypes, departments, divisions, approvers, assets] = await Promise.all([
    itStaff(), getSetting("ticket_other_types"), units("departments"), units("divisions"), approverCandidates(u), myAssets,
  ]);
  res.json({
    data: {
      branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      departments,
      divisions,
      approvers: approvers.map((a) => ({ id: a.id, name: a.name, branch_id: Number(a.branch_id), role: a.role })),
      it_staff: staff.map((s) => ({ id: s.id, name: s.name })),
      other_types: Array.isArray(otherTypes) ? otherTypes : Object.values(otherTypes ?? {}),
      my_assets: assets.map((a) => ({ id: a.uuid, asset_tag: a.asset_tag, name: a.name, brand: a.brand, model: a.model, category: a.category })),
    },
  });
});

/** ผู้อนุมัติที่ผู้แจ้งเลือก — ต้องอยู่สาขาที่เลือกและตำแหน่งสูงกว่า (คืน null = ไม่ได้เลือก) */
async function chosenApprover(req: Request, data: Record<string, unknown>) {
  if (data.approver_id === undefined || data.approver_id === null || data.approver_id === "") return null;
  const found = (await approverCandidates(me(req), int(data.branch_id) ?? 0)).find((a) => a.id === int(data.approver_id));
  if (!found) throw ValidationError.withMessages({ approver_id: trans(req.locale, "eam.approval.approver_not_allowed") });
  return { id: Number(found.id), name: found.name };
}

/** เจ้าหน้าที่ IT สำหรับ dropdown */
ticketRoutes.get("/it-staff", async (_req, res) => {
  const staff = await itStaff();
  res.json({ data: staff.map((s) => ({ id: s.id, name: s.name, is_it_head: Boolean(Number(s.is_it_head)) })) });
});

/* ---------------------------------------------------------------- แจ้งงาน */

ticketRoutes.post("/tickets", async (req, res) => {
  const u = me(req);
  const data = await validate(
    req.input,
    {
      type: ["required", `in:${TYPES.join(",")}`],
      type_other: ["required_if:type,other", "nullable", "string", "max:255"],
      branch_id: ["required", "integer", exists("branches", "id", "is_active = true AND deleted_at IS NULL")],
      department: ["nullable", "string", "max:100"],
      division: ["nullable", "string", "max:100"],
      details: ["required", "string", "max:5000"],
      due_date: ["nullable", "date", "after_or_equal:today"],
      // เจ้าหน้าที่ IT: ผู้แจ้งต้องระบุคน
      assignee_id: ["required", "integer", exists("users", "id", IT_STAFF_WHERE)],
      // ผู้อนุมัติที่ผู้แจ้งเลือก (แทนขั้นแรกของสาย) — ไม่ส่ง = ตามสายอนุมัติ
      approver_id: ["nullable", "integer"],
      person_name_th: ["required_if:type,grant_access,revoke_access", "nullable", "string", "max:255"],
      person_name_en: ["required_if:type,grant_access,revoke_access", "nullable", "string", "max:255"],
      device_name: ["required_if:type,repair", "nullable", "string", "max:255"],
      asset_tag: ["nullable", "string", "max:50"],
      symptom: ["required_if:type,repair", "nullable", "string", "max:5000"],
      photos: ["nullable", "array", "max:4"],
      "photos.*": PHOTO_RULE,
      documents: ["nullable", "array", "max:5"],
      "documents.*": DOC_RULE,
      // ไม่บังคับแล้ว — ปกติใช้ลายเซ็นที่อัปโหลดไว้ในโปรไฟล์
      signature: ["nullable", "string", "max:500000"],
    },
    { locale: req.locale },
  );

  const chosen = await chosenApprover(req, data);
  const routePlan = await planFor(u);
  const plan = chosen ? withChosenApprover(routePlan, chosen) : routePlan;
  const ticketId = await transaction(async () => {
    const type = String(data.type);
    const values: Record<string, unknown> = {};
    for (const key of FILLABLE) if (key in data) values[key] = data[key];
    // เก็บเฉพาะฟิลด์ที่ตรงกับเรื่อง (กันข้อมูลค้างจากการเปลี่ยนเรื่องในฟอร์ม)
    if (type !== "grant_access" && type !== "revoke_access") values.person_name_th = values.person_name_en = null;
    if (type !== "repair" && type !== "install") values.device_name = values.asset_tag = null;
    if (type !== "repair") values.symptom = null;
    if (type !== "other") values.type_other = null;
    if (values.due_date) values.due_date = String(values.due_date).slice(0, 10);
    for (const key of ["branch_id", "assignee_id"]) if (key in values) values[key] = int(values[key]);
    const assetId = values.asset_tag
      ? await scalar<number>("SELECT id FROM assets WHERE asset_tag = ? AND deleted_at IS NULL", [values.asset_tag])
      : null;

    const uuid = randomUUID();
    const now = nowDb();
    const id = await insert("it_tickets", {
      ...values,
      uuid,
      asset_id: assetId,
      ticket_no: await nextTicketNo(),
      status: "pending_supervisor",
      requester_id: u.id,
      // ระบบเดิม: หัวหน้าตามสายบังคับบัญชา (null = admin อนุมัติ) — สายอนุมัติ: ใส่ผู้อนุมัติขั้นสุดท้ายตอนอนุมัติครบ
      approver_id: plan.source === "legacy" ? (chosen?.id ?? u.supervisor_id) : null,
      requested_at: now,
      created_at: now,
      updated_at: now,
    });
    const firstStep = await snapshotPlan(id, plan);
    if (firstStep !== null) await update("it_tickets", { current_step: firstStep }, "id = ?", [id]);

    // ลายเซ็นผู้แจ้ง: ส่งมาเป็นรูปวาด (แอป/ระบบเดิม) หรือคัดลอกลายเซ็นในโปรไฟล์ ณ ตอนแจ้ง
    const signature = data.signature
      ? await storeSignature(uuid, String(data.signature), "requester", req.locale)
      : await copySignatureTo(u.id, `tickets/${uuid}/signatures`, "requester", req, { ticket: uuid });
    if (signature) await update("it_tickets", { requester_signature: signature, updated_at: nowDb() }, "id = ?", [id]);
    for (const photo of filesOf(data.photos)) {
      await insert("it_ticket_attachments", { it_ticket_id: id, kind: "request", uploaded_by: u.id, ...(await storeUpload(uuid, photo, "request")), created_at: now, updated_at: now });
    }
    for (const doc of filesOf(data.documents)) {
      await insert("it_ticket_attachments", { it_ticket_id: id, kind: "document", uploaded_by: u.id, ...(await storeUpload(uuid, doc, "documents")), created_at: now, updated_at: now });
    }
    await log(id, u.id, "submitted");
    return id;
  });

  const ticket = (await loadTicket("t.id = ?", ticketId))!;
  await notify(ticket, "submitted", u);
  await respondDetail(req, res, ticketId, 201);
});

ticketRoutes.get("/tickets/:uuid", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  authorize(canView(me(req), t));
  await respondDetail(req, res, t.id);
});

/* ---------------------------------------------------------------- ขั้นตอนอนุมัติ / ดำเนินงาน */

ticketRoutes.post("/tickets/:uuid/approve", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canApprove(u, t));
  const data = await validate(req.input, { comment: ["nullable", "string", "max:2000"] }, { locale: req.locale });

  const comment = (data.comment as string) ?? null;

  // สายอนุมัติ: ปิดขั้นปัจจุบัน แล้วไปขั้นถัดไปที่ยังรออยู่ — ถ้าไม่มีแล้วจึงอนุมัติใบงาน
  const next = t.current_step !== null ? (await ticketSteps(t.id)).find((s) => s.step_no > t.current_step! && s.status === "pending") : undefined;
  await transaction(async () => {
    const now = nowDb();
    if (t.current_step !== null) {
      await update("it_ticket_approval_steps", { status: "approved", acted_by: u.id, acted_at: now, comment, updated_at: now }, "it_ticket_id = ? AND step_no = ?", [t.id, t.current_step]);
    }
    if (next) {
      await update("it_tickets", { current_step: next.step_no, updated_at: now }, "id = ?", [t.id]);
      await log(t.id, u.id, "step_approved", comment);
    } else {
      await update("it_tickets", { status: "approved", approver_id: u.id, approved_at: now, current_step: null, updated_at: now }, "id = ?", [t.id]);
      await log(t.id, u.id, "approved", comment);
    }
  });
  if (next) await notify((await loadTicket("t.id = ?", t.id))!, "step_approved", u);
  else await notify({ ...t, status: "approved", approver_id: u.id, current_step: null }, "approved", u);
  await respondDetail(req, res, t.id);
});

ticketRoutes.post("/tickets/:uuid/reject", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canApprove(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });

  await transaction(async () => {
    const now = nowDb();
    if (t.current_step !== null) {
      await update("it_ticket_approval_steps", { status: "rejected", acted_by: u.id, acted_at: now, comment: String(data.comment), updated_at: now }, "it_ticket_id = ? AND step_no = ?", [t.id, t.current_step]);
    }
    await update("it_tickets", { status: "rejected", approver_id: u.id, approved_at: now, closed_at: now, current_step: null, updated_at: now }, "id = ?", [t.id]);
    await log(t.id, u.id, "rejected", String(data.comment));
  });
  await notify({ ...t, status: "rejected", approver_id: u.id, current_step: null }, "rejected", u);
  await respondDetail(req, res, t.id);
});

ticketRoutes.post("/tickets/:uuid/accept", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canAccept(u, t));

  await transaction(async () => {
    await update("it_tickets", { status: "in_progress", assignee_id: u.id, accepted_at: nowDb(), updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "accepted");
  });
  await notify({ ...t, status: "in_progress", assignee_id: u.id }, "accepted", u);
  await respondDetail(req, res, t.id);
});

/** 4.3.2 / 4.3.3 บันทึกผลการดำเนินงาน (+ การซ่อม, รูปหลังซ่อม ≤ 4, อะไหล่พร้อมรูป ≤ 1 ต่อรายการ) */
ticketRoutes.post("/tickets/:uuid/result", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canRecordResult(u, t));
  const repair = t.type === "repair";

  const data = await validate(
    req.input,
    {
      result: ["required", "in:completed,cannot_complete"],
      completed_on: ["required_if:result,completed", "nullable", "date", `before_or_equal:${localToday()}`],
      cannot_reason: ["required_if:result,cannot_complete", "nullable", "string", "max:2000"],
      repair_method: [repair ? "required" : "nullable", "in:in_house,external"],
      external_vendor: ["required_if:repair_method,external", "nullable", "string", "max:255"],
      warranty: [repair ? "required" : "nullable", "in:in_warranty,out_of_warranty"],
      repair_details: ["nullable", "string", "max:5000"],
      photos: ["nullable", "array", "max:4"],
      "photos.*": PHOTO_RULE,
      parts: ["nullable", "array", "max:10"],
      "parts.*.name": ["required", "string", "max:255"],
      "parts.*.quantity": ["nullable", "integer", "min:1", "max:999"],
      "parts.*.photo": ["nullable", ...PHOTO_RULE],
      signature: ["required", "string", "max:500000"],
    },
    { locale: req.locale },
  );

  await transaction(async () => {
    const now = nowDb();
    const completed = data.result === "completed";
    await update(
      "it_tickets",
      {
        result: data.result,
        completed_on: completed ? String(data.completed_on).slice(0, 10) : null,
        cannot_reason: completed ? null : data.cannot_reason,
        repair_method: repair ? data.repair_method : null,
        external_vendor: repair && data.repair_method === "external" ? data.external_vendor : null,
        warranty: repair ? data.warranty : null,
        repair_details: data.repair_details ?? null,
        staff_signature: await storeSignature(t.uuid, String(data.signature), "staff", req.locale),
        resulted_at: now,
        status: "pending_it_head",
        updated_at: now,
      },
      "id = ?",
      [t.id],
    );

    // บันทึกใหม่ทับรายการอะไหล่เดิม (กรณีถูกส่งกลับแก้ไข)
    await exec("DELETE FROM it_ticket_parts WHERE it_ticket_id = ?", [t.id]);
    for (const part of Object.values((data.parts ?? {}) as Record<string, Record<string, unknown>>)) {
      const photo = part.photo instanceof UploadedFile ? part.photo : null;
      await insert("it_ticket_parts", {
        it_ticket_id: t.id,
        name: part.name,
        quantity: int(part.quantity) ?? 1,
        photo_path: photo ? (await storeUpload(t.uuid, photo, "parts")).path : null,
        created_at: now,
        updated_at: now,
      });
    }
    for (const photo of filesOf(data.photos)) {
      await insert("it_ticket_attachments", { it_ticket_id: t.id, kind: "result", uploaded_by: u.id, ...(await storeUpload(t.uuid, photo, "result")), created_at: now, updated_at: now });
    }
    await log(t.id, u.id, "resulted");
  });
  await notify({ ...t, status: "pending_it_head" }, "resulted", u);
  await respondDetail(req, res, t.id);
});

/** IT บันทึกความคืบหน้าระหว่างดำเนินการ (ขึ้นไทม์ไลน์ + แจ้งผู้แจ้ง) — ไม่เปลี่ยนสถานะ */
ticketRoutes.post("/tickets/:uuid/progress", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canProgress(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });

  await transaction(async () => {
    await update("it_tickets", { updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "progress", String(data.comment));
  });
  await notify(t, "progress", u);
  await respondDetail(req, res, t.id);
});

/** 4.3.4 หัวหน้า IT อนุมัติผล (ลงลายเซ็น) → รอปิดงาน (ผู้แจ้งกดรับงานเพื่อปิดงาน) */
ticketRoutes.post("/tickets/:uuid/close", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canClose(u, t));
  const data = await validate(
    req.input,
    { comment: ["nullable", "string", "max:2000"], signature: ["required", "string", "max:500000"] },
    { locale: req.locale },
  );

  await transaction(async () => {
    const now = nowDb();
    await update(
      "it_tickets",
      {
        status: "pending_requester",
        it_head_id: u.id,
        it_head_signature: await storeSignature(t.uuid, String(data.signature), "it-head", req.locale),
        updated_at: now,
      },
      "id = ?",
      [t.id],
    );
    await log(t.id, u.id, "head_approved", (data.comment as string) ?? null);
  });
  await notify({ ...t, status: "pending_requester", it_head_id: u.id }, "head_approved", u);
  await respondDetail(req, res, t.id);
});

/** ผู้แจ้งกดรับงาน → ปิดงาน */
ticketRoutes.post("/tickets/:uuid/confirm-close", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canConfirmClose(u, t));
  const data = await validate(req.input, { comment: ["nullable", "string", "max:2000"] }, { locale: req.locale });

  await transaction(async () => {
    const now = nowDb();
    await update("it_tickets", { status: "completed", closed_at: now, updated_at: now }, "id = ?", [t.id]);
    await log(t.id, u.id, "confirmed", (data.comment as string) ?? null);
  });
  await notify({ ...t, status: "completed" }, "confirmed", u);
  await respondDetail(req, res, t.id);
});

/** หัวหน้า IT ส่งกลับให้เจ้าหน้าที่แก้ไขผล */
ticketRoutes.post("/tickets/:uuid/return", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canClose(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });

  await transaction(async () => {
    await update("it_tickets", { status: "in_progress", updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "returned", String(data.comment));
  });
  await notify({ ...t, status: "in_progress" }, "returned", u);
  await respondDetail(req, res, t.id);
});

/* ---------------------------------------------------------------- แก้ไข / ลบ / ยกเลิก (ผู้แจ้ง) */

/** แก้ไขใบแจ้งงาน — ผู้แจ้ง ก่อนมีผู้อนุมัติ (ไฟล์แนบ/ลายเซ็นไม่เปลี่ยน) */
async function updateTicket(req: Request, res: Response) {
  const t = await findTicket(String(req.params.uuid));
  const u = me(req);
  authorize(canEdit(u, t));
  const data = await validate(
    req.input,
    {
      type: ["required", `in:${TYPES.join(",")}`],
      type_other: ["required_if:type,other", "nullable", "string", "max:255"],
      branch_id: ["required", "integer", exists("branches", "id", "is_active = true AND deleted_at IS NULL")],
      department: ["nullable", "string", "max:100"],
      division: ["nullable", "string", "max:100"],
      details: ["required", "string", "max:5000"],
      due_date: ["nullable", "date", "after_or_equal:today"],
      assignee_id: ["required", "integer", exists("users", "id", IT_STAFF_WHERE)],
      approver_id: ["nullable", "integer"],
      person_name_th: ["required_if:type,grant_access,revoke_access", "nullable", "string", "max:255"],
      person_name_en: ["required_if:type,grant_access,revoke_access", "nullable", "string", "max:255"],
      device_name: ["required_if:type,repair", "nullable", "string", "max:255"],
      asset_tag: ["nullable", "string", "max:50"],
      symptom: ["required_if:type,repair", "nullable", "string", "max:5000"],
    },
    { locale: req.locale },
  );
  const chosen = await chosenApprover(req, data);
  const type = String(data.type);
  const values: Record<string, unknown> = {};
  for (const key of FILLABLE) values[key] = key in data ? data[key] : null;
  if (type !== "grant_access" && type !== "revoke_access") values.person_name_th = values.person_name_en = null;
  if (type !== "repair" && type !== "install") values.device_name = values.asset_tag = null;
  if (type !== "repair") values.symptom = null;
  if (type !== "other") values.type_other = null;
  if (values.due_date) values.due_date = String(values.due_date).slice(0, 10);
  for (const key of ["branch_id", "assignee_id"]) values[key] = int(values[key]);
  const assetId = values.asset_tag ? await scalar<number>("SELECT id FROM assets WHERE asset_tag = ? AND deleted_at IS NULL", [values.asset_tag]) : null;

  // เปลี่ยนผู้อนุมัติ (ยังไม่มีใครอนุมัติ — canEdit): แทนผู้อนุมัติของขั้นปัจจุบัน / ระบบเดิมแทน approver_id
  let approverChanged = false;
  await transaction(async () => {
    await update("it_tickets", { ...values, asset_id: assetId, updated_at: nowDb() }, "id = ?", [t.id]);
    if (chosen) {
      if (t.current_step !== null) {
        const step = await first<{ id: number; approver_ids: unknown }>(
          "SELECT id, approver_ids FROM it_ticket_approval_steps WHERE it_ticket_id = ? AND step_no = ?",
          [t.id, t.current_step],
        );
        const ids = typeof step?.approver_ids === "string" ? JSON.parse(step.approver_ids) : step?.approver_ids;
        approverChanged = Boolean(step) && JSON.stringify((ids as unknown[]).map(Number)) !== JSON.stringify([chosen.id]);
        if (step && approverChanged) await update("it_ticket_approval_steps", { approver_ids: JSON.stringify([chosen.id]), updated_at: nowDb() }, "id = ?", [step.id]);
      } else if (t.approver_id !== chosen.id) {
        approverChanged = true;
        await update("it_tickets", { approver_id: chosen.id }, "id = ?", [t.id]);
      }
    }
    await log(t.id, u.id, "edited");
  });
  // แจ้งผู้อนุมัติคนใหม่ (submitted = ส่งถึงผู้อนุมัติของขั้นปัจจุบัน)
  if (approverChanged) await notify((await loadTicket("t.id = ?", t.id))!, "submitted", u);
  await respondDetail(req, res, t.id);
}
ticketRoutes.put("/tickets/:uuid", updateTicket);
ticketRoutes.patch("/tickets/:uuid", updateTicket);

/** ลบใบแจ้งงาน — ผู้แจ้ง ก่อนมีผู้อนุมัติ หรือเมื่อถูกไม่อนุมัติ (ลบไฟล์ของใบงาน + บันทึก audit) */
ticketRoutes.delete("/tickets/:uuid", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canDelete(u, t));
  await transaction(async () => {
    // แจ้งเตือนที่อ้างถึงใบนี้ (ลิงก์จะเสีย)
    await exec("DELETE FROM notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.ticket_id')) = ?", [t.uuid]);
    await exec("DELETE FROM it_tickets WHERE id = ?", [t.id]);
  });
  await deleteTicketFiles(t.uuid);
  await audit(req, { action: "ticket.deleted", subjectType: "ticket", subjectId: t.uuid, before: { ticket_no: t.ticket_no, type: t.type, status: t.status } });
  res.status(204).end();
});

/** ขอยกเลิก (อนุมัติแล้ว) → status = pending_cancel แล้วแจ้งเจ้าหน้าที่ IT ผู้รับงานให้ยืนยัน */
ticketRoutes.post("/tickets/:uuid/cancel", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canRequestCancel(u, t));
  const data = await validate(req.input, { reason: ["required", "string", "max:2000"] }, { locale: req.locale });
  await transaction(async () => {
    await update(
      "it_tickets",
      { status: "pending_cancel", cancel_reason: String(data.reason), cancel_requested_at: nowDb(), cancel_requested_status: t.status, updated_at: nowDb() },
      "id = ?",
      [t.id],
    );
    await log(t.id, u.id, "cancel_requested", String(data.reason));
  });
  await notify({ ...t, status: "pending_cancel" }, "cancel_requested", u);
  await respondDetail(req, res, t.id);
});

/** เจ้าหน้าที่ IT ยืนยันการยกเลิก → cancelled */
ticketRoutes.post("/tickets/:uuid/cancel/confirm", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canDecideCancel(u, t));
  const data = await validate(req.input, { comment: ["nullable", "string", "max:2000"] }, { locale: req.locale });
  await transaction(async () => {
    await update("it_tickets", { status: "cancelled", cancelled_at: nowDb(), cancelled_by: u.id, closed_at: nowDb(), updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "cancelled", (data.comment as string) ?? null);
  });
  await notify({ ...t, status: "cancelled" }, "cancelled", u);
  await respondDetail(req, res, t.id);
});

/** เจ้าหน้าที่ IT ปฏิเสธการยกเลิก → กลับสถานะเดิม (ต้องระบุเหตุผล) */
ticketRoutes.post("/tickets/:uuid/cancel/reject", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canDecideCancel(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });
  const back = t.cancel_requested_status ?? "approved";
  await transaction(async () => {
    await update("it_tickets", { status: back, cancel_requested_status: null, updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "cancel_rejected", String(data.comment));
  });
  await notify({ ...t, status: back }, "cancel_rejected", u);
  await respondDetail(req, res, t.id);
});

/** ผู้แจ้งถอนคำขอยกเลิก → กลับสถานะเดิม */
ticketRoutes.post("/tickets/:uuid/cancel/withdraw", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canWithdrawCancel(u, t));
  const back = t.cancel_requested_status ?? "approved";
  await transaction(async () => {
    await update("it_tickets", { status: back, cancel_requested_status: null, updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "cancel_withdrawn");
  });
  await notify({ ...t, status: back }, "cancel_withdrawn", u);
  await respondDetail(req, res, t.id);
});

/* ---------------------------------------------------------------- ไฟล์ */

/** ไฟล์แนบ / รูปอะไหล่ / ลายเซ็น — ส่งผ่าน API เท่านั้น (ตรวจสิทธิ์ดูใบแจ้งงาน) */
async function sendFile(req: Request, res: Response) {
  const t = await findTicket(String(req.params.uuid));
  const u = me(req);
  authorize(canView(u, t));
  const id = req.params.id === undefined ? null : Number(req.params.id);

  let path: string | null = null;
  switch (req.params.kind) {
    case "attachment":
      path = id ? await scalar<string>("SELECT path FROM it_ticket_attachments WHERE it_ticket_id = ? AND id = ?", [t.id, id]) : null;
      break;
    case "part":
      path = id ? await scalar<string>("SELECT photo_path FROM it_ticket_parts WHERE it_ticket_id = ? AND id = ?", [t.id, id]) : null;
      break;
    case "requester-signature":
      path = t.requester_signature;
      // ใบงานเก่าที่ไม่มีสำเนา → ลายเซ็นปัจจุบันของผู้แจ้ง: เจ้าของ หรือผู้มีสิทธิ์ signature.use เท่านั้น (backend ส่งให้ ไม่มี URL ตรง)
      if (!path && (u.id === t.requester_id || can(u, "signature.use"))) {
        const row = await activeSignature(t.requester_id);
        const data = row ? await readSignature(row) : null;
        if (!row || !data) throw notFound();
        if (u.id !== t.requester_id) await audit(req, { action: "signature.used", subjectType: "user", subjectId: t.requester_id, after: { signature_id: row.id, ticket: t.uuid, view: true } });
        res.setHeader("Content-Type", mimeOf(row));
        res.setHeader("Cache-Control", "private, no-store");
        return res.send(data);
      }
      break;
    case "staff-signature":
      path = t.staff_signature;
      break;
    case "it-head-signature":
      path = t.it_head_signature;
      break;
  }
  if (!path) throw notFound();

  const file = await readStored(path);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
  res.send(file.data);
}

ticketRoutes.get("/tickets/:uuid/files/:kind", sendFile);
ticketRoutes.get("/tickets/:uuid/files/:kind/:id", (req, res) => {
  // {id} ต้องเป็นตัวเลข (whereNumber) — ไม่ใช่ = ไม่พบ route
  if (!/^\d+$/.test(req.params.id)) throw notFound();
  return sendFile(req, res);
});
