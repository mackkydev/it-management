import { first, select } from "../db.js";
import { isAdmin, isIt, type UserRow } from "../models/user.js";
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
}

export const canView = (u: UserRow, t: TicketRow) =>
  isAdmin(u) || isIt(u) || [t.requester_id, t.approver_id, t.assignee_id, t.it_head_id].includes(u.id);

/** หัวหน้าตามสายบังคับบัญชาของผู้แจ้ง — ถ้าผู้แจ้งไม่มีหัวหน้า admin อนุมัติแทน */
export const canApprove = (u: UserRow, t: TicketRow) => t.status === "pending_supervisor" && (u.id === t.approver_id || isAdmin(u));

/** ผู้ที่ถูกเลือกไว้ หรือ IT คนใดก็ได้ถ้ายังไม่ได้เลือก (หัวหน้า IT/admin รับแทนได้) */
export const canAccept = (u: UserRow, t: TicketRow) =>
  t.status === "approved" && (isAdmin(u) || Boolean(u.is_it_head) || (Boolean(u.is_it_staff) && (t.assignee_id === null || t.assignee_id === u.id)));

export const canRecordResult = (u: UserRow, t: TicketRow) =>
  t.status === "in_progress" && (u.id === t.assignee_id || Boolean(u.is_it_head) || isAdmin(u));

export const canClose = (u: UserRow, t: TicketRow) => t.status === "pending_it_head" && (Boolean(u.is_it_head) || isAdmin(u));

/** การกระทำที่ผู้ใช้ทำได้ตอนนี้ (frontend ใช้แสดงปุ่ม) */
export function actionsFor(u: UserRow, t: TicketRow): string[] {
  const all: Array<[string, boolean]> = [
    ["approve", canApprove(u, t)],
    ["reject", canApprove(u, t)],
    ["accept", canAccept(u, t)],
    ["result", canRecordResult(u, t)],
    ["close", canClose(u, t)],
    ["return", canClose(u, t)],
  ];
  return all.filter(([, ok]) => ok).map(([name]) => name);
}

type Person = Pick<UserRow, "id" | "name">;

export const itStaff = () =>
  select<Person & { is_it_head: number }>(
    "SELECT id, name, is_it_head FROM users WHERE is_active = true AND (is_it_staff = true OR is_it_head = true) ORDER BY name, id",
  );

async function itHeads(): Promise<Person[]> {
  const heads = await select<Person>("SELECT id, name FROM users WHERE is_active = true AND is_it_head = true");
  return heads.length ? heads : select<Person>("SELECT id, name FROM users WHERE is_active = true AND role = 'admin'");
}

async function approvers(t: TicketRow): Promise<Person[]> {
  if (t.approver_id) {
    const approver = await first<Person>("SELECT id, name FROM users WHERE id = ? AND is_active = true", [t.approver_id]);
    if (approver) return [approver];
  }
  return select<Person>("SELECT id, name FROM users WHERE is_active = true AND role = 'admin'");
}

const byId = (id: number | null) => (id ? first<Person>("SELECT id, name FROM users WHERE id = ?", [id]) : Promise.resolve(null));

/** แจ้งเตือนผู้เกี่ยวข้องของแต่ละเหตุการณ์ (ไม่แจ้งผู้ที่เป็นคนกดเอง) */
export async function notify(t: TicketRow, event: string, actor: UserRow | null): Promise<void> {
  const requester = await byId(t.requester_id);
  const assignee = await byId(t.assignee_id);

  let recipients: Array<Person | null> = [];
  switch (event) {
    case "submitted":
      recipients = await approvers(t);
      break;
    case "approved":
      recipients = [requester, ...(assignee ? [assignee] : await itStaff())];
      break;
    case "rejected":
    case "accepted":
      recipients = [requester];
      break;
    case "resulted":
      recipients = await itHeads();
      break;
    case "returned":
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
