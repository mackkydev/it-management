import { first, select } from "../db.js";
import { can, type UserRow } from "../models/user.js";
import { notifyUsers, TICKET_ACTIVITY } from "./notifications.js";

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
  (SELECT COUNT(*) FROM it_ticket_approval_steps s WHERE s.it_ticket_id = t.id AND s.status = 'approved') AS approved_steps`;

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
  (!PRE_APPROVAL.includes(t.status) && (can(u, "it_tickets.queue") || u.id === t.assignee_id));

/**
 * สายอนุมัติ: ผู้อนุมัติคนใดคนหนึ่งของขั้นปัจจุบัน
 * ระบบเดิม (ไม่มีสาย): หัวหน้าตามสายบังคับบัญชาของผู้แจ้ง — ถ้าผู้แจ้งไม่มีหัวหน้า admin อนุมัติแทน
 * ผู้มีสิทธิ์ tickets.approve_any (ตั้งต้น = admin) อนุมัติแทนได้ทุกกรณี
 */
export const canApprove = (u: UserRow, t: TicketRow) =>
  t.status === "pending_supervisor" &&
  (can(u, "tickets.approve_any") || (t.current_step !== null ? (t.step_approver_ids ?? []).map(Number).includes(u.id) : u.id === t.approver_id));

/** ผู้ที่ถูกเลือกไว้ หรือผู้มีสิทธิ์ it_tickets.accept ถ้ายังไม่ได้เลือก (it_tickets.manage_all = หัวหน้า IT/admin รับแทนได้) */
export const canAccept = (u: UserRow, t: TicketRow) =>
  t.status === "approved" &&
  (can(u, "it_tickets.manage_all") || t.assignee_id === u.id || (can(u, "it_tickets.accept") && t.assignee_id === null));

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

/** เจ้าหน้าที่ IT = ผู้ใช้ที่ใช้งานอยู่ซึ่งอยู่แผนก IT หรือถูกตั้งเป็นเจ้าหน้าที่/หัวหน้า IT */
export const IT_STAFF_WHERE = "is_active = true AND (is_it_staff = true OR is_it_head = true OR LOWER(TRIM(department)) = 'it')";

export const itStaff = () =>
  select<Person & { is_it_head: number }>(`SELECT id, name, is_it_head FROM users WHERE ${IT_STAFF_WHERE} ORDER BY name, id`);

async function itHeads(): Promise<Person[]> {
  const heads = await select<Person>("SELECT id, name FROM users WHERE is_active = true AND is_it_head = true");
  return heads.length ? heads : select<Person>("SELECT id, name FROM users WHERE is_active = true AND role IN ('super_admin', 'admin')");
}

async function approvers(t: TicketRow): Promise<Person[]> {
  if (t.approver_id) {
    const approver = await first<Person>("SELECT id, name FROM users WHERE id = ? AND is_active = true", [t.approver_id]);
    if (approver) return [approver];
  }
  return select<Person>("SELECT id, name FROM users WHERE is_active = true AND role IN ('super_admin', 'admin')");
}

async function stepApprovers(t: TicketRow): Promise<Person[]> {
  const ids = (t.step_approver_ids ?? []).map(Number);
  if (ids.length === 0) return [];
  return select<Person>(`SELECT id, name FROM users WHERE is_active = true AND id IN (${ids.map(() => "?").join(", ")})`, ids);
}

const byId = (id: number | null) => (id ? first<Person>("SELECT id, name FROM users WHERE id = ?", [id]) : Promise.resolve(null));

/** แจ้งเตือนผู้เกี่ยวข้องของแต่ละเหตุการณ์ (ไม่แจ้งผู้ที่เป็นคนกดเอง) */
export async function notify(t: TicketRow, event: string, actor: UserRow | null): Promise<void> {
  const requester = await byId(t.requester_id);
  const assignee = await byId(t.assignee_id);

  let recipients: Array<Person | null> = [];
  switch (event) {
    case "submitted":
    case "step_approved": // สายอนุมัติ: แจ้งผู้อนุมัติของขั้นปัจจุบัน (ขั้นถัดไปหลังมีคนอนุมัติ)
      recipients = t.current_step !== null ? await stepApprovers(t) : await approvers(t);
      break;
    case "approved":
      recipients = [requester, ...(assignee ? [assignee] : await itStaff())];
      break;
    case "rejected":
    case "accepted":
    case "progress":
      recipients = [requester];
      break;
    case "resulted":
      recipients = await itHeads();
      break;
    case "returned":
      recipients = [assignee];
      break;
    // ขอยกเลิก / ถอนคำขอ → เจ้าหน้าที่ผู้รับงาน (ยังไม่มีผู้รับ = เจ้าหน้าที่ IT ทั้งหมด)
    case "cancel_requested":
    case "cancel_withdrawn":
      recipients = assignee ? [assignee] : await itStaff();
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
