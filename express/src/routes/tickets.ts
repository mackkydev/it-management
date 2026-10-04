import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound } from "../lib/errors.js";
import { dateOnly, iso, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { exists, int, validate, type Rule } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { canAccessItData, isAdmin, type UserRow } from "../models/user.js";
import { person } from "../resources.js";
import { getSetting } from "../services/settings.js";
import { readStored, snapshotSignature, storeSignature, storeUpload } from "../services/ticket-files.js";
import {
  actionsFor, canAccept, canApprove, canClose, canRecordResult, canView, itStaff, notify, type TicketRow,
} from "../services/ticket-workflow.js";

/**
 * 4.2 / 4.3 ใบแจ้งดำเนินงาน IT — เหมือน TicketController ของ Laravel
 * ไฟล์ไม่ส่ง path จริง ส่งเป็น URL /tickets/{uuid}/files/... (ตรวจสิทธิ์ทุกครั้ง)
 */
export const ticketRoutes = Router();

const TYPES = ["repair", "install", "grant_access", "revoke_access", "other"];
const STATUSES = ["pending_supervisor", "approved", "in_progress", "pending_it_head", "completed", "rejected"];
const PHOTO_RULE: Rule[] = ["image", "mimes:jpg,jpeg,png,webp", "max:1024"]; // ≤ 1MB
const DOC_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"]; // ≤ 5MB
const FILLABLE = [
  "type", "type_other", "branch_id", "department", "division", "details", "due_date",
  "person_name_th", "person_name_en", "device_name", "asset_tag", "symptom", "assignee_id",
] as const;

async function findTicket(uuid: string): Promise<TicketRow> {
  if (!isUuid(uuid)) throw notFound();
  const t = await first<TicketRow>("SELECT * FROM it_tickets WHERE uuid = ?", [uuid]);
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

const SUMMARY_SELECT = `t.*, r.name AS r_name, asg.name AS as_name, b.id AS b_id, b.name AS b_name
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
  const requester = await first<{ id: number; name: string; email: string; signature_path: string | null }>(
    "SELECT id, name, email, signature_path FROM users WHERE id = ?",
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
    signatures: {
      // สำเนาตอนแจ้งงาน หรือลายเซ็นปัจจุบันในโปรไฟล์ผู้แจ้ง (แสตมป์ตอนดู/พิมพ์)
      requester: row.requester_signature || requester?.signature_path ? file("requester-signature") : null,
      staff: row.staff_signature ? file("staff-signature") : null,
      it_head: row.it_head_signature ? file("it-head-signature") : null,
    },
    attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.original_name, mime: a.mime, size: Number(a.size), url: file("attachment", a.id) })),
    parts: parts.map((p) => ({ id: p.id, name: p.name, quantity: Number(p.quantity), photo_url: p.photo_path ? file("part", p.id) : null })),
    events: events.map((e) => ({ id: e.id, action: e.action, comment: e.comment, user: person(e.u_id, e.u_name), created_at: iso(e.created_at) })),
  };
}

async function respondDetail(req: Request, res: Response, ticketId: number, status = 200) {
  const t = (await first<TicketRow>("SELECT * FROM it_tickets WHERE id = ?", [ticketId]))!;
  res.status(status).json({ data: await detail(t, me(req)) });
}

const log = (ticketId: number, userId: number | null, action: string, comment: string | null = null) =>
  insert("it_ticket_events", { it_ticket_id: ticketId, user_id: userId, action, comment, created_at: nowDb() });

/**
 * เลขที่ใบแจ้งงาน IT-YYYY-NNNNN — ต้องเรียกภายใน transaction
 * PostgreSQL ใช้ FOR UPDATE กับ MAX() ไม่ได้ จึงล็อกด้วย advisory lock (ปลดเองเมื่อจบ transaction) กันเลขซ้ำเมื่อแจ้งพร้อมกัน
 */
async function nextTicketNo(): Promise<string> {
  const prefix = `IT-${new Date().getUTCFullYear()}-`;
  await exec("SELECT pg_advisory_xact_lock(hashtext('it_tickets.ticket_no'))");
  const last = await scalar<string>("SELECT MAX(ticket_no) FROM it_tickets WHERE ticket_no LIKE ?", [`${prefix}%`]);
  const seq = last ? Number(last.slice(prefix.length)) + 1 : 1;
  return prefix + String(seq).padStart(5, "0");
}

/* ---------------------------------------------------------------- list / options */

/** เงื่อนไข "รออนุมัติของฉัน" — admin เห็นใบที่ไม่มีผู้อนุมัติด้วย */
const approvalsWhere = (u: UserRow) =>
  isAdmin(u) ? { sql: "t.status = 'pending_supervisor' AND (t.approver_id = ? OR t.approver_id IS NULL)", params: [u.id] }
    : { sql: "t.status = 'pending_supervisor' AND t.approver_id = ?", params: [u.id] };

async function counts(u: UserRow) {
  const count = async (sql: string, params: unknown[] = []) => Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${sql}`, params));
  const ap = approvalsWhere(u);
  const out: Record<string, number> = {
    mine_open: await count("t.requester_id = ? AND t.status NOT IN ('completed', 'rejected')", [u.id]),
    approvals: await count(ap.sql, ap.params),
  };
  if (canAccessItData(u)) {
    out.it_new = await count("t.status = 'approved'");
    out.it_in_progress = await count("t.status = 'in_progress'");
    out.it_review = await count("t.status = 'pending_it_head'");
  }
  return out;
}

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
  authorize(scope !== "it" || canAccessItData(u));

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (scope === "mine") (where.push("t.requester_id = ?"), params.push(u.id));
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
    where.push("(t.ticket_no ILIKE ? OR t.details ILIKE ? OR t.asset_tag ILIKE ? OR t.person_name_th ILIKE ?)");
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

/** ตัวเลือกของฟอร์มแจ้งงาน: สาขาที่เปิดใช้งาน, เจ้าหน้าที่ IT, ตัวเลือกเรื่อง "อื่นๆ" */
ticketRoutes.get("/tickets/form-options", async (_req, res) => {
  const branches = await select<{ id: number; code: string; name: string }>(
    "SELECT id, code, name FROM branches WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, name",
  );
  const staff = await itStaff();
  const otherTypes = await getSetting("ticket_other_types");
  res.json({
    data: {
      branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      it_staff: staff.map((s) => ({ id: s.id, name: s.name })),
      other_types: Array.isArray(otherTypes) ? otherTypes : Object.values(otherTypes ?? {}),
    },
  });
});

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
      assignee_id: ["nullable", "integer", exists("users", "id", "is_active = true AND (is_it_staff = true OR is_it_head = true)")],
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

  const ticketId = await transaction(async () => {
    const type = String(data.type);
    const values: Record<string, unknown> = {};
    for (const key of FILLABLE) if (key in data) values[key] = data[key];
    // เก็บเฉพาะฟิลด์ที่ตรงกับเรื่อง (กันข้อมูลค้างจากการเปลี่ยนเรื่องในฟอร์ม)
    if (type !== "grant_access" && type !== "revoke_access") values.person_name_th = values.person_name_en = null;
    if (type !== "repair") values.device_name = values.asset_tag = values.symptom = null;
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
      approver_id: u.supervisor_id, // หัวหน้าตามสายบังคับบัญชา (null = admin อนุมัติ)
      requested_at: now,
      created_at: now,
      updated_at: now,
    });

    // ลายเซ็นผู้แจ้ง: ส่งมาเป็นรูปวาด (แอป/ระบบเดิม) หรือคัดลอกลายเซ็นในโปรไฟล์ ณ ตอนแจ้ง
    const signature = data.signature
      ? await storeSignature(uuid, String(data.signature), "requester", req.locale)
      : u.signature_path
        ? await snapshotSignature(uuid, u.signature_path, "requester")
        : null;
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

  const ticket = (await first<TicketRow>("SELECT * FROM it_tickets WHERE id = ?", [ticketId]))!;
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

  await transaction(async () => {
    await update("it_tickets", { status: "approved", approver_id: u.id, approved_at: nowDb(), updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "approved", (data.comment as string) ?? null);
  });
  await notify({ ...t, status: "approved", approver_id: u.id }, "approved", u);
  await respondDetail(req, res, t.id);
});

ticketRoutes.post("/tickets/:uuid/reject", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canApprove(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });

  await transaction(async () => {
    const now = nowDb();
    await update("it_tickets", { status: "rejected", approver_id: u.id, approved_at: now, closed_at: now, updated_at: now }, "id = ?", [t.id]);
    await log(t.id, u.id, "rejected", String(data.comment));
  });
  await notify({ ...t, status: "rejected", approver_id: u.id }, "rejected", u);
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
      completed_on: ["required_if:result,completed", "nullable", "date", "before_or_equal:today"],
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

/** 4.3.4 หัวหน้า IT อนุมัติผล (ลงลายเซ็น) → ปิดงาน */
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
        status: "completed",
        it_head_id: u.id,
        it_head_signature: await storeSignature(t.uuid, String(data.signature), "it-head", req.locale),
        closed_at: now,
        updated_at: now,
      },
      "id = ?",
      [t.id],
    );
    await log(t.id, u.id, "closed", (data.comment as string) ?? null);
  });
  await notify({ ...t, status: "completed", it_head_id: u.id }, "closed", u);
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

/* ---------------------------------------------------------------- ไฟล์ */

/** ไฟล์แนบ / รูปอะไหล่ / ลายเซ็น — ส่งผ่าน API เท่านั้น (ตรวจสิทธิ์ดูใบแจ้งงาน) */
async function sendFile(req: Request, res: Response) {
  const t = await findTicket(String(req.params.uuid));
  authorize(canView(me(req), t));
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
      // ไม่มีสำเนาในใบงาน → ใช้ลายเซ็นปัจจุบันในโปรไฟล์ผู้แจ้ง
      path = t.requester_signature ?? (await scalar<string>("SELECT signature_path FROM users WHERE id = ?", [t.requester_id]));
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
