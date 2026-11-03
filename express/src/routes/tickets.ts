import { config } from "../config.js";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { exec, first, insert, isUuid, likeEscape, lockNamed, scalar, select, transaction, update } from "../db.js";
import { assetIdByNumber } from "../services/asset-repairs.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { dateOnly, iso, localToday, nowDb, toDbDateTime } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { exists, int, validate, type Rule } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { can, type UserRow, isReadOnly } from "../models/user.js";
import { person } from "../resources.js";
import { getSetting } from "../services/settings.js";
import { readStored, storeSignature, storeUpload, deleteTicketFiles } from "../services/ticket-files.js";
import { acceptors, canCloseResult, closersFor, isZoomTicket, actionsFor, canAccept, canForward, isTakeOver, closers, closersAmong, isSelfClose, withCloseInfo, canApprove, canClose, canConfirmClose, canProgress, canRecordResult, canView, IT_STAFF_WHERE, itStaff, notify, PRE_APPROVAL, TICKET_APPROVAL_COLUMNS, type TicketRow, canDecideCancel, canDelete, canEdit, canRequestCancel, canWithdrawCancel, canRequestApproval, isDirectToIt } from "../services/ticket-workflow.js";
import { activeSignature, copySignatureTo, mimeOf, readSignature, requireSignature, rememberDrawnSignature } from "../services/signatures.js";
import { audit } from "../services/audit.js";
import { scopeWhere } from "../services/manage-scope.js";
import { usersWithPermissions } from "../services/permissions.js";
import { markNoticesRead, notifyUsers, TICKET_ACTIVITY } from "../services/notifications.js";
import { busyOf, datesBetween } from "../services/calendar.js";
import { kpiPendingCount, MAX_WORK_SPAN_DAYS } from "../services/kpi.js";
import { missingAssetCount, OWN_SQL } from "./assets.js";
import { expiringContractCount } from "./it-data.js";
import { expiringLicenseCount } from "../services/licenses.js";
import { approverCandidates, planFor, snapshotPlan, ticketSteps, withChosenApprover } from "../services/approval-routes.js";
import { pendingVehicleBookings } from "./vehicles.js";
import { zoomBadges } from "./zoom.js";
import { loanBadges } from "./loans.js";
import {
  announceVpnRequest, applyVpnTicketOutcome, closeVpnRequest, isVpnRequestType, pendingVpnRequest, syncVpnRequest, vpnBadges, vpnOfTicket, VPN_REQUEST_TYPE,
  type VpnRequestInput,
} from "../services/vpn-loans.js";
import { trans } from "../lib/i18n.js";

/**
 * 4.2 / 4.3 ใบแจ้งดำเนินงาน IT — เหมือน TicketController ของ Laravel
 * ไฟล์ไม่ส่ง path จริง ส่งเป็น URL /tickets/{uuid}/files/... (ตรวจสิทธิ์ทุกครั้ง)
 */
export const ticketRoutes = Router();

const TYPES = ["repair", "install", "grant_access", "revoke_access", "other"];
const STATUSES = ["pending_supervisor", "approval_requested", "approved", "in_progress", "pending_it_head", "pending_requester", "completed", "rejected", "pending_cancel", "cancelled"];
const PHOTO_RULE: Rule[] = ["image", "mimes:jpg,jpeg,png,webp", "max:1024"]; // ≤ 1MB
const DOC_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"]; // ≤ 5MB
/** เอกสาร/รูปที่แนบกับรายการประวัติ (บันทึกผล / อัปเดตความคืบหน้า เช่น ใบเสนอราคา ใบ PO) — ไฟล์ละ ≤ 1MB สูงสุด 10 ไฟล์ */
const EVENT_FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png,webp", "max:1024"];
const EVENT_FILES_MAX = 10;
const FILLABLE = [
  "type", "type_other", "branch_id", "department", "division", "details", "due_date",
  "person_name_th", "person_name_en", "device_name", "asset_tag", "symptom", "assignee_id",
] as const;

/** ใบแจ้งงานปกติ — ใบงานของการจอง ZOOM รับงาน/ส่งลิงก์ที่หน้า ZOOM จึงไม่ขึ้นคิวงาน / ตัวเลขเมนูใบงาน ยกเว้นช่วงรอผู้จัดการ IT อนุมัติ (คิวงาน IT) */
const NOT_ZOOM = "t.source IS NULL";

/** โหลดใบแจ้งงาน + ข้อมูลขั้นอนุมัติที่กติกาสิทธิ์ใช้ (TICKET_APPROVAL_COLUMNS) */
const loadTicket = (where: string, param: unknown) =>
  first<TicketRow>(`SELECT t.*, ${TICKET_APPROVAL_COLUMNS} FROM it_tickets t WHERE ${where}`, [param]);

async function findTicket(uuid: string): Promise<TicketRow> {
  if (!isUuid(uuid)) throw notFound();
  const t = await loadTicket("t.uuid = ?", uuid);
  if (!t) throw notFound();
  // รออนุมัติผล: มีผู้อนุมัติผลที่ไม่ได้ทำงานใบนี้ไหม (canClose — ห้ามอนุมัติงานตัวเองถ้ามีคนอื่น)
  return withCloseInfo(t);
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

/** ช่องที่ค้นหาในรายการใบแจ้งงาน (ทุกข้อความในเอกสาร) */
const SEARCH_COLUMNS = [
  "t.ticket_no", "t.type_other", "t.details", "t.department", "t.division", "t.person_name_th", "t.person_name_en", "t.device_name", "t.asset_tag",
  "t.symptom", "t.repair_details", "t.cannot_reason", "t.external_vendor", "t.cancel_reason",
  "(SELECT u.name FROM users u WHERE u.id = t.requester_id)",
  "(SELECT u.name FROM users u WHERE u.id = t.assignee_id)",
  "(SELECT u.name FROM users u WHERE u.id = t.approver_id)",
  "(SELECT b.name FROM branches b WHERE b.id = t.branch_id)",
  "(SELECT GROUP_CONCAT(u.name) FROM it_ticket_helpers h JOIN users u ON u.id = h.user_id WHERE h.it_ticket_id = t.id)",
  "(SELECT GROUP_CONCAT(p.name) FROM it_ticket_parts p WHERE p.it_ticket_id = t.id)",
];
/** ชื่อเรื่อง (ไทย/อังกฤษ) — พิมพ์ "ซ่อม" / "ติดตั้ง" ก็ค้นหาเจอตามเรื่อง */
const TYPE_LABELS: Record<string, string[]> = {
  repair: ["ซ่อม", "repair"],
  install: ["ติดตั้ง", "install"],
  grant_access: ["เพิ่มสิทธิ์", "grant access"],
  revoke_access: ["ระงับสิทธิ์", "revoke access"],
  other: ["อื่นๆ", "other"],
};

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
  const attachments = await select<{ id: number; kind: string; original_name: string | null; mime: string | null; size: number; event_id: number | null }>(
    "SELECT id, kind, original_name, mime, size, event_id FROM it_ticket_attachments WHERE it_ticket_id = ? ORDER BY id",
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
    // independent_closer มาจาก withCloseInfo (row อ่านจากฐานใหม่ ไม่มีค่านี้)
    ...summary({ ...row, independent_closer: t.independent_closer }, viewer),
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
    work_start_on: dateOnly(row.work_start_on),
    work_skip_off_days: Boolean(row.work_skip_off_days),
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
    // ปิดงานอัตโนมัติเมื่อผู้แจ้งไม่กดรับงานเกิน days วัน (ตั้งค่าระบบ) — at = กำหนดปิดของใบที่รอผู้แจ้งรับงานอยู่
    auto_close: await autoCloseInfo(row),
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
      approver: row.approver_signature ? file("approver-signature") : null,
    },
    attachments: attachments.map((a) => ({
      id: a.id, kind: a.kind, name: a.original_name, mime: a.mime, size: Number(a.size), event_id: a.event_id === null ? null : Number(a.event_id), url: file("attachment", a.id),
    })),
    parts: parts.map((p) => ({ id: p.id, name: p.name, quantity: Number(p.quantity), photo_url: p.photo_path ? file("part", p.id) : null })),
    // ไฟล์ที่แนบกับรายการนั้น (บันทึกผล / อัปเดตความคืบหน้า) — กดดูย้อนหลังได้จากประวัติ
    events: events.map((e) => ({
      id: e.id, action: e.action, comment: e.comment, user: person(e.u_id, e.u_name), created_at: iso(e.created_at),
      attachments: attachments
        .filter((a) => a.event_id !== null && Number(a.event_id) === Number(e.id))
        .map((a) => ({ id: a.id, kind: a.kind, name: a.original_name, mime: a.mime, size: Number(a.size), url: file("attachment", a.id) })),
    })),
    // ช่วงวันไปทำงานหน้างาน (ปฏิทิน) — ผู้รับงานเพิ่ม/แก้ได้
    calendar_event: await onsiteOf(t.id),
    // ขอใช้งาน VPN: ช่วงวันที่ที่ขอ + สถานะการมอบบัญชี (ผู้ดูแลมอบที่หน้า จัดการ VPN)
    vpn_request: await vpnOfTicket(t.id),
    // ใบงานของการจอง ZOOM: จัดการที่หน้า ZOOM (อ่านอย่างเดียวในหน้านี้)
    zoom_booking_id: isZoomTicket(t) ? ((await first<{ uuid: string }>("SELECT uuid FROM zoom_bookings WHERE ticket_id = ?", [t.id]))?.uuid ?? null) : null,
    can_zoom_approve: isZoomTicket(t) && canCloseResult(viewer, t),
    can_edit_calendar: canEditOnsite(viewer, t),
    // ผู้ร่วมดำเนินการ — ผู้รับงานเลือกเพิ่มตอนรับงาน / แก้ภายหลัง (ตัวเลือก = เจ้าหน้าที่ IT)
    helpers: await helpersOf(t.id),
    can_edit_helpers: canEditOnsite(viewer, t),
    // ตอนรับงาน: ไม่รวมคนที่กำลังจะรับงาน / ภายหลัง: ไม่รวมผู้รับงาน
    helper_options: canAccept(viewer, t) ? await helperOptions(viewer.id) : canEditOnsite(viewer, t) ? await helperOptions(t.assignee_id) : [],
    // โอนงาน (ยังไม่รับ): เจ้าหน้าที่ IT คนอื่นที่ไม่ใช่ผู้ถูกเลือกตอนนี้ + วันนี้ลา/ออกหน้างาน
    forward_options: canForward(viewer, t) ? await helperOptions(t.assignee_id) : [],
    // รับงานแทนผู้ที่ผู้แจ้งเลือกไว้ (คิวงาน IT) — ชื่อผู้ถูกเลือกเดิม ให้ปุ่มแสดง "รับงานแทน …"
    take_over_from: canAccept(viewer, t) && isTakeOver(viewer, t) ? row.as_name : null,
  };
}

/* ---------------------------------------------------------------- ผู้ร่วมดำเนินการ */

const helpersOf = (ticketId: number) =>
  select<{ id: number; name: string }>(
    "SELECT u.id, u.name FROM it_ticket_helpers h JOIN users u ON u.id = h.user_id WHERE h.it_ticket_id = ? ORDER BY h.id",
    [ticketId],
  ).then((rows) => rows.map((r) => ({ id: Number(r.id), name: r.name })));

/** เจ้าหน้าที่ IT ที่เลือกเป็นผู้ร่วมได้ + วันนี้ลา/ออกหน้างาน */
async function helperOptions(excludeId: number | null) {
  const staff = (await itStaff()).filter((s) => Number(s.id) !== excludeId);
  const busy = await busyOf(staff.map((s) => Number(s.id)), localToday(), localToday());
  return staff.map((s) => ({ id: Number(s.id), name: s.name, busy: busy.get(Number(s.id))?.[0]?.kind ?? null }));
}

/** ตรวจ helper_ids (ไม่ส่งมา = undefined) — ต้องเป็นเจ้าหน้าที่ IT และไม่ใช่ผู้รับงานเอง */
async function helperInput(req: Request, assigneeId: number): Promise<number[] | undefined> {
  const raw = req.input.helper_ids;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : raw === null || raw === "" ? [] : [raw];
  const ids = [...new Set(list.map((v) => Number(v)))];
  const fail = () => {
    throw new ValidationError({ helper_ids: [trans(req.locale, "eam.ticket.helpers_invalid")] });
  };
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || ids.includes(assigneeId) || ids.length > 20) fail();
  if (ids.length) {
    const found = await select<{ id: number }>(`SELECT id FROM users WHERE id IN (?) AND ${IT_STAFF_WHERE}`, [ids]);
    if (found.length !== ids.length) fail();
  }
  return ids;
}

/** บันทึกรายชื่อผู้ร่วม (แทนที่ทั้งชุด) → คืนรายชื่อที่เพิ่มใหม่ */
async function saveHelpers(t: TicketRow, ids: number[], actorId: number): Promise<number[]> {
  const before = (await select<{ user_id: number }>("SELECT user_id FROM it_ticket_helpers WHERE it_ticket_id = ?", [t.id])).map((r) => Number(r.user_id));
  const added = ids.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !ids.includes(id));
  if (removed.length) await exec("DELETE FROM it_ticket_helpers WHERE it_ticket_id = ? AND user_id IN (?)", [t.id, removed]);
  const now = nowDb();
  for (const id of added) await insert("it_ticket_helpers", { it_ticket_id: t.id, user_id: id, added_by: actorId, created_at: now, updated_at: now });
  if (added.length || removed.length) {
    const names = (await select<{ name: string }>("SELECT name FROM users WHERE id IN (?) ORDER BY name", [ids.length ? ids : [0]])).map((r) => r.name);
    await update("it_tickets", { updated_at: now }, "id = ?", [t.id]);
    await log(t.id, actorId, "helpers_updated", names.join(", ") || null);
  }
  return added;
}

/** แจ้งเตือนผู้ที่ถูกเพิ่มเป็นผู้ร่วมดำเนินการ */
const notifyHelpers = (t: TicketRow, ids: number[], actor: UserRow) =>
  ids.length
    ? notifyUsers(ids, TICKET_ACTIVITY, { kind: "ticket", event: "helper_added", ticket_id: t.uuid, ticket_no: t.ticket_no, ticket_type: t.type, actor: actor.name })
    : Promise.resolve();

/* ---------------------------------------------------------------- ไปทำงานหน้างาน (ปฏิทิน) */

async function onsiteOf(ticketId: number) {
  const e = await first<{ id: number; start_on: string; end_on: string; note: string | null }>(
    "SELECT id, start_on, end_on, note FROM calendar_events WHERE ticket_id = ? AND type = 'onsite'",
    [ticketId],
  );
  return e ? { id: Number(e.id), start_on: dateOnly(e.start_on), end_on: dateOnly(e.end_on), note: e.note } : null;
}

/** ผู้รับงาน (หรือผู้จัดการงานแทนผู้อื่น) ระหว่างงานยังไม่ปิด */
const canEditOnsite = (u: UserRow, t: TicketRow) =>
  !isZoomTicket(t) &&
  t.assignee_id !== null && ["in_progress", "pending_it_head", "pending_requester", "pending_cancel"].includes(t.status) && (t.assignee_id === u.id || can(u, "it_tickets.manage_all"));

/** ตรวจ calendar { start_on, end_on, note } ของคำขอ — ไม่ส่งมา = null */
async function onsiteInput(req: Request): Promise<{ start_on: string; end_on: string; note: string | null } | null> {
  const raw = req.input.calendar;
  if (!raw || typeof raw !== "object") return null;
  const data = await validate(
    raw as Record<string, unknown>,
    { start_on: ["required", "date"], end_on: ["required", "date", "after_or_equal:start_on"], note: ["nullable", "string", "max:1000"] },
    { locale: req.locale },
  );
  return {
    start_on: String(data.start_on).slice(0, 10),
    end_on: String(data.end_on).slice(0, 10),
    note: typeof data.note === "string" && data.note.trim() ? data.note.trim() : null,
  };
}

async function saveOnsite(t: TicketRow, userId: number, actorId: number, v: { start_on: string; end_on: string; note: string | null }, locale: Request["locale"]) {
  const now = nowDb();
  const title = trans(locale, "eam.calendar.onsite_title", { no: t.ticket_no });
  const existing = await first<{ id: number }>("SELECT id FROM calendar_events WHERE ticket_id = ?", [t.id]);
  if (existing) await update("calendar_events", { ...v, user_id: userId, title, updated_at: now }, "id = ?", [existing.id]);
  else await insert("calendar_events", { type: "onsite", user_id: userId, ticket_id: t.id, title, ...v, created_by: actorId, created_at: now, updated_at: now });
}

async function respondDetail(req: Request, res: Response, ticketId: number, status = 200) {
  const t = await withCloseInfo((await loadTicket("t.id = ?", ticketId))!);
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
export const approvalsWhere = (u: UserRow) => {
  // อนุมัติแทน (approve_any): ใบที่ไม่มีหัวหน้า หรือหัวหน้าปิดใช้งาน — ตรงกับผู้รับแจ้งเตือนใน notify
  const legacy = can(u, "tickets.approve_any")
    ? "(t.approver_id = ? OR t.approver_id IS NULL OR NOT EXISTS (SELECT 1 FROM users a WHERE a.id = t.approver_id AND a.is_active = true))"
    : "t.approver_id = ?";
  return {
    sql: `t.status = 'pending_supervisor' AND (t.requester_id <> ? OR (t.current_step IS NULL AND t.approver_id = t.requester_id)) AND (
      (t.current_step IS NULL AND ${legacy})
      OR (t.current_step IS NOT NULL AND EXISTS (SELECT 1 FROM it_ticket_approval_steps s
            WHERE s.it_ticket_id = t.id AND s.step_no = t.current_step AND JSON_CONTAINS(s.approver_ids, ?))))`,
    params: [u.id, u.id, JSON.stringify([u.id])],
  };
};

/**
 * คิวงานของฉัน = เฉพาะใบที่ฉันเป็นผู้รับงาน (ผู้แจ้งเลือกไว้ / โอนมาให้ / รับแล้ว) — คิวงาน IT (scope it) = ทุกใบ
 * ใบที่คนอื่นรับแทนหรือโอนต่อแล้ว (assignee เปลี่ยน) หลุดจากคิวของคนเดิมทันที
 */
async function itMineWhere(u: UserRow): Promise<{ sql: string; params: unknown[] }> {
  // ผู้รับงาน + ผู้ร่วมดำเนินการ (it_ticket_helpers) — ผู้ร่วมเห็นใบงานในคิวงานของฉันด้วย
  return {
    sql: `t.status NOT IN (${PRE_APPROVAL.map((x) => `'${x}'`).join(", ")}) AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id AND h.user_id = ?))`,
    params: [u.id, u.id],
  };
}

async function counts(u: UserRow) {
  const count = async (sql: string, params: unknown[] = []) => Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${NOT_ZOOM} AND ${sql}`, params));
  const ap = approvalsWhere(u);
  const out: Record<string, number> = {
    mine_open: await count("t.requester_id = ? AND t.status NOT IN ('completed', 'rejected', 'cancelled')", [u.id]),
    approvals: await count(ap.sql, ap.params),
  };
  if (can(u, "it_tickets.queue")) {
    // คิวงานของฉัน (แท็บ) — เงื่อนไขเดียวกับ itMineWhere / ตัวเลขเมนู /it/tickets
    const mine = await itMineWhere(u);
    out.my_new = await count(`t.status = 'approved' AND ${mine.sql}`, mine.params);
    out.my_in_progress = await count(`t.status = 'in_progress' AND ${mine.sql}`, mine.params);
    out.my_review = await count(`t.status = 'pending_it_head' AND ${mine.sql}`, mine.params);
    out.my_cancel = await count(`t.status = 'pending_cancel' AND ${mine.sql}`, mine.params);
    out.it_new = await count("t.status = 'approved'");
    out.it_in_progress = await count("t.status = 'in_progress'");
    out.it_mine = await count("t.status = 'in_progress' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id AND h.user_id = ?))", [u.id, u.id]);
    // รออนุมัติผล: รวมใบงานของการจอง ZOOM (ผู้จัดการ IT อนุมัติที่หน้าใบงาน)
    out.it_review = Number(await scalar("SELECT COUNT(*) FROM it_tickets t WHERE t.status = 'pending_it_head'"));
    out.it_cancel = await count("t.status = 'pending_cancel'");
  }
  return out;
}

/**
 * GET /menu-badges — ตัวเลขบนเมนู = งานที่ "รอฉันทำ" (เงื่อนไขเดียวกับปุ่มใน ticket-workflow.ts)
 *   /tickets           ใบของฉันที่รอฉันกดรับงาน (รอปิดงาน)
 *   /tickets/approvals ใบที่รอฉันอนุมัติ
 *   /it/tickets        คิวงานของฉัน: ใบที่ฉันเป็นผู้รับงาน — รอรับงาน + กำลังทำ + รอยืนยันยกเลิก (เงื่อนไขเดียวกับ itMineWhere)
 *   /it/queue          คิวงาน IT: ใบที่ยังไม่มีผู้รับ (ถ้าเป็นเจ้าหน้าที่ IT ที่รับงานได้) + รอหัวหน้า IT อนุมัติผล (ถ้าเป็นหัวหน้า IT)
 *   /kpi               ใบงานของฉันที่ผู้จัดการ IT อนุมัติผลแล้วแต่ยังไม่กรอก Complexity ใน KPI (KPI_TICKET_STATUSES)
 *                      — ใบงานหลายวันนับตามวันที่ยังไม่กรอก (kpiPendingCount)
 *   /vehicles/dispatch การจองรถที่ยังไม่ระบุรถ (ผู้จัดคิวรถ)
 *   /loans/mine, /loans/manage  ยืมอุปกรณ์ IT (routes/loans.ts loanBadges)
 *   /zoom/manage       คำขอจอง ZOOM รอรับงาน + งานที่ฉันรับแล้วยังไม่ส่งลิงก์ (zoom.manage — routes/zoom.ts zoomBadges)
 *   /assets            สินทรัพย์ที่ต้องเพิ่ม: เลขทรัพย์สินจากใบแจ้งซ่อมที่ไม่พบในระบบ (assets.create — missingAssetCount)
 *   /licenses          ซอฟต์แวร์ License กำลังจะหมดอายุ ที่ยังไม่ต่อสัญญา/ยกเลิก (assets.update — expiringLicenseCount)
 *   /contracts         สัญญา vendor ใกล้หมดอายุ (contracts.update — expiringContractCount)
 * หน้าที่มีแท็บแสดงตัวเลขเดียวกันบนแท็บนั้น (กฎ: เมนูที่มีแจ้งเตือน = ตัวเลขที่เมนู + ที่แท็บ)
 */
ticketRoutes.get("/menu-badges", async (req, res) => {
  const u = me(req);
  // ผู้ตรวจสอบไม่มีงานรอทำ
  if (isReadOnly(u)) return void res.json({ data: {} });
  const count = async (sql: string, params: unknown[] = []) => Number(await scalar(`SELECT COUNT(*) FROM it_tickets t WHERE ${NOT_ZOOM} AND ${sql}`, params));
  const ap = approvalsWhere(u);
  const data: Record<string, number> = {
    "/tickets": await count("t.status = 'pending_requester' AND t.requester_id = ?", [u.id]),
    "/tickets/approvals": await count(ap.sql, ap.params),
  };
  if (can(u, "it_tickets.queue")) {
    // เฉพาะผู้ที่เกี่ยวข้องโดยตรง = คนเดียวกับผู้รับแจ้งเตือนใน notify (ผู้รับงาน / acceptors / closers)
    //   คิวงานของฉัน = ใบที่ฉันเป็นผู้รับงาน, คิวงาน IT = ใบที่ยังไม่มีผู้รับ (เจ้าหน้าที่ IT ที่รับงานได้) + รออนุมัติผล (หัวหน้า IT)
    const [direct, heads, reviewers] = await Promise.all([acceptors(), closers(), usersWithPermissions(["it_tickets.queue", "it_tickets.close"])]);
    // + ใบที่ฉันเป็นผู้ร่วมดำเนินการที่ยังทำอยู่
    // UNION แทน OR + EXISTS — แต่ละส่วนใช้ index ของตัวเอง (assignee_id + status / it_ticket_helpers.user_id) ไม่ต้องสแกนใบที่กำลังทำทั้งหมด
    data["/it/tickets"] = Number(
      await scalar(
        `SELECT COUNT(*) FROM (
           SELECT t.id FROM it_tickets t WHERE t.assignee_id = ? AND t.status IN ('approved', 'in_progress', 'pending_cancel') AND ${NOT_ZOOM}
           UNION
           SELECT t.id FROM it_ticket_helpers h JOIN it_tickets t ON t.id = h.it_ticket_id WHERE h.user_id = ? AND t.status = 'in_progress' AND ${NOT_ZOOM}
         ) x`,
        [u.id, u.id],
      ),
    );
    // รออนุมัติผล: นับใบที่ฉันเป็นผู้อนุมัติผล (ไม่นับงานที่ตัวเองทำ ยกเว้นไม่มีคนอื่น) — เงื่อนไขเดียวกับแจ้งเตือน resulted (closersFor)
    let review = 0;
    if (reviewers.some((x) => x.id === u.id)) {
      const pending = await select<TicketRow>(`SELECT t.*, ${TICKET_APPROVAL_COLUMNS} FROM it_tickets t WHERE t.status = 'pending_it_head'`);
      review = pending.filter((t) => closersAmong(t, heads, reviewers).some((x) => x.id === u.id)).length;
    }
    // รอรับงาน: ใบที่ยังไม่มีผู้รับ + ใบที่ผู้แจ้งเลือกเจ้าหน้าที่คนอื่นไว้แต่ยังไม่รับ (เฉพาะผู้ที่รับงานแทนได้ — it_tickets.take_over)
    //   ผู้ถูกเลือกเห็นใบนั้นที่ "คิวงานของฉัน" อย่างเดียว (ไม่นับซ้ำที่คิวงาน IT) — ตัวเลขเมนูเท่านั้น ไม่แจ้งเตือนที่กระดิ่ง
    const canTakeOver = can(u, "it_tickets.take_over") || can(u, "it_tickets.manage_all");
    const waiting = direct.some((x) => x.id === u.id)
      ? await count(
          `((t.status IN ('approved', 'pending_cancel') AND t.assignee_id IS NULL)${canTakeOver ? " OR (t.status = 'approved' AND t.assignee_id <> ?)" : ""})`,
          canTakeOver ? [u.id] : [],
        )
      : 0;
    data["/it/queue"] = waiting + review;
  }
  if (can(u, "kpi.use")) {
    // แถวใบงานที่ยังไม่กรอก Complexity — ใบงานหลายวันนับตามวัน (เงื่อนไขเดียวกับชีต)
    data["/kpi"] = await kpiPendingCount(u.id);
  }
  // ใบลาที่รอฉันอนุมัติ
  // ผู้อนุมัติที่ระบุ (= ผู้รับแจ้งเตือน) — approve_any นับเพิ่มเฉพาะใบที่ผู้อนุมัติไม่มี/ปิดใช้งาน ในขอบเขตสาขาของกลุ่ม (หน้ารออนุมัติยังแสดงทุกใบในขอบเขต)
  const leaveAny = await scopeWhere(u, "leave.approve_any", "o.branch_id");
  data["/leave/approvals"] = Number(
    await scalar(
      `SELECT COUNT(*) FROM leave_requests l JOIN users o ON o.id = l.user_id WHERE l.status = 'pending' AND l.user_id <> ? AND (l.approver_id = ?${
        can(u, "leave.approve_any") ? ` OR ((l.approver_id IS NULL OR NOT EXISTS (SELECT 1 FROM users a WHERE a.id = l.approver_id AND a.is_active = true)) AND ${leaveAny.sql})` : ""
      })`,
      [u.id, u.id, ...(can(u, "leave.approve_any") ? leaveAny.params : [])],
    ),
  );
  // การจองรถที่ยังไม่ระบุรถ (ผู้จัดคิวรถ) — ผู้รับแจ้งเตือน "รอจัดรถ" = ผู้มีสิทธิ์ vehicle.dispatch เหมือนกัน
  if (can(u, "vehicle.dispatch")) data["/vehicles/dispatch"] = await pendingVehicleBookings(u);
  // ยืมอุปกรณ์ IT: ของฉันที่เกินกำหนดคืน / ผู้จัดการ: รอส่งมอบที่ถึงวันแล้ว + เกินกำหนดคืน
  Object.assign(data, await loanBadges(u));
  Object.assign(data, await zoomBadges(u));
  // VPN รวมกับตัวเลขเดิมของ /loans/mine
  for (const [k, n] of Object.entries(await vpnBadges(u))) data[k] = Number(data[k] ?? 0) + n;
  if (can(u, "assets.create")) data["/assets"] = await missingAssetCount(u);
  if (can(u, "assets.update")) data["/licenses"] = await expiringLicenseCount();
  if (can(u, "contracts.update")) data["/contracts"] = await expiringContractCount(u);
  res.json({ data });
});

/** ผู้รับงานแก้รายชื่อผู้ร่วมดำเนินการภายหลัง (ระหว่างงานยังไม่ปิด) — แจ้งเตือนเฉพาะคนที่เพิ่มใหม่ */
ticketRoutes.put("/tickets/:uuid/helpers", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canEditOnsite(u, t));
  req.input.helper_ids = req.input.helper_ids ?? [];
  const ids = (await helperInput(req, Number(t.assignee_id)))!;
  let added: number[] = [];
  await transaction(async () => {
    added = await saveHelpers(t, ids, u.id);
  });
  await notifyHelpers(t, added, u);
  await respondDetail(req, res, t.id);
});

/** PUT /tickets/{uuid}/calendar { start_on, end_on, note } — เพิ่ม/แก้ช่วงวันไปทำงานหน้างาน, DELETE = เอาออกจากปฏิทิน */
ticketRoutes.put("/tickets/:uuid/calendar", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canEditOnsite(u, t));
  req.input.calendar = req.input.calendar ?? Object.fromEntries(["start_on", "end_on", "note"].filter((k) => req.input[k] !== undefined).map((k) => [k, req.input[k]]));
  const v = await onsiteInput(req);
  if (!v) throw notFound();
  await saveOnsite(t, t.assignee_id!, u.id, v, req.locale);
  await log(t.id, u.id, "calendar_updated", `${v.start_on} – ${v.end_on}`);
  await respondDetail(req, res, t.id);
});

ticketRoutes.delete("/tickets/:uuid/calendar", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canEditOnsite(u, t));
  await exec("DELETE FROM calendar_events WHERE ticket_id = ?", [t.id]);
  await log(t.id, u.id, "calendar_removed");
  await respondDetail(req, res, t.id);
});

/**
 * GET /tickets?scope=mine|approvals|it|it_mine|all&status=&type=&assigned=me&search=&from=&to=&staff_id=
 *   all = เมนู "ใบแจ้งงานทั้งหมด" (it_tickets.queue — ผู้ดูแลระบบ / เจ้าหน้าที่ IT): ใบหลังอนุมัติ (it_tickets.manage_all = ทุกใบ)
 *   from / to = ช่วงวันที่แจ้ง (เวลาไทย), staff_id = เจ้าหน้าที่ IT (ผู้รับงาน หรือผู้ร่วมดำเนินการ)
 */
ticketRoutes.get("/tickets", async (req, res) => {
  const u = me(req);
  const f = await validate(
    req.input,
    {
      scope: ["nullable", "in:mine,approvals,it,it_mine,all"],
      from: ["nullable", "date"],
      to: ["nullable", "date"],
      staff_id: ["nullable", "integer"],
      status: ["nullable", `in:${STATUSES.join(",")}`],
      type: ["nullable", `in:${TYPES.join(",")}`],
      assigned: ["nullable", "in:me"],
      search: ["nullable", "string", "max:100"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const scope = (f.scope as string | null) ?? "mine";
  authorize((scope !== "it" && scope !== "it_mine" && scope !== "all") || can(u, "it_tickets.queue"));

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (scope === "mine") (where.push("t.requester_id = ?"), params.push(u.id));
  // ใบงานของการจอง ZOOM ทำที่หน้า ZOOM — คิวงาน IT แสดงเฉพาะช่วงรอผู้จัดการ IT อนุมัติ
  if (scope === "it") where.push(`(${NOT_ZOOM} OR t.status = 'pending_it_head')`);
  if (scope === "it_mine") where.push(NOT_ZOOM);
  // คิวงาน IT: เฉพาะใบที่หัวหน้าอนุมัติแล้ว
  if (scope === "it" || (scope === "all" && !can(u, "it_tickets.manage_all"))) where.push(`t.status NOT IN (${PRE_APPROVAL.map((s) => `'${s}'`).join(", ")})`);
  // ช่วงวันที่แจ้ง (เวลาไทย — requested_at เก็บ UTC): แปลงขอบวันเป็น UTC แทนการแปลงคอลัมน์ → ใช้ index it_tickets_requested_at_index ได้
  const tz = `'${localOffset()}'`;
  if (f.from) (where.push(`t.requested_at >= CONVERT_TZ(CAST(? AS DATETIME), ${tz}, '+00:00')`), params.push(String(f.from).slice(0, 10)));
  if (f.to) (where.push(`t.requested_at < CONVERT_TZ(CAST(? AS DATETIME) + INTERVAL 1 DAY, ${tz}, '+00:00')`), params.push(String(f.to).slice(0, 10)));
  if (f.staff_id) {
    where.push("(t.assignee_id = ? OR EXISTS (SELECT 1 FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id AND h.user_id = ?))");
    params.push(int(f.staff_id), int(f.staff_id));
  }
  // คิวงานของฉัน: เฉพาะใบที่เป็นของฉัน (ผู้รับงาน / ผู้ร่วม / รอรับที่ยังไม่มีผู้รับ / รออนุมัติผลของหัวหน้า IT)
  if (scope === "it_mine") {
    const mine = await itMineWhere(u);
    where.push(mine.sql);
    params.push(...mine.params);
  }
  if (scope === "approvals") {
    const ap = approvalsWhere(u);
    where.push(ap.sql);
    params.push(...ap.params);
  }
  if (f.assigned === "me") {
    // ผู้รับงาน หรือผู้ร่วมดำเนินการ
    where.push("(t.assignee_id = ? OR EXISTS (SELECT 1 FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id AND h.user_id = ?))");
    params.push(u.id, u.id);
  }
  if (f.status) (where.push("t.status = ?"), params.push(f.status));
  if (f.type) (where.push("t.type = ?"), params.push(f.type));
  // ค้นหา: แยกคำด้วยช่องว่าง — ทุกคำต้องพบที่ใดที่หนึ่งในเอกสาร (ข้อความทุกช่องของใบงาน + ชื่อผู้แจ้ง/ผู้รับงาน/ผู้ร่วม/สาขา + ชื่อเรื่อง)
  const terms = String(f.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const raw of terms) {
    const like = `%${likeEscape(raw)}%`;
    const types = TYPES.filter((ty) => TYPE_LABELS[ty].some((l) => l.toLowerCase().includes(raw.toLowerCase())));
    where.push(`(${SEARCH_COLUMNS.map((c) => `${c} LIKE ?`).join(" OR ")}${types.length ? " OR t.type IN (?)" : ""})`);
    params.push(...SEARCH_COLUMNS.map(() => like), ...(types.length ? [types] : []));
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
  const busyToday = await busyOf(staff.map((s) => Number(s.id)), localToday(), localToday());
  res.json({
    data: {
      branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      departments,
      divisions,
      approvers: approvers.map((a) => ({ id: a.id, name: a.name, branch_id: Number(a.branch_id), role: a.role })),
      // ขั้นตอนใบแจ้งงาน — it_first = ช่องผู้อนุมัติปิดไว้ ("ไม่ต้องอนุมัติ") จนกว่า IT จะขอให้หัวหน้าอนุมัติ
      approval_flow: await ticketFlow(),
      // วันนี้ลา / ออกหน้างาน — เตือนตอนผู้แจ้งเลือกเจ้าหน้าที่
      it_staff: staff.map((s) => ({ id: s.id, name: s.name, busy: busyToday.get(Number(s.id))?.[0]?.kind ?? null })),
      // "ขอใช้งาน VPN" อยู่ในรายการเสมอ (เลือกแล้วฟอร์มถามช่วงวันที่ใช้) — ผู้ดูแลไม่ต้องเพิ่มเอง
      other_types: withVpnType(Array.isArray(otherTypes) ? otherTypes : Object.values(otherTypes ?? {})),
      vpn_type: VPN_REQUEST_TYPE,
      my_assets: assets.map((a) => ({ id: a.uuid, asset_tag: a.asset_tag, name: a.name, brand: a.brand, model: a.model, category: a.category })),
    },
  });
});

const withVpnType = (types: unknown[]) => [
  VPN_REQUEST_TYPE,
  ...types.map(String).filter((x) => x.trim().toLowerCase() !== VPN_REQUEST_TYPE.toLowerCase()),
];

const VPN_MAX_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ใบแจ้งงาน "อื่นๆ → ขอใช้งาน VPN": ต้องมีวันเริ่มต้น / สิ้นสุด (vpn_start_on, vpn_end_on)
 * วันสิ้นสุดไม่ก่อนวันเริ่ม / วันนี้ และไม่เกิน 366 วันนับจากวันเริ่ม — เรื่องอื่น = ไม่ใช่คำขอ VPN
 */
function vpnRequestInput(req: Request, data: Record<string, unknown>): VpnRequestInput {
  const purpose = String(data.details ?? "").trim();
  if (!isVpnRequestType(data.type, data.type_other)) return { vpn: false, from: null, until: null, purpose };
  const date = (k: string) => (typeof data[k] === "string" && DATE_RE.test(String(data[k]).slice(0, 10)) ? String(data[k]).slice(0, 10) : null);
  const from = date("vpn_start_on");
  const until = date("vpn_end_on");
  const missing: Record<string, string> = {};
  if (!from) missing.vpn_start_on = trans(req.locale, "eam.vpn.request_dates");
  if (!until) missing.vpn_end_on = trans(req.locale, "eam.vpn.request_dates");
  if (Object.keys(missing).length) throw ValidationError.withMessages(missing);
  const limit = new Date(Date.parse(`${from}T00:00:00Z`) + VPN_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (until! < from! || until! < localToday() || until! > limit) {
    throw ValidationError.withMessages({ vpn_end_on: trans(req.locale, "eam.vpn.request_range", { days: VPN_MAX_DAYS }) });
  }
  return { vpn: true, from, until, purpose };
}

/** บันทึกคำขอ VPN ของใบงาน (ใน transaction) — มีคำขอที่รออยู่แล้ว = 422 */
async function saveVpnRequest(req: Request, ticketId: number, requester: UserRow, input: VpnRequestInput) {
  if (!(await syncVpnRequest(ticketId, requester, input))) {
    throw ValidationError.withMessages({ type_other: trans(req.locale, "eam.vpn.already_requested") });
  }
}

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
      // อื่นๆ → ขอใช้งาน VPN: ช่วงวันที่ใช้ (ตรวจใน vpnRequestInput)
      vpn_start_on: ["nullable", "string", "max:10"],
      vpn_end_on: ["nullable", "string", "max:10"],
      photos: ["nullable", "array", "max:4"],
      "photos.*": PHOTO_RULE,
      documents: ["nullable", "array", "max:5"],
      "documents.*": DOC_RULE,
      // ไม่บังคับแล้ว — ปกติใช้ลายเซ็นที่อัปโหลดไว้ในโปรไฟล์
      signature: ["nullable", "string", "max:500000"],
    },
    { locale: req.locale },
  );

  // บังคับลายเซ็น (สวิตช์ตั้งค่าระบบ): เซ็นมาในคำขอ หรือมีลายเซ็นในโปรไฟล์ (คัดลอกเป็นลายเซ็นผู้แจ้ง)
  if (!data.signature) await requireSignature(u.id, req.locale);
  // ขั้นตอน it_first: ส่งถึงฝ่าย IT ทันที (ไม่ผ่านการอนุมัติ — ผู้อนุมัติที่ส่งมาไม่นับ) แล้ว IT ขอให้หัวหน้าอนุมัติเมื่อจำเป็น
  const itFirst = (await ticketFlow()) === "it_first";
  if (itFirst) delete data.approver_id;
  const chosen = await chosenApprover(req, data);
  const vpnInput = vpnRequestInput(req, data);
  // ผู้มีสิทธิ์อนุมัติใบของตัวเอง (ผู้จัดการขึ้นไป) ไม่เลือกผู้อนุมัติ = อนุมัติเอง (ไม่ใช้สายอนุมัติ/หัวหน้า) — แจ้งเตือน + "รอฉันอนุมัติ" ของตัวเอง
  const selfApprove = !itFirst && !chosen && can(u, "tickets.approve_own");
  const routePlan = itFirst
    ? { source: "legacy" as const, route: null, steps: [], legacy_approver: null }
    : selfApprove ? { source: "legacy" as const, route: null, steps: [], legacy_approver: { id: u.id, name: u.name } } : await planFor(u);
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
    // ผูกสินทรัพย์: ตรงรหัสสินทรัพย์ / เลขที่ทรัพย์สิน / เลขที่ทรัพย์สิน (เดิม)
    const assetId = await assetIdByNumber(values.asset_tag);

    const uuid = randomUUID();
    const now = nowDb();
    const id = await insert("it_tickets", {
      ...values,
      uuid,
      asset_id: assetId,
      ticket_no: await nextTicketNo(),
      status: itFirst ? "approved" : "pending_supervisor",
      requester_id: u.id,
      // ระบบเดิม: หัวหน้าตามสายบังคับบัญชา (null = admin อนุมัติ) — สายอนุมัติ: ใส่ผู้อนุมัติขั้นสุดท้ายตอนอนุมัติครบ — it_first: ยังไม่มีผู้อนุมัติ
      approver_id: itFirst ? null : plan.source === "legacy" ? (chosen?.id ?? (selfApprove ? u.id : u.supervisor_id)) : null,
      requested_at: now,
      created_at: now,
      updated_at: now,
    });
    const firstStep = itFirst ? null : await snapshotPlan(id, plan);
    if (firstStep !== null) await update("it_tickets", { current_step: firstStep }, "id = ?", [id]);
    if (vpnInput.vpn) await saveVpnRequest(req, id, u, vpnInput);

    // ลายเซ็นผู้แจ้ง: ส่งมาเป็นรูปวาด (แอป/ระบบเดิม) หรือคัดลอกลายเซ็นในโปรไฟล์ ณ ตอนแจ้ง
    const signature = data.signature
      ? await storeSignature(uuid, String(data.signature), "requester", req.locale)
      : await copySignatureTo(u.id, `tickets/${uuid}/signatures`, "requester", req, { ticket: uuid });
    if (signature) await update("it_tickets", { requester_signature: signature, updated_at: nowDb() }, "id = ?", [id]);
    // วาดลายเซ็นในฟอร์มแจ้งงาน (ยังไม่มีในโปรไฟล์ + เปิดบังคับลายเซ็น) → เก็บเป็นลายเซ็นในโปรไฟล์ไว้ใช้ครั้งต่อไป
    if (data.signature) await rememberDrawnSignature(u.id, data.signature, req);
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
  if (itFirst) {
    // ถึงฝ่าย IT ทันที — แจ้งผู้รับงาน (หรือผู้รับงานได้ทั้งหมด) + ผู้ดูแล VPN (คำขอ VPN)
    await notify(ticket, "submitted_it", u);
    await announceVpnRequest(ticket.id, ticket.assignee_id);
  } else await notify(ticket, "submitted", u);
  await respondDetail(req, res, ticketId, 201);
});

/**
 * ใบแจ้งงานที่ระบบสร้างแทนผู้ใช้ (เช่น ขอต่ออายุ / ยกเลิก VPN) — ไม่ต้องผ่านหัวหน้า: อนุมัติแล้ว เข้าคิวงาน IT ทันที
 * เรื่อง = อื่นๆ (type_other) · ผู้รับงาน = ระบุ (ต้องยังเป็นเจ้าหน้าที่ IT) หรือว่าง = รอรับงานในคิว
 * ลายเซ็นผู้แจ้ง = สำเนาลายเซ็นในโปรไฟล์ (ถ้ามี) — เรียกใน transaction ของผู้เรียกได้ (nested)
 */
export async function createSystemTicket(
  req: Request,
  requester: UserRow,
  opts: { typeOther: string; details: string; assigneeId: number | null; comment: string },
): Promise<{ id: number; uuid: string; ticket_no: string }> {
  const assigneeId = opts.assigneeId && (await first(`SELECT 1 AS x FROM users WHERE id = ? AND ${IT_STAFF_WHERE}`, [opts.assigneeId])) ? opts.assigneeId : null;
  const created = await transaction(async () => {
    const uuid = randomUUID();
    const now = nowDb();
    const ticketNo = await nextTicketNo();
    const id = await insert("it_tickets", {
      uuid,
      ticket_no: ticketNo,
      type: "other",
      type_other: opts.typeOther.slice(0, 255),
      status: "approved",
      requester_id: requester.id,
      branch_id: requester.branch_id,
      department: requester.department,
      division: requester.division,
      details: opts.details.slice(0, 5000),
      assignee_id: assigneeId,
      requested_at: now,
      approved_at: now,
      created_at: now,
      updated_at: now,
    });
    const signature = await copySignatureTo(requester.id, `tickets/${uuid}/signatures`, "requester", req, { ticket: uuid });
    if (signature) await update("it_tickets", { requester_signature: signature }, "id = ?", [id]);
    await log(id, requester.id, "submitted");
    await log(id, null, "approved", opts.comment);
    return { id, uuid, ticket_no: ticketNo };
  });
  // แจ้งผู้รับงาน (หรือผู้รับงานได้ทั้งหมด) ว่ามีงานรอในคิว
  await notify((await loadTicket("t.id = ?", created.id))!, "approved", requester);
  return created;
}

/* ---------------------------------------------------------------- ใบงานของการจอง ZOOM (routes/zoom.ts — เรียกภายใน transaction ได้, ไม่แจ้งเตือนฝั่งใบงาน) */

/** จอง ZOOM = เปิดใบงานเรื่องอื่นๆ รอรับงาน — ลายเซ็นผู้แจ้ง = สำเนาลายเซ็นในโปรไฟล์ (ถ้ามี) */
export async function createZoomTicket(req: Request, requesterId: number, opts: { typeOther: string; details: string; requestedAt: string }): Promise<number> {
  return transaction(async () => {
    const requester = await first<{ branch_id: number | null; department: string | null; division: string | null }>("SELECT branch_id, department, division FROM users WHERE id = ?", [requesterId]);
    const uuid = randomUUID();
    const now = nowDb();
    const id = await insert("it_tickets", {
      uuid,
      ticket_no: await nextTicketNo(),
      type: "other",
      type_other: opts.typeOther.slice(0, 255),
      status: "approved",
      source: "zoom",
      requester_id: requesterId,
      branch_id: requester?.branch_id ?? null,
      department: requester?.department ?? null,
      division: requester?.division ?? null,
      details: opts.details.slice(0, 5000),
      requested_at: opts.requestedAt,
      approved_at: opts.requestedAt,
      created_at: now,
      updated_at: now,
    });
    const signature = await copySignatureTo(requesterId, `tickets/${uuid}/signatures`, "requester", req, { ticket: uuid });
    if (signature) await update("it_tickets", { requester_signature: signature }, "id = ?", [id]);
    await insert("it_ticket_events", { it_ticket_id: id, user_id: requesterId, action: "submitted", comment: null, created_at: opts.requestedAt });
    return id;
  });
}

/** แก้หัวข้อ / วันเวลาของการจอง → รายละเอียดในใบงานตาม + บันทึกประวัติ (ไม่ส่ง comment = ไม่ลงประวัติ) */
export async function zoomTicketDetails(id: number, userId: number | null, details: string, comment: string | null) {
  await update("it_tickets", { details: details.slice(0, 5000), updated_at: nowDb() }, "id = ?", [id]);
  if (comment) await log(id, userId, "progress", comment);
}

export const zoomTicketLog = async (id: number, userId: number | null, comment: string) => {
  await update("it_tickets", { updated_at: nowDb() }, "id = ?", [id]);
  await log(id, userId, "progress", comment);
};

export async function zoomTicketAccepted(id: number, assigneeId: number, acceptedAt: string) {
  await update("it_tickets", { status: "in_progress", assignee_id: assigneeId, accepted_at: acceptedAt, updated_at: nowDb() }, "id = ? AND status = 'approved'", [id]);
  await insert("it_ticket_events", { it_ticket_id: id, user_id: assigneeId, action: "accepted", comment: null, created_at: acceptedAt });
}

/** ส่งลิงก์ครั้งแรก = บันทึกผลสำเร็จ → รอผู้จัดการ IT อนุมัติผล (ลายเซ็นผู้รับงาน = สำเนาลายเซ็นในโปรไฟล์ ถ้ามี) */
export async function zoomTicketResulted(req: Request, id: number, assigneeId: number, solution: string, comment: string) {
  const t = (await loadTicket("t.id = ?", id))!;
  const now = nowDb();
  const signature = await copySignatureTo(assigneeId, `tickets/${t.uuid}/signatures`, "staff", req, { ticket: t.uuid });
  await update(
    "it_tickets",
    { status: "pending_it_head", result: "completed", completed_on: localToday(), repair_details: solution.slice(0, 5000), resulted_at: now, updated_at: now, ...(signature ? { staff_signature: signature } : {}) },
    "id = ?",
    [id],
  );
  await log(id, assigneeId, "resulted", comment);
}

/** แก้ลิงก์หลังส่งแล้ว = ผลในใบงานตาม */
export const zoomTicketSolution = (id: number, solution: string) => update("it_tickets", { repair_details: solution.slice(0, 5000), updated_at: nowDb() }, "id = ?", [id]);

/**
 * ผู้จัดการ IT อนุมัติผลจากหน้า ZOOM = ประทับชื่อ + สำเนาลายเซ็นในโปรไฟล์ → รอผู้จองกดรับ (ขึ้น KPI ของผู้รับงาน)
 * กติกาเดียวกับ /tickets/:uuid/close (canCloseResult) — ไม่มีลายเซ็นในโปรไฟล์ = 422
 */
export async function zoomTicketApprove(req: Request, id: number, u: UserRow) {
  const t = await withCloseInfo((await loadTicket("t.id = ?", id))!);
  authorize(canCloseResult(u, t));
  const signature = await copySignatureTo(u.id, `tickets/${t.uuid}/signatures`, "it-head", req, { ticket: t.uuid });
  if (!signature) throw ValidationError.withMessages({ signature: trans(req.locale, "eam.zoom.signature_required") });
  const selfClose = isSelfClose(u, t);
  await transaction(async () => {
    await update("it_tickets", { status: "pending_requester", it_head_id: u.id, it_head_signature: signature, updated_at: nowDb() }, "id = ? AND status = 'pending_it_head'", [id]);
    await log(id, u.id, "head_approved", selfClose ? trans(req.locale, "eam.ticket.self_closed") : null);
  });
  if (selfClose) await audit(req, { action: "ticket.self_closed", subjectType: "ticket", subjectId: t.uuid, after: { ticket_no: t.ticket_no } });
}

/** ผู้จองกดรับ = ปิดงาน */
export async function zoomTicketConfirm(id: number, userId: number) {
  const now = nowDb();
  await update("it_tickets", { status: "completed", closed_at: now, updated_at: now }, "id = ? AND status = 'pending_requester'", [id]);
  await log(id, userId, "confirmed");
}

/** ยกเลิกการจอง = ใบงานยกเลิก ไม่นับ KPI (KPI_TICKET_STATUSES) — ทุกสถานะ รวมใบที่ปิดไปแล้ว */
export async function zoomTicketCancel(id: number, userId: number | null, comment: string | null) {
  const now = nowDb();
  await update("it_tickets", { status: "cancelled", cancelled_at: now, cancelled_by: userId, closed_at: now, updated_at: now }, "id = ?", [id]);
  await log(id, userId, "cancelled", comment);
}

/** ผู้รับแจ้งเตือน "รออนุมัติผล" ของใบนี้ — เงื่อนไขเดียวกับใบงานปกติ (closersFor) */
export const zoomTicketClosers = async (id: number) => closersFor((await loadTicket("t.id = ?", id))!);

ticketRoutes.get("/tickets/:uuid", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  authorize(canView(me(req), t));
  // เปิดดูใบนี้แล้ว = แจ้งเตือนของใบนี้ในกระดิ่ง (ของผู้ดู) อ่านแล้ว
  await markNoticesRead("ticket_id", t.uuid, { userId: me(req).id });
  await respondDetail(req, res, t.id);
});

/* ---------------------------------------------------------------- ขั้นตอนอนุมัติ / ดำเนินงาน */

ticketRoutes.post("/tickets/:uuid/approve", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canApprove(u, t));
  const data = await validate(req.input, { comment: ["nullable", "string", "max:2000"] }, { locale: req.locale });
  await requireSignature(u.id, req.locale);

  // อนุมัติใบของตัวเอง (tickets.approve_own) — บันทึกในไทม์ไลน์ให้ตรวจย้อนหลังได้
  const own = u.id === t.requester_id ? trans(req.locale, "eam.ticket.self_approved") : null;
  const comment = [own, (data.comment as string) ?? null].filter(Boolean).join(" — ") || null;

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
      // ลายเซ็นผู้อนุมัติ = สำเนาลายเซ็นในโปรไฟล์ ณ ตอนอนุมัติ (แบบฟอร์มพิมพ์ ช่องผู้อนุมัติ)
      const approverSignature = await copySignatureTo(u.id, `tickets/${t.uuid}/signatures`, "approver", req, { ticket: t.uuid });
      await update("it_tickets", { status: "approved", approver_id: u.id, approved_at: now, current_step: null, approver_signature: approverSignature, updated_at: now }, "id = ?", [t.id]);
      await log(t.id, u.id, "approved", comment);
    }
  });
  if (next) await notify((await loadTicket("t.id = ?", t.id))!, "step_approved", u);
  else {
    await notify({ ...t, status: "approved", approver_id: u.id, current_step: null }, "approved", u);
    await announceVpnRequest(t.id, t.assignee_id);
  }
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
    await closeVpnRequest(t.id, "rejected", u, String(data.comment));
  });
  await notify({ ...t, status: "rejected", approver_id: u.id, current_step: null }, "rejected", u);
  await respondDetail(req, res, t.id);
});

/** ขั้นตอนใบแจ้งงาน (ตั้งค่าระบบ ticket_flow) */
const ticketFlow = async (): Promise<"approval_first" | "it_first"> => ((await getSetting("ticket_flow")) === "it_first" ? "it_first" : "approval_first");

/**
 * ฝ่าย IT ขอให้หัวหน้าอนุมัติ { comment } (ใบที่ส่งถึง IT ทันที — canRequestApproval) → approval_requested
 * ผู้แจ้งกด "เพิ่มผู้อนุมัติ" (หน้าแก้ไข) เลือกผู้อนุมัติแล้วบันทึก → รอหัวหน้าอนุมัติ → อนุมัติแล้วกลับมาที่ฝ่าย IT (ผู้รับงานเดิม)
 */
ticketRoutes.post("/tickets/:uuid/request-approval", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canRequestApproval(u, t));
  const data = await validate(req.input, { comment: ["required", "string", "max:2000"] }, { locale: req.locale });
  await transaction(async () => {
    await update("it_tickets", { status: "approval_requested", accepted_at: null, updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "approval_requested", String(data.comment));
  });
  await notify({ ...t, status: "approval_requested" }, "approval_requested", u);
  await respondDetail(req, res, t.id);
});

ticketRoutes.post("/tickets/:uuid/accept", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canAccept(u, t));
  // ติ๊ก "บันทึกลงปฏิทิน" = ช่วงวันไปทำงานหน้างาน
  const onsite = await onsiteInput(req);
  // ผู้ร่วมดำเนินการ (ทำงานมากกว่า 1 คน) — ได้แถว KPI ของใบนี้ด้วย
  const helperIds = await helperInput(req, u.id);

  // รับแทนผู้ที่ผู้แจ้งเลือกไว้ (คิวงาน IT) — บันทึกชื่อผู้ถูกเลือกเดิมไว้ในไทม์ไลน์
  const original = isTakeOver(u, t) ? await scalar<string>("SELECT name FROM users WHERE id = ?", [t.assignee_id]) : null;
  let added: number[] = [];
  await transaction(async () => {
    await update("it_tickets", { status: "in_progress", assignee_id: u.id, accepted_at: nowDb(), updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "accepted", original ? trans(req.locale, "eam.ticket.took_over_from", { name: original }) : null);
    if (onsite) await saveOnsite(t, u.id, u.id, onsite, req.locale);
    // ผู้รับงานต้องไม่ซ้ำกับผู้ร่วมเดิม (เช่น ผู้จัดการรับงานแทน)
    await exec("DELETE FROM it_ticket_helpers WHERE it_ticket_id = ? AND user_id = ?", [t.id, u.id]);
    if (helperIds) added = await saveHelpers(t, helperIds, u.id);
  });
  await notify({ ...t, status: "in_progress", assignee_id: u.id }, "accepted", u);
  await notifyHelpers(t, added, u);
  await respondDetail(req, res, t.id);
});

/**
 * โอนงาน (ยังไม่รับ) ให้เจ้าหน้าที่ IT คนอื่น — ผู้แจ้งเลือกคนไม่ตรงงาน { assignee_id, comment? }
 * ผู้รับเดิมหลุดจากใบนี้ทันที (แจ้งเตือน "รอรับงาน" ของเดิมอ่านแล้ว) → แจ้งผู้รับคนใหม่ + ผู้แจ้ง
 */
ticketRoutes.post("/tickets/:uuid/forward", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canForward(u, t));
  const data = await validate(
    req.input,
    { assignee_id: ["required", "integer", exists("users", "id", IT_STAFF_WHERE)], comment: ["nullable", "string", "max:2000"] },
    { locale: req.locale },
  );
  const to = int(data.assignee_id)!;
  if (to === t.assignee_id) throw ValidationError.withMessages({ assignee_id: trans(req.locale, "eam.ticket.forward_same") });
  const name = (await scalar<string>("SELECT name FROM users WHERE id = ?", [to])) ?? "";
  const comment = typeof data.comment === "string" && data.comment.trim() ? data.comment.trim() : null;
  await transaction(async () => {
    await update("it_tickets", { assignee_id: to, updated_at: nowDb() }, "id = ?", [t.id]);
    await log(t.id, u.id, "forwarded", comment ? `${name} — ${comment}` : name);
  });
  await notify({ ...t, assignee_id: to }, "forwarded", u);
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
      // งานหลายวัน (เช่น ออกแบบ / ออกหน้างานต่างจังหวัด): วันเริ่มปฏิบัติงาน → KPI แยกแถวรายวันถึงวันที่แล้วเสร็จ
      work_start_on: ["nullable", "date"],
      work_skip_off_days: ["nullable", "boolean"],
      // ทำไม่ได้: ระบุสาเหตุ หรือติ๊ก "ผู้แจ้งงานยกเลิก" (สาเหตุ = ข้อความนั้น) — ข้อมูลการซ่อม/อะไหล่/รูปหลังซ่อมไม่ใช้
      requester_cancelled: ["nullable", "boolean"],
      cannot_reason: ["nullable", "string", "max:2000"],
      repair_method: [repair ? "required_if:result,completed" : "nullable", "nullable", "in:in_house,external"],
      external_vendor: ["nullable", "string", "max:255"],
      warranty: [repair ? "required_if:result,completed" : "nullable", "nullable", "in:in_warranty,out_of_warranty"],
      repair_details: ["nullable", "string", "max:5000"],
      photos: ["nullable", "array", "max:4"],
      "photos.*": PHOTO_RULE,
      parts: ["nullable", "array", "max:10"],
      "parts.*.name": ["required", "string", "max:255"],
      "parts.*.quantity": ["nullable", "integer", "min:1", "max:999"],
      "parts.*.photo": ["nullable", ...PHOTO_RULE],
      signature: ["required", "string", "max:500000"],
      documents: ["nullable", "array", `max:${EVENT_FILES_MAX}`],
      "documents.*": EVENT_FILE_RULE,
    },
    { locale: req.locale },
  );

  const done = data.result === "completed";
  const truthy = (v: unknown) => ["1", "true", "on", 1, true].includes(v as string);
  const requesterCancelled = !done && truthy(data.requester_cancelled);
  const cannotReason = done ? null : requesterCancelled ? trans(req.locale, "eam.ticket.requester_cancelled") : String(data.cannot_reason ?? "").trim();
  if (!done && !cannotReason) {
    throw ValidationError.withMessages({ cannot_reason: trans(req.locale, "eam.ticket.cannot_reason_required") });
  }
  if (done && repair && data.repair_method === "external" && !String(data.external_vendor ?? "").trim()) {
    throw ValidationError.withMessages({ external_vendor: trans(req.locale, "eam.ticket.vendor_required") });
  }

  const completedOn = data.result === "completed" && data.completed_on ? String(data.completed_on).slice(0, 10) : null;
  const workStart = completedOn && data.work_start_on ? String(data.work_start_on).slice(0, 10) : null;
  if (workStart && completedOn) {
    if (workStart > completedOn) throw ValidationError.withMessages({ work_start_on: trans(req.locale, "eam.kpi.work_start_after") });
    if (datesBetween(workStart, completedOn).length > MAX_WORK_SPAN_DAYS) {
      throw ValidationError.withMessages({ work_start_on: trans(req.locale, "eam.kpi.work_span_too_long", { days: MAX_WORK_SPAN_DAYS }) });
    }
  }

  // ขอใช้งาน VPN: ต้องมอบบัญชีก่อนบันทึกผลสำเร็จ (หน้า จัดการ VPN)
  if (data.result === "completed" && (await pendingVpnRequest(t.id))) {
    throw ValidationError.withMessages({ result: trans(req.locale, "eam.vpn.assign_first") });
  }
  await transaction(async () => {
    const now = nowDb();
    const completed = data.result === "completed";
    await update(
      "it_tickets",
      {
        result: data.result,
        completed_on: completedOn,
        // วันเดียวกับวันที่แล้วเสร็จ = ใบงานวันเดียว (ไม่เก็บ)
        work_start_on: workStart && workStart < completedOn! ? workStart : null,
        work_skip_off_days: data.work_skip_off_days === undefined || data.work_skip_off_days === null ? true : ["1", "true", "on", 1, true].includes(data.work_skip_off_days as string),
        cannot_reason: cannotReason,
        repair_method: repair && completed ? data.repair_method : null,
        external_vendor: repair && completed && data.repair_method === "external" ? data.external_vendor : null,
        warranty: repair && completed ? data.warranty : null,
        repair_details: completed ? (data.repair_details ?? null) : null,
        staff_signature: (await rememberDrawnSignature(u.id, data.signature, req), await storeSignature(t.uuid, String(data.signature), "staff", req.locale)),
        resulted_at: now,
        status: "pending_it_head",
        updated_at: now,
      },
      "id = ?",
      [t.id],
    );

    // บันทึกใหม่ทับรายการอะไหล่เดิม (กรณีถูกส่งกลับแก้ไข)
    await exec("DELETE FROM it_ticket_parts WHERE it_ticket_id = ?", [t.id]);
    for (const part of completed ? Object.values((data.parts ?? {}) as Record<string, Record<string, unknown>>) : []) {
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
    const eventId = await log(t.id, u.id, "resulted", completed ? null : cannotReason);
    // รูปหลังซ่อม (เฉพาะทำสำเร็จ) + เอกสารประกอบ — ผูกกับรายการ "บันทึกผล" ในประวัติ
    for (const photo of completed ? filesOf(data.photos) : []) {
      await insert("it_ticket_attachments", { it_ticket_id: t.id, kind: "result", event_id: eventId, uploaded_by: u.id, ...(await storeUpload(t.uuid, photo, "result")), created_at: now, updated_at: now });
    }
    // ผู้แจ้งงานยกเลิก = ไม่รับเอกสารประกอบ (ฟอร์มซ่อนช่องนี้)
    for (const doc of requesterCancelled ? [] : filesOf(data.documents)) {
      await insert("it_ticket_attachments", { it_ticket_id: t.id, kind: "result_document", event_id: eventId, uploaded_by: u.id, ...(await storeUpload(t.uuid, doc, "result")), created_at: now, updated_at: now });
    }
    // ใบงานจากคำขอ VPN: ทำสำเร็จ = ต่ออายุ / เลิกใช้ตามที่ผู้ใช้เลือก, ทำไม่ได้ = กลับเป็นใช้งานอยู่
    await applyVpnTicketOutcome(t.id, completed ? "completed" : "not_done", u);
    if (!completed) await closeVpnRequest(t.id, "rejected", u, cannotReason || null);
  });
  await notify({ ...t, status: "pending_it_head" }, "resulted", u);
  await respondDetail(req, res, t.id);
});

/** IT บันทึกความคืบหน้าระหว่างดำเนินการ (ขึ้นไทม์ไลน์ + แจ้งผู้แจ้ง) — ไม่เปลี่ยนสถานะ */
ticketRoutes.post("/tickets/:uuid/progress", async (req, res) => {
  const t = await findTicket(req.params.uuid);
  const u = me(req);
  authorize(canProgress(u, t));
  const data = await validate(
    req.input,
    { comment: ["required", "string", "max:2000"], files: ["nullable", "array", `max:${EVENT_FILES_MAX}`], "files.*": EVENT_FILE_RULE },
    { locale: req.locale },
  );

  await transaction(async () => {
    const now = nowDb();
    await update("it_tickets", { updated_at: now }, "id = ?", [t.id]);
    const eventId = await log(t.id, u.id, "progress", String(data.comment));
    // ไฟล์/รูปประกอบ (เช่น ใบเสนอราคา ใบ PO ฉบับปรับปรุง) — ผูกกับรายการนี้ในประวัติ
    for (const doc of filesOf(data.files)) {
      await insert("it_ticket_attachments", { it_ticket_id: t.id, kind: "progress", event_id: eventId, uploaded_by: u.id, ...(await storeUpload(t.uuid, doc, "progress")), created_at: now, updated_at: now });
    }
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
  // ไม่มีผู้อนุมัติผลคนอื่น → อนุมัติผลงานที่ตัวเองร่วมทำได้ แต่บันทึกไว้ในไทม์ไลน์ + audit
  const selfClose = isSelfClose(u, t);
  const comment = [selfClose ? trans(req.locale, "eam.ticket.self_closed") : null, (data.comment as string) ?? null].filter(Boolean).join(" — ") || null;

  await transaction(async () => {
    const now = nowDb();
    await update(
      "it_tickets",
      {
        status: "pending_requester",
        it_head_id: u.id,
        it_head_signature: (await rememberDrawnSignature(u.id, data.signature, req), await storeSignature(t.uuid, String(data.signature), "it-head", req.locale)),
        updated_at: now,
      },
      "id = ?",
      [t.id],
    );
    await log(t.id, u.id, "head_approved", comment);
  });
  if (selfClose) await audit(req, { action: "ticket.self_closed", subjectType: "ticket", subjectId: t.uuid, after: { ticket_no: t.ticket_no } });
  await notify({ ...t, status: "pending_requester", it_head_id: u.id }, "head_approved", u);
  await respondDetail(req, res, t.id);
});

/** offset ของเวลาท้องถิ่นแบบ "+07:00" (ใช้กับ CONVERT_TZ — ไม่ต้องมีตาราง time zone ใน MySQL) */
function localOffset(): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: config.localTimezone }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const mins = Math.round((local.getTime() - utc.getTime()) / 60_000);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- ปิดงานอัตโนมัติ */

const autoCloseDays = async () => Math.max(0, Number(await getSetting("ticket_auto_close_days")) || 0);

/** วันเวลาที่เข้าสถานะรอผู้แจ้งรับงาน (หัวหน้า IT อนุมัติผลครั้งล่าสุด) */
const AWAITING_SINCE = "(SELECT MAX(e.created_at) FROM it_ticket_events e WHERE e.it_ticket_id = t.id AND e.action = 'head_approved')";

async function autoCloseInfo(row: { id: number; status: string }): Promise<{ days: number; at: string | null }> {
  const days = await autoCloseDays();
  if (!days || row.status !== "pending_requester") return { days, at: null };
  const since = await scalar<string | null>(`SELECT ${AWAITING_SINCE} FROM it_tickets t WHERE t.id = ?`, [row.id]);
  return { days, at: since ? iso(toDbDateTime(new Date(new Date(`${String(since).replace(" ", "T")}Z`).getTime() + days * 86_400_000))) : null };
}

/**
 * scheduler (ทุกชั่วโมง): ใบที่รอผู้แจ้งรับงานเกิน ticket_auto_close_days วัน → ปิดงาน (completed) แทนผู้แจ้ง
 * ไทม์ไลน์ auto_closed + แจ้งเตือน closed ถึงผู้แจ้ง / ผู้รับงาน / ผู้ร่วมดำเนินการ — คืนจำนวนใบที่ปิด
 */
export async function autoCloseTickets(): Promise<number> {
  const days = await autoCloseDays();
  if (!days) return 0;
  const due = await select<{ id: number }>(
    `SELECT t.id FROM it_tickets t WHERE t.status = 'pending_requester' AND ${AWAITING_SINCE} <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
    [days],
  );
  let closed = 0;
  for (const { id } of due) {
    const t = await loadTicket("t.id = ?", id);
    if (!t || t.status !== "pending_requester") continue;
    await transaction(async () => {
      const now = nowDb();
      await update("it_tickets", { status: "completed", closed_at: now, updated_at: now }, "id = ? AND status = 'pending_requester'", [t.id]);
      await log(t.id, null, "auto_closed", trans("th", "eam.ticket.auto_closed", { days }));
    });
    await notify({ ...t, status: "completed" }, "closed", null);
    closed++;
  }
  return closed;
}

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
      // อื่นๆ → ขอใช้งาน VPN: ช่วงวันที่ใช้ (ตรวจใน vpnRequestInput)
      vpn_start_on: ["nullable", "string", "max:10"],
      vpn_end_on: ["nullable", "string", "max:10"],
    },
    { locale: req.locale },
  );
  // ส่งถึง IT ทันที (ยังไม่มีคนรับ) = ไม่มีผู้อนุมัติให้เปลี่ยน
  if (isDirectToIt(t)) delete data.approver_id;
  const chosen = await chosenApprover(req, data);
  // IT ขอให้หัวหน้าอนุมัติ: ต้องเลือกผู้อนุมัติ (ผู้มีสิทธิ์อนุมัติใบตัวเอง ไม่เลือก = อนุมัติเอง)
  const choosing = t.status === "approval_requested";
  if (choosing && !chosen && !can(u, "tickets.approve_own")) {
    throw ValidationError.withMessages({ approver_id: trans(req.locale, "eam.ticket.approver_required") });
  }
  const vpnInput = vpnRequestInput(req, data);
  const type = String(data.type);
  const values: Record<string, unknown> = {};
  for (const key of FILLABLE) values[key] = key in data ? data[key] : null;
  if (type !== "grant_access" && type !== "revoke_access") values.person_name_th = values.person_name_en = null;
  if (type !== "repair" && type !== "install") values.device_name = values.asset_tag = null;
  if (type !== "repair") values.symptom = null;
  if (type !== "other") values.type_other = null;
  if (values.due_date) values.due_date = String(values.due_date).slice(0, 10);
  for (const key of ["branch_id", "assignee_id"]) values[key] = int(values[key]);
  // เลขเดิม + ผูกสินทรัพย์ไว้แล้ว = คงการผูกเดิม (IT อาจผูกเองเพราะเลขที่พิมพ์ไม่ตรงเครื่อง)
  const sameNumber = String(values.asset_tag ?? "").trim() === String(t.asset_tag ?? "").trim();
  const assetId = sameNumber && t.asset_id ? t.asset_id : await assetIdByNumber(values.asset_tag);

  // เปลี่ยนผู้อนุมัติ (ยังไม่มีใครอนุมัติ — canEdit): แทนผู้อนุมัติของขั้นปัจจุบัน / ระบบเดิมแทน approver_id
  let approverChanged = false;
  await transaction(async () => {
    await update("it_tickets", { ...values, asset_id: assetId, updated_at: nowDb() }, "id = ?", [t.id]);
    // เปลี่ยนเป็น/ออกจากเรื่องขอใช้งาน VPN หรือแก้ช่วงวันที่ → ปรับคำขอ VPN ของใบนี้
    await saveVpnRequest(req, t.id, u, vpnInput);
    if (choosing) {
      // เลือกผู้อนุมัติตามที่ IT ขอ → รอหัวหน้าอนุมัติ (อนุมัติแล้วกลับไปที่ฝ่าย IT)
      approverChanged = true;
      await update("it_tickets", { status: "pending_supervisor", approver_id: chosen?.id ?? u.id, current_step: null, approved_at: null }, "id = ?", [t.id]);
      await log(t.id, u.id, "approval_submitted");
    } else if (chosen) {
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
    } else if (t.status === "pending_supervisor" && "approver_id" in data && t.current_step === null && t.approver_id !== u.id && can(u, "tickets.approve_own")) {
      // ไม่เลือกผู้อนุมัติ (ผู้จัดการขึ้นไป) = อนุมัติเอง
      approverChanged = true;
      await update("it_tickets", { approver_id: u.id }, "id = ?", [t.id]);
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
    await exec("DELETE FROM notifications WHERE subject_ref = ? AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.ticket_id')) = ?", [t.uuid, t.uuid]);
    await closeVpnRequest(t.id, "cancelled", u, t.ticket_no);
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
    await applyVpnTicketOutcome(t.id, "not_done", u);
    await closeVpnRequest(t.id, "cancelled", u, (data.comment as string) ?? null);
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
    case "approver-signature":
      path = t.approver_signature ?? null;
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
