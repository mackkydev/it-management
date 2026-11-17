import { randomUUID } from "node:crypto";
import { exec, first, insert, scalar, select, update } from "../db.js";
import { trans, type Locale } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { can, isSuperAdmin, type UserRow } from "../models/user.js";
import { audit } from "./audit.js";
import { markNoticesRead, notifyUsers } from "./notifications.js";
import { usersWithPermissions } from "./permissions.js";
import { closers, VPN_REQUEST_TICKET_TYPE } from "./ticket-workflow.js";

/**
 * ยืม VPN — บัญชี VPN = รายการในคลังบัญชี/รหัสผ่าน (credentials) หมวด VPN (category = 'vpn' — collation ไม่สนตัวพิมพ์ จึงตรงกับ "VPN" ด้วย)
 * 1 บัญชีให้ผู้ใช้ได้ทีละคน (สถานะ active / renewal_requested / cancel_requested)
 * ผู้ใช้เลือก ต่ออายุ / เลิกใช้ → ใบแจ้งงาน (อนุมัติแล้ว เข้าคิวงาน IT) → เจ้าหน้าที่บันทึกผลสำเร็จ = มีผลกับการยืม (applyVpnTicketOutcome)
 * ผู้ดูแล = สิทธิ์ loans.manage (เดียวกับส่งมอบ / รับคืนอุปกรณ์)
 */

export const VPN_CATEGORY = "vpn";
/**
 * ขอใช้ VPN = ใบแจ้งงานเรื่อง "อื่นๆ" หัวข้อนี้ (ตัวเลือกในฟอร์มเสมอ) + ช่วงวันที่ → vpn_loans สถานะ requested ผูก ticket_id
 * ผู้ดูแลเห็นคำขอหลังหัวหน้าอนุมัติใบงานแล้ว (เหมือนคิวงาน IT) แล้วมอบบัญชีที่หน้า จัดการ VPN
 */
export const VPN_REQUEST_TYPE = VPN_REQUEST_TICKET_TYPE;
export const isVpnRequestType = (type: unknown, typeOther: unknown) =>
  type === "other" && typeof typeOther === "string" && typeOther.trim().toLowerCase() === VPN_REQUEST_TYPE.toLowerCase();
/** คำขอที่ผู้ดูแลเห็น/มอบได้: ขอตรง (ไม่มีใบงาน) หรือใบงานผ่านหัวหน้าแล้ว — ใช้คู่กับ VPN_SELECT (alias t = it_tickets) */
export const REQUEST_VISIBLE = "(v.ticket_id IS NULL OR t.status NOT IN ('pending_supervisor', 'approval_requested'))";
/** สถานะที่ถือบัญชีอยู่ (บัญชีนี้ให้คนอื่นไม่ได้) */
export const HOLDING = ["active", "renewal_requested", "cancel_requested"] as const;
/** สถานะที่จองบัญชีไว้ (ถือบัญชี + มอบแล้วรอผู้จัดการฝ่าย IT อนุมัติ) — ใช้กันมอบบัญชีซ้ำ */
export const RESERVING = [...HOLDING, "pending_approval"] as const;
/** SQL: ไม่ใช่ใบขอใช้ VPN (alias t = it_tickets) — ตัดออกจากตัวเลขเมนูคิวงาน IT */
export const NOT_VPN_REQUEST_SQL = `NOT (t.type = 'other' AND t.type_other <=> '${VPN_REQUEST_TYPE.replace(/'/g, "''")}')`;

/**
 * ผู้อนุมัติการมอบ VPN = ผู้จัดการฝ่าย IT (ผู้อนุมัติผลใบงาน — closers) ไม่มี = ผู้มีสิทธิ์อนุมัติผลทั้งหมด
 * exceptId = ผู้มอบ (ไม่อนุมัติงานตัวเองเมื่อมีคนอื่น — กติกาเดียวกับ closersFor) — ไม่เหลือใคร = ผู้มีสิทธิ์อนุมัติผลคนอื่น → ยังไม่มี = รายชื่อเดิม
 */
export async function vpnApproverIds(exceptId: number | null = null): Promise<number[]> {
  const base = (await closers()).map((p) => Number(p.id));
  if (exceptId === null) return base;
  const others = base.filter((id) => id !== exceptId);
  if (others.length) return others;
  const any = (await usersWithPermissions(["it_tickets.close"])).map((p) => Number(p.id)).filter((id) => id !== exceptId);
  return any.length ? any : base;
}
export const isVpnApprover = async (u: UserRow) => isSuperAdmin(u) || (await vpnApproverIds()).includes(u.id);

export const managesVpn = (u: UserRow) => can(u, "loans.manage");
export const vpnManagerIds = async () => (await usersWithPermissions(["loans.manage"])).map((x) => Number(x.id));

export interface VpnLoanRow {
  id: number;
  uuid: string;
  user_id: number;
  user_name: string | null;
  department: string | null;
  purpose: string;
  requested_from: string | null;
  requested_until: string | null;
  status: string;
  credential_id: number | null;
  credential_title: string | null;
  credential_username: string | null;
  credential_url: string | null;
  assigned_by: number | null;
  assigned_name: string | null;
  assigned_at: string | null;
  start_on: string | null;
  expires_on: string | null;
  notify_days_before: number;
  reminded_for: string | null;
  expired_notified_for: string | null;
  renew_until: string | null;
  choice_reason: string | null;
  choice_at: string | null;
  ticket_id: number | null;
  ticket_uuid: string | null;
  ticket_no: string | null;
  ticket_status: string | null;
  ended_at: string | null;
  ended_name: string | null;
  end_note: string | null;
  approved_by: number | null;
  approved_name: string | null;
  approved_at: string | null;
  received_at: string | null;
  revoked_at: string | null;
  expired_notified_on: string | null;
  created_at: string | null;
}

export const VPN_SELECT = `SELECT v.*, u.name AS user_name, c.title AS credential_title, c.username AS credential_username, c.url AS credential_url,
    a.name AS assigned_name, e.name AS ended_name, ap.name AS approved_name, t.uuid AS ticket_uuid, t.ticket_no, t.status AS ticket_status
  FROM vpn_loans v LEFT JOIN users u ON u.id = v.user_id LEFT JOIN credentials c ON c.id = v.credential_id
  LEFT JOIN users a ON a.id = v.assigned_by LEFT JOIN users e ON e.id = v.ended_by LEFT JOIN users ap ON ap.id = v.approved_by LEFT JOIN it_tickets t ON t.id = v.ticket_id`;

export const loadVpnLoan = (where: string, params: unknown[]) => first<VpnLoanRow>(`${VPN_SELECT} WHERE ${where}`, params);

/** จำนวนวันจากวันนี้ถึงวันหมดอายุ (0 = หมดวันนี้, ติดลบ = หมดแล้ว) */
export function daysLeft(expiresOn: string | null, today = localToday()): number | null {
  if (!expiresOn) return null;
  return Math.round((Date.parse(`${dateOnly(expiresOn)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** opts.approver = ผู้ดูเป็นผู้อนุมัติการมอบ VPN (isVpnApprover — คำนวณครั้งเดียวต่อ request) */
export function vpnJson(r: VpnLoanRow, u: UserRow, opts: { approver?: boolean } = {}) {
  const mine = Number(r.user_id) === u.id;
  const manage = managesVpn(u);
  const left = daysLeft(r.expires_on);
  const holding = (HOLDING as readonly string[]).includes(r.status);
  const expired = holding && left !== null && left < 0;
  const waitingApproval = Boolean(r.ticket_id) && r.ticket_status === "pending_supervisor";
  const received = Boolean(r.received_at);
  const revoked = Boolean(r.revoked_at);
  return {
    id: r.uuid,
    user: { id: Number(r.user_id), name: r.user_name ?? "" },
    department: r.department,
    purpose: r.purpose,
    requested_from: dateOnly(r.requested_from),
    requested_until: dateOnly(r.requested_until),
    status: r.status as "requested" | "pending_approval" | "active" | "renewal_requested" | "cancel_requested" | "ended" | "rejected" | "cancelled",
    approved_by: r.approved_name,
    approved_at: iso(r.approved_at),
    received_at: iso(r.received_at),
    revoked_at: iso(r.revoked_at),
    // ชื่อบัญชี / ชื่อผู้ใช้ VPN ไม่ใช่ความลับ — รหัสผ่านต้องกดเปิดดู (POST /vpn-loans/:uuid/reveal)
    // ผู้ใช้เห็นชื่อผู้ใช้ VPN หลังกดได้รับแล้ว และยังไม่ถูกเรียกคืน
    account: r.credential_id && (mine || manage)
      ? { id: Number(r.credential_id), title: r.credential_title ?? "", username: manage || (received && !revoked) ? r.credential_username : null, url: r.credential_url }
      : null,
    assigned_by: r.assigned_name,
    assigned_at: iso(r.assigned_at),
    start_on: dateOnly(r.start_on),
    expires_on: dateOnly(r.expires_on),
    notify_days_before: Number(r.notify_days_before),
    days_left: holding ? left : null,
    is_expired: expired,
    // ถึงช่วงแจ้งเตือนล่วงหน้า (หรือหมดอายุแล้ว) — ผู้ใช้ควรเลือก ต่ออายุ / เลิกใช้
    is_expiring: r.status === "active" && left !== null && left <= Number(r.notify_days_before),
    renew_until: dateOnly(r.renew_until),
    choice_reason: r.choice_reason,
    choice_at: iso(r.choice_at),
    ticket: r.ticket_uuid ? { id: r.ticket_uuid, ticket_no: r.ticket_no ?? "", status: r.ticket_status ?? "" } : null,
    ended_at: iso(r.ended_at),
    ended_by: r.ended_name,
    end_note: r.end_note,
    created_at: iso(r.created_at),
    // ขอผ่านใบแจ้งงาน = ยกเลิก/แก้ที่ใบแจ้งงาน
    can_cancel: mine && r.status === "requested" && !r.ticket_id,
    // ผู้ขอกด "ได้รับแล้ว" หลังผู้จัดการฝ่าย IT อนุมัติ → ปิดใบแจ้งงาน + ปุ่มดูชื่อผู้ใช้ / รหัสผ่าน
    can_receive: mine && holding && !received && !revoked,
    // ต่ออายุ / แจ้งถูกล็อก / ไม่ต่ออายุ — หลังได้รับแล้ว (หมดอายุแล้วก็ยังขอต่ออายุได้)
    can_choose: mine && r.status === "active" && received && !revoked,
    can_reveal: mine && holding && received && !revoked && !expired && r.credential_id !== null,
    can_assign: manage && r.status === "requested" && waitingApproval === false,
    can_approve: Boolean(opts.approver) && r.status === "pending_approval",
    // เรียกคืนรหัส (ผู้ใช้ดูชื่อผู้ใช้ / รหัสผ่านไม่ได้อีก)
    can_revoke: manage && holding && !revoked,
    // ขอผ่านใบแจ้งงาน: ปฏิเสธที่ใบงาน (บันทึกผล "ดำเนินการไม่ได้") เพื่อให้ใบงานกับคำขอตรงกัน
    can_reject: manage && r.status === "requested" && !r.ticket_id,
    can_edit: manage && holding,
    can_end: manage && holding,
  };
}

/** ข้อมูลแจ้งเตือน (kind = vpn) */
export const vpnNotice = (r: VpnLoanRow, event: string, actor: string | null, extra: Record<string, unknown> = {}) => ({
  kind: "vpn",
  event,
  vpn_id: r.uuid,
  actor,
  user: r.user_name ?? "",
  account: r.credential_title ?? "",
  expires_on: dateOnly(r.expires_on),
  ...extra,
});

/** วันที่สำหรับข้อความในใบแจ้งงาน: dd/MM/yyyy (ไทย = พ.ศ.) */
export function displayDate(isoDate: string | null, locale: Locale): string {
  if (!isoDate) return "-";
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${locale === "th" ? y + 543 : y}`;
}

/**
 * ใบแจ้งงานจากคำขอ VPN ได้ผลแล้ว (เรียกใน transaction ของการบันทึกผล / ยืนยันยกเลิกใบงาน)
 * completed: ต่ออายุ → ใช้ได้ถึงวันที่ขอ (แจ้งเตือนรอบใหม่), เลิกใช้ → สิ้นสุดการยืม; not_done (ทำไม่ได้ / ยกเลิกใบงาน) → กลับเป็นใช้งานอยู่
 */
export async function applyVpnTicketOutcome(ticketId: number, outcome: "completed" | "not_done", actor: UserRow): Promise<void> {
  const rows = await select<VpnLoanRow>(`${VPN_SELECT} WHERE v.ticket_id = ? AND v.status IN ('renewal_requested', 'cancel_requested')`, [ticketId]);
  for (const r of rows) {
    const now = nowDb();
    let event: string;
    if (outcome === "completed" && r.status === "renewal_requested") {
      await update("vpn_loans", { status: "active", expires_on: dateOnly(r.renew_until), reminded_for: null, expired_notified_for: null, expired_notified_on: null, updated_at: now }, "id = ?", [r.id]);
      event = "renewed";
    } else if (outcome === "completed") {
      await update("vpn_loans", { status: "ended", ended_at: now, ended_by: actor.id, end_note: r.ticket_no, updated_at: now }, "id = ?", [r.id]);
      event = "ended";
    } else {
      await update("vpn_loans", { status: "active", updated_at: now }, "id = ?", [r.id]);
      event = "choice_not_done";
    }
    await audit({ user: { id: actor.id } }, { action: `vpn_loan.${event}`, subjectType: "vpn_loan", subjectId: r.id, before: { status: r.status }, after: { ticket: r.ticket_no } });
    const after = (await loadVpnLoan("v.id = ?", [r.id]))!;
    await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
    await notifyUsers([Number(r.user_id)], `vpn.${event}`, vpnNotice(after, event, actor.name, { ticket_no: r.ticket_no }));
  }
}

/**
 * ตัวเลขเมนู (+ ตัวเลขแท็บ key แบบ `href?status=…`):
 *   /loans/mine + /loans/vpn/request = VPN ของฉันที่ต้องทำ: ถึงช่วงต้องเลือก ต่ออายุ / เลิกใช้ (รวมหมดอายุ) + อนุมัติแล้วรอกด "ได้รับแล้ว"
 *   /loans/vpn (ผู้ดูแล) = คำขอรอมอบ + หมดอายุแล้วยังไม่จัดการ (+ รออนุมัติ เมื่อเป็นผู้อนุมัติ) — แท็บ requested / approval / expiring
 */
export async function vpnBadges(u: UserRow): Promise<Record<string, number>> {
  const today = localToday();
  const mine = Number(
    await scalar(
      `SELECT COUNT(*) FROM vpn_loans v WHERE v.user_id = ? AND v.revoked_at IS NULL AND (
         (v.status = 'active' AND v.received_at IS NOT NULL AND DATE_SUB(v.expires_on, INTERVAL v.notify_days_before DAY) <= ?)
         OR (v.status IN (?) AND v.received_at IS NULL))`,
      [u.id, today, HOLDING],
    ),
  );
  const out: Record<string, number> = { "/loans/mine": mine, "/loans/vpn/request": mine };
  if (managesVpn(u)) {
    const requested = Number(await scalar(`SELECT COUNT(*) FROM vpn_loans v LEFT JOIN it_tickets t ON t.id = v.ticket_id WHERE v.status = 'requested' AND ${REQUEST_VISIBLE}`));
    const expired = Number(await scalar("SELECT COUNT(*) FROM vpn_loans v WHERE v.status IN (?) AND v.revoked_at IS NULL AND v.expires_on < ?", [HOLDING, today]));
    const approval = (await isVpnApprover(u)) ? Number(await scalar("SELECT COUNT(*) FROM vpn_loans v WHERE v.status = 'pending_approval'")) : 0;
    out["/loans/vpn"] = requested + expired + approval;
    out["/loans/vpn?status=requested"] = requested;
    out["/loans/vpn?status=approval"] = approval;
    out["/loans/vpn?status=expiring"] = expired;
  }
  return out;
}

/* ---------------------------------------------------------------- ใบแจ้งงานขอใช้ VPN ↔ การมอบบัญชี (เรียกจากหน้าใบงาน) */

/** ผู้จัดการฝ่าย IT อนุมัติผลใบขอใช้ VPN ที่หน้าใบแจ้งงาน → การมอบบัญชีอนุมัติแล้ว (แจ้งผู้ขอ) */
export async function vpnTicketApproved(ticketId: number, actor: UserRow): Promise<void> {
  const r = await loadVpnLoan("v.ticket_id = ? AND v.status = 'pending_approval'", [ticketId]);
  if (!r) return;
  const now = nowDb();
  await update("vpn_loans", { status: "active", approved_by: actor.id, approved_at: now, updated_at: now }, "id = ?", [r.id]);
  await audit({ user: { id: actor.id } }, { action: "vpn_loan.approved", subjectType: "vpn_loan", subjectId: r.id, after: { ticket_id: ticketId } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["approval_requested"] });
  await notifyUsers([Number(r.user_id)], "vpn.assigned", vpnNotice((await loadVpnLoan("v.id = ?", [r.id]))!, "assigned", actor.name));
}

/** ผู้จัดการฝ่าย IT ส่งใบขอใช้ VPN กลับให้แก้ไข → การมอบบัญชีกลับเป็นคำขอ (บัญชีว่าง) แจ้งผู้มอบ */
export async function vpnTicketReturned(ticketId: number, actor: UserRow, note: string | null): Promise<void> {
  const r = await loadVpnLoan("v.ticket_id = ? AND v.status = 'pending_approval'", [ticketId]);
  if (!r) return;
  await update("vpn_loans", { status: "requested", credential_id: null, assigned_at: null, start_on: null, expires_on: null, updated_at: nowDb() }, "id = ?", [r.id]);
  await audit({ user: { id: actor.id } }, { action: "vpn_loan.approval_returned", subjectType: "vpn_loan", subjectId: r.id, after: { ticket_id: ticketId, note } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["approval_requested"] });
  const ids = [Number(r.assigned_by ?? 0)].filter((x) => x && x !== actor.id);
  if (ids.length) await notifyUsers(ids, "vpn.approval_returned", vpnNotice(r, "approval_returned", actor.name, { note }));
}

/** ผู้ขอกดรับงานที่ใบแจ้งงาน / ปิดงานอัตโนมัติ = ได้รับ VPN แล้ว */
export async function vpnTicketReceived(ticketId: number): Promise<void> {
  await exec("UPDATE vpn_loans SET received_at = ? WHERE ticket_id = ? AND status IN (?) AND received_at IS NULL", [nowDb(), ticketId, HOLDING]);
}

/**
 * แจ้งเตือน VPN (scheduler ทุกชั่วโมง) — ครั้งเดียวต่อวันหมดอายุ
 * - ถึงช่วงแจ้งล่วงหน้า (expires_on − notify_days_before ≤ วันนี้ ≤ expires_on) → ผู้ใช้: เลือก ต่ออายุ / เลิกใช้
 * - เลยวันหมดอายุ (ยังไม่ได้เลือก) → ผู้ใช้ + ผู้ดูแล
 * คืนจำนวนรายการที่แจ้ง
 */
export async function notifyVpnExpiry(): Promise<number> {
  const today = localToday();
  let sent = 0;
  const reminders = await select<VpnLoanRow>(
    `${VPN_SELECT} WHERE v.status = 'active' AND v.expires_on >= ? AND DATE_SUB(v.expires_on, INTERVAL v.notify_days_before DAY) <= ?
        AND (v.reminded_for IS NULL OR v.reminded_for <> v.expires_on)`,
    [today, today],
  );
  for (const r of reminders) {
    await notifyUsers([Number(r.user_id)], "vpn.expiring", vpnNotice(r, "expiring", null, { days_left: daysLeft(r.expires_on, today) }));
    await exec("UPDATE vpn_loans SET reminded_for = expires_on WHERE id = ?", [r.id]);
    sent++;
  }
  // หมดอายุแล้ว (ยังถือบัญชี ไม่ถูกเรียกคืน) → แจ้งผู้ใช้ + ผู้ดูแล ทุกวันจนกว่าจะต่ออายุ / สิ้นสุด (แจ้งเตือนของวันก่อนอ่านแล้ว)
  const expired = await select<VpnLoanRow>(
    `${VPN_SELECT} WHERE v.status IN (?) AND v.revoked_at IS NULL AND v.expires_on < ? AND (v.expired_notified_on IS NULL OR v.expired_notified_on < ?)`,
    [HOLDING, today, today],
  );
  const managers = expired.length ? await vpnManagerIds() : [];
  for (const r of expired) {
    await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
    await notifyUsers([...new Set([Number(r.user_id), ...managers])], "vpn.expired", vpnNotice(r, "expired", null));
    await exec("UPDATE vpn_loans SET expired_notified_for = expires_on, expired_notified_on = ? WHERE id = ?", [today, r.id]);
    sent++;
  }
  return sent;
}

/** ข้อความเรื่องของใบแจ้งงาน (ใช้ทดสอบ / แสดงผล) */
export const vpnTicketSubject = (choice: "renew" | "cancel" | "locked", locale: Locale) => trans(locale, `eam.vpn.ticket_${choice}`);

/* ---------------------------------------------------------------- ขอใช้ผ่านใบแจ้งงาน */

export interface VpnRequestInput {
  /** ใบงานเป็นเรื่อง "ขอใช้งาน VPN" หรือไม่ (ไม่ใช่ = ยกเลิกคำขอเดิมของใบนี้ถ้ามี) */
  vpn: boolean;
  from: string | null;
  until: string | null;
  purpose: string;
}

/**
 * สร้าง / ปรับคำขอ VPN ของใบแจ้งงาน (เรียกใน transaction ของการแจ้งงาน / แก้ใบงาน — ตรวจวันที่มาแล้ว)
 * คืน false = ผู้ใช้มีคำขอที่รออยู่แล้ว (ผู้เรียกแจ้ง error)
 */
export async function syncVpnRequest(ticketId: number, requester: UserRow, input: VpnRequestInput): Promise<boolean> {
  const current = await first<{ id: number }>("SELECT id FROM vpn_loans WHERE ticket_id = ? AND status = 'requested' FOR UPDATE", [ticketId]);
  const now = nowDb();
  if (!input.vpn) {
    if (current) await update("vpn_loans", { status: "cancelled", ended_at: now, ended_by: requester.id, updated_at: now }, "id = ?", [current.id]);
    return true;
  }
  const values = { purpose: input.purpose, requested_from: input.from, requested_until: input.until, updated_at: now };
  if (current) {
    await update("vpn_loans", values, "id = ?", [current.id]);
    return true;
  }
  if (await first("SELECT 1 AS x FROM vpn_loans WHERE user_id = ? AND status = 'requested'", [requester.id])) return false;
  const id = await insert("vpn_loans", {
    ...values, uuid: randomUUID(), user_id: requester.id, department: requester.department, status: "requested", ticket_id: ticketId, created_at: now,
  });
  await audit({ user: { id: requester.id } }, { action: "vpn_loan.requested", subjectType: "vpn_loan", subjectId: id, after: { ticket_id: ticketId, from: input.from, until: input.until } });
  return true;
}

/** คำขอ VPN ของใบงานที่ยังรอมอบบัญชี (ใบงานบันทึกผลสำเร็จไม่ได้จนกว่าจะมอบบัญชี) */
export const pendingVpnRequest = (ticketId: number) =>
  first<{ id: number; uuid: string }>("SELECT id, uuid FROM vpn_loans WHERE ticket_id = ? AND status = 'requested'", [ticketId]);

/** ใบงานถูกไม่อนุมัติ / ยกเลิก / ลบ / ทำไม่ได้ → ปิดคำขอ VPN ที่ยังรอมอบบัญชี */
export async function closeVpnRequest(ticketId: number, status: "rejected" | "cancelled", actor: UserRow, note: string | null): Promise<void> {
  const r = await pendingVpnRequest(ticketId);
  if (!r) return;
  const now = nowDb();
  await update("vpn_loans", { status, ended_at: now, ended_by: actor.id, end_note: note, updated_at: now }, "id = ?", [r.id]);
  await audit({ user: { id: actor.id } }, { action: `vpn_loan.${status}`, subjectType: "vpn_loan", subjectId: r.id, after: { ticket_id: ticketId, note } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
}

/**
 * ใบงานขอใช้ VPN ผ่านหัวหน้าแล้ว → แจ้งผู้ดูแล VPN + เจ้าหน้าที่ที่ผู้ขอเลือก (แจ้งเตือนใบงานฝั่ง IT ของใบนี้ไม่ส่ง —
 * ฝั่ง IT เห็นที่เมนู VPN อย่างเดียว: ticket-workflow notify ตัดผู้รับฝั่ง IT ของใบขอใช้ VPN)
 */
export async function announceVpnRequest(ticketId: number, assigneeId: number | null): Promise<void> {
  const r = await loadVpnLoan("v.ticket_id = ? AND v.status = 'requested'", [ticketId]);
  if (!r) return;
  const ids = [...new Set([...(await vpnManagerIds()), ...(assigneeId ? [assigneeId] : [])])].filter((x) => x !== Number(r.user_id));
  if (ids.length) await notifyUsers(ids, "vpn.requested", vpnNotice(r, "requested", r.user_name, { requested_until: dateOnly(r.requested_until) }));
}

/** คำขอ VPN ที่ผูกกับใบงาน (หน้าใบงาน) */
export async function vpnOfTicket(ticketId: number) {
  const r = await loadVpnLoan("v.ticket_id = ? ORDER BY v.id DESC LIMIT 1", [ticketId]);
  return r
    ? { id: r.uuid, status: r.status, requested_from: dateOnly(r.requested_from), requested_until: dateOnly(r.requested_until), account: r.credential_title, expires_on: dateOnly(r.expires_on) }
    : null;
}
