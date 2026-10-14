import { first, select } from "../db.js";
import { can, type UserRow } from "../models/user.js";
import { markNoticesRead, notifyUsers, TICKET_ACTIVITY } from "./notifications.js";
import { usersWithPermissions } from "./permissions.js";

/** กติกาของขั้นตอนใบแจ้งงาน (ใครทำอะไรได้ในสถานะไหน) + ผู้รับแจ้งเตือน — เหมือน App\Services\TicketWorkflow */

export interface TicketRow {
  id: number;
  uuid: string;
  ticket_no: string;
  type: string;
  type_other: string | null;
  status: string;
  requester_id: number;
  branch_id: number | null;
  department: string | null;
  division: string | null;
  details: string;
  due_date: string | null;
  requester_signature: string | null;
  requested_at: string;
  person_name_th: string | null;
  person_name_en: string | null;
  device_name: string | null;
  asset_tag: string | null;
  asset_id: number | null;
  symptom: string | null;
  approver_id: number | null;
  approved_at: string | null;
  assignee_id: number | null;
  accepted_at: string | null;
  result: string | null;
  completed_on: string | null;
  cannot_reason: string | null;
  repair_method: string | null;
  external_vendor: string | null;
  warranty: string | null;
  repair_details: string | null;
  staff_signature: string | null;
  resulted_at: string | null;
  it_head_id: number | null;
  it_head_signature: string | null;
  closed_at: string | null;
  /** ขั้นอนุมัติปัจจุบันของสายอนุมัติ (null = ระบบเดิม หรืออนุมัติครบแล้ว) */
  current_step: number | null;
  /** ผู้อนุมัติของขั้นปัจจุบัน — มาจาก TICKET_APPROVAL_COLUMNS */
  step_approver_ids?: number[] | null;
  /** ผู้อนุมัติทุกขั้นของใบนี้ (ใช้ตรวจสิทธิ์ดู) — มาจาก TICKET_APPROVAL_COLUMNS */
  approval_user_ids?: number[] | null;
  /** ผู้ร่วมดำเนินการ (it_ticket_helpers) — มาจาก TICKET_APPROVAL_COLUMNS */
  helper_ids?: number[] | null;
  /** จำนวนขั้นที่อนุมัติไปแล้ว — มาจาก TICKET_APPROVAL_COLUMNS (> 0 = แก้ไข/ลบไม่ได้แล้ว) */
  approved_steps?: number | string | null;
  /** ขอยกเลิกหลังอนุมัติ */
  cancel_reason: string | null;
  cancel_requested_at: string | null;
  cancel_requested_status: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
}

/** คอลัมน์เพิ่มเติมของ it_tickets t สำหรับกติกาสายอนุมัติ — ใส่ใน SELECT ทุกที่ที่โหลด TicketRow */
export const TICKET_APPROVAL_COLUMNS = `(SELECT s.approver_ids FROM it_ticket_approval_steps s WHERE s.it_ticket_id = t.id AND s.step_no = t.current_step) AS step_approver_ids,
  (SELECT JSON_ARRAYAGG(x.v) FROM it_ticket_approval_steps s, JSON_TABLE(s.approver_ids, '$[*]' COLUMNS (v BIGINT PATH '$')) AS x WHERE s.it_ticket_id = t.id) AS approval_user_ids,
  (SELECT COUNT(*) FROM it_ticket_approval_steps s WHERE s.it_ticket_id = t.id AND s.status = 'approved') AS approved_steps,
  (SELECT JSON_ARRAYAGG(h.user_id) FROM it_ticket_helpers h WHERE h.it_ticket_id = t.id) AS helper_ids`;

/** สถานะที่ผู้แจ้งขอยกเลิกได้ (อนุมัติแล้วแต่ยังไม่เสร็จ) */
export const CANCELLABLE = ["approved", "in_progress", "pending_it_head"];

/** สถานะก่อนหัวหน้าอนุมัติ (รออนุมัติ / ไม่อนุมัติ) — ฝ่าย IT ยังไม่เห็นใบงาน */
export const PRE_APPROVAL = ["pending_supervisor", "rejected"];

/**
 * ผู้แจ้ง / ผู้อนุมัติ (ทุกขั้น) / ผู้มีสิทธิ์ tickets.view_all เห็นเสมอ
 * ผู้มีสิทธิ์คิวงาน IT และเจ้าหน้าที่ที่ผู้แจ้งเลือกไว้ เห็นได้หลังหัวหน้าอนุมัติแล้วเท่านั้น
 */
export const canView = (u: UserRow, t: TicketRow) =>
  can(u, "tickets.view_all") ||
  [t.requester_id, t.approver_id, t.it_head_id].includes(u.id) ||
  (t.approval_user_ids ?? []).map(Number).includes(u.id) ||
  (!PRE_APPROVAL.includes(t.status) && (can(u, "it_tickets.queue") || u.id === t.assignee_id || (t.helper_ids ?? []).map(Number).includes(u.id)));

/**
 * สายอนุมัติ: ผู้อนุมัติคนใดคนหนึ่งของขั้นปัจจุบัน
 * ระบบเดิม (ไม่มีสาย): หัวหน้าตามสายบังคับบัญชาของผู้แจ้ง — ถ้าผู้แจ้งไม่มีหัวหน้า admin อนุมัติแทน
 * ผู้มีสิทธิ์ tickets.approve_any (ตั้งต้น = admin) อนุมัติแทนได้ทุกกรณี
 * ผู้มีสิทธิ์ tickets.approve_own (ตั้งต้น = ผู้จัดการขึ้นไป) อนุมัติใบของตัวเองได้ทุกขั้น — ไม่นับในรายการ/ตัวเลข "รอฉันอนุมัติ" (approvalsWhere)
 */
export const canApprove = (u: UserRow, t: TicketRow) =>
  t.status === "pending_supervisor" &&
  (can(u, "tickets.approve_any") ||
    (t.requester_id === u.id && can(u, "tickets.approve_own")) ||
    (t.current_step !== null ? (t.step_approver_ids ?? []).map(Number).includes(u.id) : u.id === t.approver_id));

/**
 * ผู้ที่ถูกเลือกไว้ หรือผู้มีสิทธิ์ it_tickets.accept ถ้ายังไม่ได้เลือก (it_tickets.manage_all = หัวหน้า IT/admin รับแทนได้)
 * it_tickets.take_over = รับงานที่เลือกคนอื่นไว้จากคิวงาน IT (เช่น คนนั้นลา) → ผู้รับเดิมหลุดจากใบนี้ (ตัวเลขเมนู / KPI ตาม assignee_id)
 */
export const canAccept = (u: UserRow, t: TicketRow) =>
  t.status === "approved" &&
  (can(u, "it_tickets.manage_all") ||
    t.assignee_id === u.id ||
    (can(u, "it_tickets.accept") && t.assignee_id === null) ||
    (can(u, "it_tickets.take_over") && t.assignee_id !== null));

/** รับงานแทนผู้ที่ถูกเลือกไว้ (ไม่ใช่ตัวเอง และใบมีผู้ถูกเลือกแล้ว) */
export const isTakeOver = (u: UserRow, t: TicketRow) => t.assignee_id !== null && t.assignee_id !== u.id;

/** โยนงาน (ยังไม่รับ) ให้เจ้าหน้าที่ IT คนอื่น — ผู้ที่รับงานใบนี้ได้ (ผู้แจ้งเลือกคนไม่ตรงงาน) */
export const canForward = canAccept;

export const canRecordResult = (u: UserRow, t: TicketRow) =>
  t.status === "in_progress" && (u.id === t.assignee_id || can(u, "it_tickets.manage_all"));

/** บันทึกความคืบหน้า — คนเดียวกับที่บันทึกผลได้ */
export const canProgress = canRecordResult;

export const canClose = (u: UserRow, t: TicketRow) => t.status === "pending_it_head" && can(u, "it_tickets.close");

/** หัวหน้า IT อนุมัติผลแล้ว (รอปิดงาน) → ผู้แจ้งกดรับงานเพื่อปิดงาน */
export const canConfirmClose = (u: UserRow, t: TicketRow) => t.status === "pending_requester" && u.id === t.requester_id;

/** ผู้แจ้งแก้ไขได้ก่อนมีผู้อนุมัติ (ยังไม่มีขั้นใดอนุมัติ) */
export const canEdit = (u: UserRow, t: TicketRow) => u.id === t.requester_id && t.status === "pending_supervisor" && Number(t.approved_steps ?? 0) === 0;

/** ผู้แจ้งลบได้ก่อนมีผู้อนุมัติ หรือเมื่อถูกไม่อนุมัติ */
export const canDelete = (u: UserRow, t: TicketRow) => canEdit(u, t) || (u.id === t.requester_id && t.status === "rejected");

/** อนุมัติแล้ว → ผู้แจ้งกดขอยกเลิก (รอเจ้าหน้าที่ IT ยืนยัน) */
export const canRequestCancel = (u: UserRow, t: TicketRow) => u.id === t.requester_id && CANCELLABLE.includes(t.status);

/** เจ้าหน้าที่ IT ผู้รับงาน (ยังไม่มีผู้รับ = ผู้มีสิทธิ์รับงาน) หรือหัวหน้า IT/admin ยืนยันหรือปฏิเสธการยกเลิก */
export const canDecideCancel = (u: UserRow, t: TicketRow) =>
  t.status === "pending_cancel" && (u.id === t.assignee_id || can(u, "it_tickets.manage_all") || (t.assignee_id === null && can(u, "it_tickets.accept")));

/** ผู้แจ้งถอนคำขอยกเลิก */
export const canWithdrawCancel = (u: UserRow, t: TicketRow) => t.status === "pending_cancel" && u.id === t.requester_id;

/** การกระทำที่ผู้ใช้ทำได้ตอนนี้ (frontend ใช้แสดงปุ่ม) */
export function actionsFor(u: UserRow, t: TicketRow): string[] {
  const all: Array<[string, boolean]> = [
    ["approve", canApprove(u, t)],
    ["reject", canApprove(u, t)],
    ["accept", canAccept(u, t)],
    ["forward", canForward(u, t)],
    ["progress", canProgress(u, t)],
    ["result", canRecordResult(u, t)],
    ["close", canClose(u, t)],
    ["return", canClose(u, t)],
    ["confirm_close", canConfirmClose(u, t)],
    ["edit", canEdit(u, t)],
    ["delete", canDelete(u, t)],
    ["cancel_request", canRequestCancel(u, t)],
    ["cancel_confirm", canDecideCancel(u, t)],
    ["cancel_reject", canDecideCancel(u, t)],
    ["cancel_withdraw", canWithdrawCancel(u, t)],
  ];
  return all.filter(([, ok]) => ok).map(([name]) => name);
}

type Person = Pick<UserRow, "id" | "name">;

/** ชื่อฝ่าย/แผนกที่นับเป็นฝ่าย IT (เทียบแบบตัดช่องว่าง ไม่สนตัวพิมพ์) */
const IT_UNIT_NAMES = ["it", "ฝ่าย it", "ไอที", "ฝ่ายไอที", "เทคโนโลยีสารสนเทศ", "ฝ่ายเทคโนโลยีสารสนเทศ"];
const IT_UNITS_SQL = IT_UNIT_NAMES.map((n) => `'${n}'`).join(", ");

/**
 * เจ้าหน้าที่ IT (ผู้ดำเนินการในใบแจ้งงาน) = ผู้ใช้ที่ใช้งานอยู่ซึ่งอยู่ฝ่าย/แผนก IT (ฝ่าย IT / เทคโนโลยีสารสนเทศ)
 * หรือถูกตั้งเป็นเจ้าหน้าที่/หัวหน้า IT
 */
export const IT_STAFF_WHERE = `is_active = true AND (is_it_staff = true OR is_it_head = true
  OR LOWER(TRIM(department)) IN (${IT_UNITS_SQL}) OR LOWER(TRIM(division)) IN (${IT_UNITS_SQL}))`;

export const itStaff = () =>
  select<Person & { is_it_head: number }>(`SELECT id, name, is_it_head FROM users WHERE ${IT_STAFF_WHERE} ORDER BY name, id`);

/*
 * ผู้รับแจ้งเตือน "รอให้ทำ" = เฉพาะผู้ที่เกี่ยวข้องโดยตรง และต้องมีสิทธิ์ทำงานนั้นจริง
 * — ตัวเลขบนเมนูนับกว้างกว่าได้ (เช่น ผู้ดูแลระบบสูงสุดเห็นงานรอรับ/รออนุมัติผลบนเมนู แต่ไม่ได้แจ้งเตือนที่กระดิ่ง)
 */

/** ใบที่ยังไม่มีผู้รับ → เจ้าหน้าที่ IT (ฝ่าย/แผนก IT หรือติ๊กช่อง) ที่รับงานได้ */
export async function acceptors(): Promise<Person[]> {
  const staff = new Set((await itStaff()).map((s) => Number(s.id)));
  return (await usersWithPermissions(["it_tickets.queue"], ["it_tickets.accept", "it_tickets.manage_all"])).filter((p) => staff.has(p.id));
}

/** รอหัวหน้า IT อนุมัติผล → ผู้ที่ติ๊กเป็นหัวหน้า IT และปิดงานได้ (ไม่มีเลย = ผู้มีสิทธิ์ปิดงานทั้งหมด กันงานค้างโดยไม่มีใครรู้) */
export async function closers(): Promise<Person[]> {
  const all = await usersWithPermissions(["it_tickets.queue", "it_tickets.close"]);
  const heads = new Set((await select<{ id: number }>("SELECT id FROM users WHERE is_active = true AND is_it_head = true")).map((r) => Number(r.id)));
  const direct = all.filter((p) => heads.has(p.id));
  return direct.length ? direct : all;
}

/** ระบบเดิม: หัวหน้าที่ระบุ — ไม่มี/ปิดใช้งาน = ผู้มีสิทธิ์อนุมัติแทน (tickets.approve_any) */
async function approvers(t: TicketRow): Promise<Person[]> {
  if (t.approver_id) {
    const approver = await first<Person>("SELECT id, name FROM users WHERE id = ? AND is_active = true", [t.approver_id]);
    if (approver) return [approver];
  }
  return usersWithPermissions(["tickets.approve_any"]);
}

/**
 * เหตุการณ์ → แจ้งเตือน "รอให้ทำ" เดิมที่จบลงเพราะเหตุการณ์นี้ (ทำเครื่องหมายอ่านแล้วให้ทุกคน)
 * เช่น มีคนรับงานแล้ว → "รอรับงาน" ของทุกคนหมดความหมาย; ขอยกเลิกยังไม่ล้าง "รอรับงาน" เพราะถ้าปฏิเสธการยกเลิกงานก็ยังรอรับอยู่
 */
const APPROVAL = ["submitted", "step_approved"];
const RESOLVES: Record<string, string[]> = {
  submitted: APPROVAL, // แก้ใบงาน/เปลี่ยนผู้อนุมัติ → ส่งใหม่
  step_approved: APPROVAL,
  approved: APPROVAL,
  rejected: APPROVAL,
  accepted: ["approved", "forwarded"],
  // โยนงาน → "รอรับงาน" ของผู้รับเดิมจบ (ผู้รับคนใหม่ได้ "forwarded" แทน)
  forwarded: ["approved", "forwarded"],
  resulted: ["returned"],
  returned: ["resulted"],
  head_approved: ["resulted"],
  // confirmed: ผู้แจ้งเป็นคนกดเอง (ล้างของตัวเองอยู่แล้ว) — head_approved ของผู้รับงานเป็นแค่แจ้งให้ทราบ
  closed: ["resulted"],
  cancel_rejected: ["cancel_requested"],
  cancel_withdrawn: ["cancel_requested"],
  cancelled: [...APPROVAL, "approved", "forwarded", "returned", "resulted", "cancel_requested"],
};

async function stepApprovers(t: TicketRow): Promise<Person[]> {
  const ids = (t.step_approver_ids ?? []).map(Number);
  if (ids.length === 0) return [];
  return select<Person>(`SELECT id, name FROM users WHERE is_active = true AND id IN (${ids.map(() => "?").join(", ")})`, ids);
}

const byId = (id: number | null) => (id ? first<Person>("SELECT id, name FROM users WHERE id = ?", [id]) : Promise.resolve(null));

/** แจ้งเตือนผู้เกี่ยวข้องของแต่ละเหตุการณ์ (ไม่แจ้งผู้ที่เป็นคนกดเอง) */
export async function notify(t: TicketRow, event: string, actor: UserRow | null): Promise<void> {
  // งานที่รอในขั้นก่อนจบแล้ว → แจ้งเตือนนั้นของทุกคนอ่านแล้ว + ผู้กดเองได้จัดการใบนี้แล้ว (อ่านทั้งหมดของใบนี้)
  // ผู้แจ้งได้ "approved" / "resulted" ฯลฯ เป็นแค่แจ้งให้ทราบ จึงไม่ล้างของผู้แจ้ง — งานรอของผู้แจ้งมีแค่ head_approved (รอกดรับงาน)
  if (RESOLVES[event]) await markNoticesRead("ticket_id", t.uuid, { events: RESOLVES[event], exceptUserId: t.requester_id });
  if (event === "closed" || event === "cancelled") await markNoticesRead("ticket_id", t.uuid, { events: ["head_approved"], userId: t.requester_id });
  if (actor) await markNoticesRead("ticket_id", t.uuid, { userId: actor.id });

  const requester = await byId(t.requester_id);
  const assignee = await byId(t.assignee_id);

  let recipients: Array<Person | null> = [];
  switch (event) {
    case "submitted":
    case "step_approved": // สายอนุมัติ: แจ้งผู้อนุมัติของขั้นปัจจุบัน (ขั้นถัดไปหลังมีคนอนุมัติ)
      recipients = t.current_step !== null ? await stepApprovers(t) : await approvers(t);
      break;
    case "approved":
      recipients = [requester, ...(assignee ? [assignee] : await acceptors())];
      break;
    // โยนงาน → ผู้รับคนใหม่ (รอรับงาน) + ผู้แจ้ง (ทราบว่าใครดูแล)
    case "forwarded":
      recipients = [assignee, requester];
      break;
    case "rejected":
    case "accepted":
    case "progress":
      recipients = [requester];
      break;
    case "resulted":
      recipients = await closers();
      break;
    case "returned":
      recipients = [assignee];
      break;
    // ขอยกเลิก / ถอนคำขอ → เจ้าหน้าที่ผู้รับงาน (ยังไม่มีผู้รับ = ผู้ที่รับงานได้ทั้งหมด)
    case "cancel_requested":
    case "cancel_withdrawn":
      recipients = assignee ? [assignee] : await acceptors();
      break;
    case "cancelled":
    case "cancel_rejected":
      recipients = [requester];
      break;
    // หัวหน้า IT อนุมัติผล → ผู้แจ้งต้องกดรับงานเพื่อปิดงาน
    case "head_approved":
      recipients = [requester, assignee];
      break;
    // ผู้แจ้งรับงาน → ปิดงาน (แจ้งเจ้าหน้าที่ผู้รับงาน — ผู้จัดการ IT ได้แจ้งเตือนเฉพาะตอนถึงลำดับอนุมัติผล "resulted")
    case "confirmed":
      recipients = [assignee];
      break;
    case "closed":
      recipients = [requester, assignee];
      break;
  }

  const ids = [...new Set(recipients.filter((r): r is Person => r !== null).map((r) => r.id))].filter((id) => !actor || id !== actor.id);
  if (ids.length === 0) return;
  await notifyUsers(ids, TICKET_ACTIVITY, {
    kind: "ticket",
    event,
    ticket_id: t.uuid,
    ticket_no: t.ticket_no,
    ticket_type: t.type,
    actor: actor?.name ?? null,
  });
}
