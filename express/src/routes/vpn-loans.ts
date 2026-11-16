import { normalizeIp } from "../lib/client.js";
import { Router, type Request } from "express";
import { first, insert, isUuid, lockNamed, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { limits } from "../lib/rate-limit.js";
import { dateOnly, localToday, nowDb } from "../lib/time.js";
import { int, regex, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { audit } from "../services/audit.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { assertCanReveal, notifyReveal, verifyLoginPassword } from "../services/secret-guard.js";
import { getSetting } from "../services/settings.js";
import { decryptVaultNullable } from "../services/vault-crypto.js";
import {
  daysLeft, displayDate, HOLDING, isVpnApprover, loadVpnLoan, managesVpn, REQUEST_VISIBLE, RESERVING, VPN_CATEGORY, VPN_SELECT, vpnApproverIds, vpnJson, vpnManagerIds, vpnNotice,
  vpnTicketReturned, vpnTicketSubject, type VpnLoanRow,
} from "../services/vpn-loans.js";
import { createSystemTicket, ticketReturnToStaff, zoomTicketAccepted, zoomTicketApprove, zoomTicketConfirm, zoomTicketResulted } from "./tickets.js";
import { type UserRow } from "../models/user.js";

/**
 * ยืม VPN — บัญชีจากคลังบัญชี/รหัสผ่าน หมวด VPN (services/vpn-loans.ts)
 *   ขอใช้ = ใบแจ้งงานเรื่อง "อื่นๆ → ขอใช้งาน VPN" + ช่วงวันที่ (routes/tickets.ts → syncVpnRequest) — ผู้ดูแลเห็นหลังหัวหน้าอนุมัติใบงาน
 *   ทุกคน: GET /vpn-loans/mine, GET /vpn-loans/:uuid (ของตัวเอง), POST /vpn-loans/:uuid/cancel (ยกเลิกคำขอที่ไม่มีใบงาน),
 *          POST /vpn-loans/:uuid/receive (กด "ได้รับแล้ว" → ปิดใบแจ้งงาน), POST /vpn-loans/:uuid/reveal { password } (ยืนยันรหัสผ่าน login ทุกครั้ง),
 *          POST /vpn-loans/:uuid/choice { choice: renew|cancel|locked } → ใบแจ้งงานเข้าคิว IT
 *   loans.manage: GET /vpn-accounts (บัญชี VPN + ผู้ถือ), GET /vpn-loans/manage?status=, POST /vpn-loans/:uuid/assign (→ รอผู้จัดการฝ่าย IT อนุมัติ),
 *          PUT /vpn-loans/:uuid, POST /vpn-loans/:uuid/reject, POST /vpn-loans/:uuid/end, POST /vpn-loans/:uuid/revoke (เรียกคืนรหัส)
 *   ผู้จัดการฝ่าย IT (closers): POST /vpn-loans/:uuid/approval { approve, note } — อนุมัติ = แจ้งผู้ขอ / ส่งกลับ = กลับเป็นคำขอ
 *   ใบแจ้งงานขอใช้ VPN เดินเบื้องหลัง: มอบ = ใบงานบันทึกผลสำเร็จ (ผู้รับงาน = ผู้มอบ → KPI), อนุมัติ = ผู้จัดการ IT อนุมัติผล, ได้รับแล้ว = ปิดงาน
 *   ทุกการเปลี่ยนแปลงลง audit_logs · เปิดดูรหัส = รหัสผ่าน login + IP (assertCanReveal) + credential_access_logs + notifyReveal
 */
export const vpnLoanRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, `eam.vpn.${key}`, replace);
const json = async (r: VpnLoanRow, u: UserRow) => vpnJson(r, u, { approver: await isVpnApprover(u) });

async function findVpn(req: Request): Promise<VpnLoanRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await loadVpnLoan("v.uuid = ?", [uuid]) : null;
  if (!row) throw notFound();
  return row;
}
/** ขอผ่านใบแจ้งงานที่หัวหน้ายังไม่อนุมัติ — ยังมอบ/ไม่อนุมัติไม่ได้ */
const awaitingApproval = (r: VpnLoanRow) => Boolean(r.ticket_id) && r.ticket_status === "pending_supervisor";
const reload = async (id: number) => (await loadVpnLoan("v.id = ?", [id]))!;
const lockKey = (credentialId: number) => `vpn_loan:${credentialId}`;
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* ---------------------------------------------------------------- บัญชี VPN */

/** บัญชี VPN ในคลัง + ผู้ที่ถืออยู่ตอนนี้ (ตัวเลือกตอนมอบ) */
vpnLoanRoutes.get("/vpn-accounts", async (req, res) => {
  authorize(managesVpn(me(req)));
  const rows = await select<{ id: number; title: string; username: string | null; expires_at: string | null; holder: string | null; holder_until: string | null }>(
    `SELECT c.id, c.title, c.username, c.expires_at,
            (SELECT u.name FROM vpn_loans v JOIN users u ON u.id = v.user_id WHERE v.credential_id = c.id AND v.status IN (?) LIMIT 1) AS holder,
            (SELECT v.expires_on FROM vpn_loans v WHERE v.credential_id = c.id AND v.status IN (?) LIMIT 1) AS holder_until
       FROM credentials c WHERE c.deleted_at IS NULL AND c.category = ? ORDER BY c.title, c.id`,
    [RESERVING, RESERVING, VPN_CATEGORY],
  );
  res.json({
    data: rows.map((r) => ({ id: Number(r.id), title: r.title, username: r.username, expires_at: dateOnly(r.expires_at), holder: r.holder, holder_until: dateOnly(r.holder_until) })),
  });
});

/** บัญชีต้องเป็น VPN ในคลัง และไม่มีคนอื่นถืออยู่ (เรียกใน transaction หลัง lock) */
async function assertAccountFree(req: Request, credentialId: number, exceptLoanId: number) {
  const c = await first<{ id: number }>("SELECT id FROM credentials WHERE id = ? AND deleted_at IS NULL AND category = ?", [credentialId, VPN_CATEGORY]);
  if (!c) throw ValidationError.withMessages({ credential_id: t(req, "account_invalid") });
  const holder = await first<{ name: string | null }>(
    "SELECT u.name FROM vpn_loans v LEFT JOIN users u ON u.id = v.user_id WHERE v.credential_id = ? AND v.status IN (?) AND v.id <> ? LIMIT 1",
    [credentialId, RESERVING, exceptLoanId],
  );
  if (holder) throw ValidationError.withMessages({ credential_id: t(req, "account_taken", { name: holder.name ?? "-" }) });
}

/* ---------------------------------------------------------------- รายการ */

vpnLoanRoutes.get("/vpn-loans/mine", async (req, res) => {
  const u = me(req);
  const rows = await select<VpnLoanRow>(
    `${VPN_SELECT} WHERE v.user_id = ? ORDER BY FIELD(v.status, 'active', 'renewal_requested', 'cancel_requested', 'requested') DESC, v.created_at DESC, v.id DESC LIMIT 200`,
    [u.id],
  );
  const approver = await isVpnApprover(u);
  res.json({ data: rows.map((r) => vpnJson(r, u, { approver })) });
});

/** ผู้ดูแล: requested = รอมอบบัญชี, active = ใช้อยู่ (รวมรอใบงาน), expiring = ถึงช่วงแจ้งเตือน / หมดอายุ, ended = สิ้นสุด / ไม่อนุมัติ / ยกเลิก */
vpnLoanRoutes.get("/vpn-loans/manage", async (req, res) => {
  const u = me(req);
  const approver = await isVpnApprover(u);
  // ผู้อนุมัติ (ผู้จัดการฝ่าย IT) ที่ไม่มี loans.manage ดูได้เฉพาะแท็บรออนุมัติ
  authorize(managesVpn(u) || approver);
  const f = await validate(req.input, { status: ["nullable", "in:requested,approval,active,expiring,ended"] }, { locale: req.locale });
  const status = managesVpn(u) ? ((f.status as string) ?? "requested") : "approval";
  const today = localToday();
  const where = {
    requested: [`v.status = 'requested' AND ${REQUEST_VISIBLE}`, []],
    approval: ["v.status = 'pending_approval'", []],
    active: ["v.status IN (?)", [HOLDING]],
    expiring: ["v.status IN (?) AND DATE_SUB(v.expires_on, INTERVAL v.notify_days_before DAY) <= ?", [HOLDING, today]],
    ended: ["v.status IN ('ended', 'rejected', 'cancelled')", []],
  }[status] as [string, unknown[]];
  const order = status === "ended" ? "v.updated_at DESC, v.id DESC" : status === "requested" ? "v.created_at, v.id" : "v.expires_on, v.id";
  const rows = await select<VpnLoanRow>(`${VPN_SELECT} WHERE ${where[0]} ORDER BY ${order} LIMIT 500`, where[1]);
  res.json({ data: rows.map((r) => vpnJson(r, u, { approver })), meta: { status, can_manage: managesVpn(u), approver, notify_days: Number(await getSetting("vpn_notify_days")) } });
});

vpnLoanRoutes.get("/vpn-loans/:uuid", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id || managesVpn(u) || (r.status === "pending_approval" && (await isVpnApprover(u))));
  res.json({ data: await json(r, u) });
});

/* ---------------------------------------------------------------- ผู้ใช้ */

vpnLoanRoutes.post("/vpn-loans/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id);
  if (r.status !== "requested" || r.ticket_id) throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const now = nowDb();
  await update("vpn_loans", { status: "cancelled", ended_at: now, ended_by: u.id, updated_at: now }, "id = ?", [r.id]);
  await audit(req, { action: "vpn_loan.cancelled", subjectType: "vpn_loan", subjectId: r.id, before: { status: r.status } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  res.json({ data: await json(await reload(Number(r.id)), u) });
});

/**
 * ผู้ขอกด "ได้รับแล้ว" (หลังผู้จัดการฝ่าย IT อนุมัติ) → ปิดใบแจ้งงาน (ใบงานรอผู้แจ้งกดรับ) + ปุ่มดูชื่อผู้ใช้ / รหัสผ่าน
 */
vpnLoanRoutes.post("/vpn-loans/:uuid/receive", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id);
  if (!vpnJson(r, u).can_receive) throw ValidationError.withMessages({ status: t(req, "not_active") });
  await update("vpn_loans", { received_at: nowDb(), updated_at: nowDb() }, "id = ? AND received_at IS NULL", [r.id]);
  if (r.ticket_id && r.ticket_status === "pending_requester") await zoomTicketConfirm(Number(r.ticket_id), u.id);
  await audit(req, { action: "vpn_loan.received", subjectType: "vpn_loan", subjectId: r.id, after: { ticket: r.ticket_no } });
  await markNoticesRead("vpn_id", r.uuid, { userId: u.id, events: ["assigned"] });
  res.json({ data: await json(await reload(Number(r.id)), u) });
});

/**
 * เปิดดูรหัส VPN ของตัวเอง { password } — หลังกดได้รับแล้ว ระหว่างยังถือบัญชี ยังไม่หมดอายุ และไม่ถูกเรียกคืน
 * ต้องกรอกรหัสผ่าน login ของตัวเองทุกครั้ง (ผิด = 422 + audit) + จำกัด IP ตามหน้าตั้งค่า + บันทึกประวัติ + แจ้งเตือน — หน้าเว็บจำค่าไว้ 1 นาที
 */
vpnLoanRoutes.post("/vpn-loans/:uuid/reveal", limits.reveal, async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id);
  if (!vpnJson(r, u).can_reveal) throw ValidationError.withMessages({ status: t(req, "cannot_reveal") });
  const c = (await first<{ id: number; title: string; password: string | null; require_reauth: boolean }>(
    "SELECT id, title, password, require_reauth FROM credentials WHERE id = ? AND deleted_at IS NULL",
    [r.credential_id],
  ))!;
  if (!c) throw ValidationError.withMessages({ status: t(req, "cannot_reveal") });
  // IP (ถ้าเปิดจำกัด) ตามหน้าตั้งค่า — การยืนยันตัวตนใช้รหัสผ่าน login ด้านล่างแทน
  await assertCanReveal(req, { reauth: false });
  const data = await validate(req.input, { password: ["required", "string", "max:255"] }, { locale: req.locale });
  if (!(await verifyLoginPassword(req, u, String(data.password)))) {
    await audit(req, { action: "auth.reauth_failed", subjectType: "user", subjectId: u.id, after: { method: "password", vpn_loan: r.uuid } });
    throw ValidationError.withMessages({ password: trans(req.locale, "eam.secret_guard.wrong_password") });
  }
  await insert("credential_access_logs", { credential_id: c.id, user_id: u.id, action: "vpn_reveal", ip: normalizeIp(req.ip), created_at: nowDb() });
  await notifyReveal(req, "vault", { id: c.id, title: c.title });
  res.json({ data: { username: r.credential_username, password: decryptVaultNullable(c.password) } });
});

/**
 * ผู้ใช้เลือก ต่ออายุ { renew_until, reason } / เลิกใช้ { reason } → ใบแจ้งงาน (อนุมัติแล้ว) เข้าคิวงาน IT
 * ผู้รับงาน = เจ้าหน้าที่ที่มอบบัญชีนี้ (ถ้ายังเป็นเจ้าหน้าที่ IT) ไม่งั้นรอรับในคิว — ทำสำเร็จแล้วมีผลกับการยืม (applyVpnTicketOutcome) และขึ้น KPI เมื่อผู้จัดการ IT อนุมัติผล
 */
vpnLoanRoutes.post("/vpn-loans/:uuid/choice", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id);
  if (!vpnJson(r, u).can_choose) throw ValidationError.withMessages({ choice: t(req, "not_active") });
  const data = await validate(
    req.input,
    { choice: ["required", "in:renew,cancel,locked"], renew_until: ["required_if:choice,renew", "nullable", regex(DATE)], reason: ["nullable", "string", "max:2000"] },
    { locale: req.locale },
  );
  const choice = data.choice as "renew" | "cancel" | "locked";
  const today = localToday();
  const current = dateOnly(r.expires_on) ?? today;
  const renewUntil = choice === "renew" ? String(data.renew_until) : null;
  if (renewUntil && (renewUntil <= current || renewUntil < today || renewUntil > plusDays(today, MAX_DAYS))) {
    throw ValidationError.withMessages({ renew_until: t(req, "renew_range", { date: displayDate(current, req.locale), days: MAX_DAYS }) });
  }
  const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : null;
  const L = req.locale;
  const lines = [
    t(req, "ticket_account", { account: r.credential_title ?? "-", username: r.credential_username ?? "-" }),
    t(req, "ticket_expires", { date: displayDate(current, L) }),
    ...(renewUntil ? [t(req, "ticket_renew_until", { date: displayDate(renewUntil, L) })] : []),
    ...(reason ? [t(req, "ticket_reason", { reason })] : []),
  ];
  const ticket = await transaction(async () => {
    const locked = (await first<{ status: string }>("SELECT status FROM vpn_loans WHERE id = ? FOR UPDATE", [r.id]))!;
    if (locked.status !== "active") throw ValidationError.withMessages({ choice: t(req, "not_active") });
    const created = await createSystemTicket(req, u, {
      typeOther: vpnTicketSubject(choice, L),
      details: lines.join("\n"),
      assigneeId: r.assigned_by ? Number(r.assigned_by) : null,
      comment: t(req, "ticket_auto_approved"),
    });
    const now = nowDb();
    // ไม่ต่ออายุ = สิ้นสุดการใช้ทันที บัญชีกลับคืนคลังให้มอบคนอื่นได้ (ใบแจ้งงานยังสร้างเป็นบันทึกให้ฝ่าย IT ปิดรหัสฝั่งระบบ VPN)
    if (choice === "cancel") {
      await update(
        "vpn_loans",
        { status: "ended", ended_at: now, ended_by: u.id, end_note: created.ticket_no, choice_reason: reason, choice_at: now, ticket_id: created.id, updated_at: now },
        "id = ?",
        [r.id],
      );
    }
    // แจ้งถูกล็อก = ใบแจ้งงานอย่างเดียว (สถานะการยืมไม่เปลี่ยน)
    if (choice === "renew") {
      await update(
        "vpn_loans",
        { status: "renewal_requested", renew_until: renewUntil, choice_reason: reason, choice_at: now, ticket_id: created.id, updated_at: now },
        "id = ?",
        [r.id],
      );
    }
    return created;
  });
  const action = { renew: "renewal_requested", cancel: "not_renewed", locked: "locked_reported" }[choice];
  await audit(req, { action: `vpn_loan.${action}`, subjectType: "vpn_loan", subjectId: r.id, after: { renew_until: renewUntil, reason, ticket: ticket.ticket_no } });
  // เลือกแล้ว = แจ้งเตือนใกล้หมดอายุ / หมดอายุหมดหน้าที่ (แจ้งถูกล็อกไม่เกี่ยว)
  if (choice !== "locked") await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
  // ฝั่ง IT เห็นที่เมนู VPN ด้วย (ใบแจ้งงานยังเข้าคิวตามเดิม)
  const staff = [...new Set([...(await vpnManagerIds()), ...(r.assigned_by ? [Number(r.assigned_by)] : [])])].filter((x) => x !== u.id);
  if (staff.length) await notifyUsers(staff, "vpn.choice_requested", vpnNotice(r, "choice_requested", u.name, { choice, ticket_no: ticket.ticket_no }));
  res.json({ data: await json(await reload(Number(r.id)), u), ticket: { id: ticket.uuid, ticket_no: ticket.ticket_no } });
});

/* ---------------------------------------------------------------- ผู้ดูแล */

async function periodInput(req: Request, opts: { requireCredential: boolean }) {
  const data = await validate(
    req.input,
    {
      credential_id: [opts.requireCredential ? "required" : "sometimes", "integer"],
      start_on: [opts.requireCredential ? "required" : "sometimes", regex(DATE)],
      expires_on: [opts.requireCredential ? "required" : "sometimes", regex(DATE)],
      notify_days_before: ["sometimes", "integer", "min:0", "max:60"],
      note: ["nullable", "string", "max:2000"],
    },
    { locale: req.locale },
  );
  return data;
}

/**
 * มอบบัญชี VPN { credential_id, start_on, expires_on, notify_days_before (ไม่ส่ง = ค่าตั้งต้นจากหน้าตั้งค่า vpn_notify_days) }
 * → รอผู้จัดการฝ่าย IT อนุมัติ (แจ้งผู้อนุมัติ) — ใบแจ้งงาน: รับงาน + บันทึกผลสำเร็จแทนผู้มอบ (ผู้รับงาน = ผู้มอบ → KPI ของผู้มอบ)
 */
vpnLoanRoutes.post("/vpn-loans/:uuid/assign", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (r.status !== "requested" || awaitingApproval(r)) throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const data = await periodInput(req, { requireCredential: true });
  const start = String(data.start_on);
  const expires = String(data.expires_on);
  if (expires < start || expires < localToday() || expires > plusDays(start, MAX_DAYS)) throw ValidationError.withMessages({ expires_on: t(req, "expires_range", { days: MAX_DAYS }) });
  const credentialId = int(data.credential_id)!;
  const notifyDays = "notify_days_before" in data ? int(data.notify_days_before)! : Number(await getSetting("vpn_notify_days"));
  const ticketId = r.ticket_id ? Number(r.ticket_id) : null;
  const ticketOpen = Boolean(ticketId) && ["approved", "in_progress"].includes(r.ticket_status ?? "");
  await transaction(async () => {
    await lockNamed(lockKey(credentialId));
    await assertAccountFree(req, credentialId, Number(r.id));
    const now = nowDb();
    await update(
      "vpn_loans",
      {
        status: "pending_approval", credential_id: credentialId, assigned_by: u.id, assigned_at: now, start_on: start, expires_on: expires, notify_days_before: notifyDays,
        reminded_for: null, expired_notified_for: null, expired_notified_on: null, approved_by: null, approved_at: null, received_at: null, revoked_at: null, revoked_by: null, updated_at: now,
      },
      "id = ?",
      [r.id],
    );
    if (ticketId && ticketOpen) {
      // ใบงานเดินเบื้องหลัง: รับงาน (ผู้มอบ) → บันทึกผลสำเร็จ → รอผู้จัดการ IT อนุมัติผล
      await zoomTicketAccepted(ticketId, u.id, now);
      await update("it_tickets", { assignee_id: u.id, updated_at: now }, "id = ? AND status = 'in_progress'", [ticketId]);
      await zoomTicketResulted(req, ticketId, u.id, t(req, "ticket_solution", { account: r.credential_title ?? String(credentialId), until: displayDate(expires, req.locale) }), t(req, "ticket_assigned_comment"));
    }
  });
  const after = await reload(Number(r.id));
  await audit(req, { action: "vpn_loan.assigned", subjectType: "vpn_loan", subjectId: r.id, after: { credential_id: credentialId, start_on: start, expires_on: expires, notify_days_before: notifyDays, status: "pending_approval" } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  const approvers = (await vpnApproverIds(u.id)).filter((x) => x !== u.id);
  if (approvers.length) await notifyUsers(approvers, "vpn.approval_requested", vpnNotice(after, "approval_requested", u.name));
  res.json({ data: await json(after, u) });
});

/**
 * ผู้จัดการฝ่าย IT อนุมัติการมอบ { approve: true } → แจ้งผู้ขอ (รอกด "ได้รับแล้ว") / ส่งกลับ { approve: false, note } → กลับเป็นคำขอ แจ้งผู้มอบ
 * ใบแจ้งงาน: อนุมัติผล (ประทับชื่อ + ลายเซ็นในโปรไฟล์ — กติกาเดียวกับหน้าใบงาน) / ส่งกลับแก้ไข
 */
vpnLoanRoutes.post("/vpn-loans/:uuid/approval", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(await isVpnApprover(u));
  if (r.status !== "pending_approval") throw ValidationError.withMessages({ status: t(req, "not_pending_approval") });
  const data = await validate(req.input, { approve: ["required", "boolean"], note: ["required_if:approve,false", "required_if:approve,0", "nullable", "string", "max:2000"] }, { locale: req.locale });
  const approve = ["1", "true", 1, true].includes(data.approve as never);
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  const ticketId = r.ticket_id && r.ticket_status === "pending_it_head" ? Number(r.ticket_id) : null;
  if (approve) {
    if (ticketId) await zoomTicketApprove(req, ticketId, u);
    const now = nowDb();
    await update("vpn_loans", { status: "active", approved_by: u.id, approved_at: now, updated_at: now }, "id = ? AND status = 'pending_approval'", [r.id]);
    await audit(req, { action: "vpn_loan.approved", subjectType: "vpn_loan", subjectId: r.id, after: { ticket: r.ticket_no } });
    await markNoticesRead("vpn_id", r.uuid, { events: ["approval_requested"] });
    await notifyUsers([Number(r.user_id)], "vpn.assigned", vpnNotice(await reload(Number(r.id)), "assigned", u.name));
  } else {
    if (ticketId) await ticketReturnToStaff(ticketId, u, note ?? "-");
    // คืนบัญชี + แจ้งผู้มอบ (ใช้กติกาเดียวกับส่งกลับจากหน้าใบงาน — ไม่มีใบงานก็ทำเหมือนกัน)
    if (ticketId) await vpnTicketReturned(ticketId, u, note);
    else {
      await update("vpn_loans", { status: "requested", credential_id: null, assigned_at: null, start_on: null, expires_on: null, updated_at: nowDb() }, "id = ?", [r.id]);
      await audit(req, { action: "vpn_loan.approval_returned", subjectType: "vpn_loan", subjectId: r.id, after: { note } });
      await markNoticesRead("vpn_id", r.uuid, { events: ["approval_requested"] });
      if (r.assigned_by && Number(r.assigned_by) !== u.id) await notifyUsers([Number(r.assigned_by)], "vpn.approval_returned", vpnNotice(r, "approval_returned", u.name, { note }));
    }
  }
  res.json({ data: await json(await reload(Number(r.id)), u) });
});

/** เรียกคืนรหัส VPN (เจ้าหน้าที่ IT) — สิ้นสุดการใช้ + บัญชีกลับคืนคลัง (มอบคนอื่นได้), ผู้ใช้ดูชื่อผู้ใช้ / รหัสผ่านไม่ได้อีก, แจ้งผู้ใช้ */
vpnLoanRoutes.post("/vpn-loans/:uuid/revoke", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (!(HOLDING as readonly string[]).includes(r.status) || r.revoked_at) throw ValidationError.withMessages({ status: t(req, "not_active") });
  const data = await validate(req.input, { note: ["nullable", "string", "max:2000"] }, { locale: req.locale });
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  const now = nowDb();
  await update("vpn_loans", { status: "ended", ended_at: now, ended_by: u.id, end_note: note, revoked_at: now, revoked_by: u.id, updated_at: now }, "id = ?", [r.id]);
  await audit(req, { action: "vpn_loan.revoked", subjectType: "vpn_loan", subjectId: r.id, after: { note } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
  await notifyUsers([Number(r.user_id)], "vpn.revoked", vpnNotice(r, "revoked", u.name, { note }));
  res.json({ data: await json(await reload(Number(r.id)), u) });
});

/** แก้วันหมดอายุ / แจ้งล่วงหน้า / เปลี่ยนบัญชี ระหว่างใช้งาน — เปลี่ยนวันหมดอายุ = แจ้งเตือนรอบใหม่ */
vpnLoanRoutes.put("/vpn-loans/:uuid", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (!(HOLDING as readonly string[]).includes(r.status)) throw ValidationError.withMessages({ status: t(req, "not_active") });
  const data = await periodInput(req, { requireCredential: false });
  const changes: Record<string, unknown> = {};
  const start = "start_on" in data ? String(data.start_on) : dateOnly(r.start_on)!;
  const expires = "expires_on" in data ? String(data.expires_on) : dateOnly(r.expires_on)!;
  if (expires < start || expires > plusDays(start, MAX_DAYS)) throw ValidationError.withMessages({ expires_on: t(req, "expires_range", { days: MAX_DAYS }) });
  if (start !== dateOnly(r.start_on)) changes.start_on = start;
  if (expires !== dateOnly(r.expires_on)) Object.assign(changes, { expires_on: expires, reminded_for: null, expired_notified_for: null });
  if ("notify_days_before" in data && int(data.notify_days_before) !== Number(r.notify_days_before)) Object.assign(changes, { notify_days_before: int(data.notify_days_before), reminded_for: null });
  const credentialId = "credential_id" in data ? int(data.credential_id)! : Number(r.credential_id);
  await transaction(async () => {
    if (credentialId !== Number(r.credential_id)) {
      await lockNamed(lockKey(credentialId));
      await assertAccountFree(req, credentialId, Number(r.id));
      changes.credential_id = credentialId;
    }
    if (Object.keys(changes).length) await update("vpn_loans", { ...changes, updated_at: nowDb() }, "id = ?", [r.id]);
  });
  const after = await reload(Number(r.id));
  if (Object.keys(changes).length) {
    await audit(req, {
      action: "vpn_loan.updated", subjectType: "vpn_loan", subjectId: r.id,
      before: { credential_id: r.credential_id, start_on: dateOnly(r.start_on), expires_on: dateOnly(r.expires_on), notify_days_before: Number(r.notify_days_before) },
      after: changes,
    });
    if ("expires_on" in changes) await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
    await notifyUsers([Number(r.user_id)], "vpn.updated", vpnNotice(after, "updated", u.name));
  }
  res.json({ data: await json(after, u) });
});

/** ไม่อนุมัติคำขอ { note } */
vpnLoanRoutes.post("/vpn-loans/:uuid/reject", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (r.status !== "requested" || r.ticket_id) throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const data = await validate(req.input, { note: ["required", "string", "max:2000", regex(/\S/)] }, { locale: req.locale });
  const now = nowDb();
  await update("vpn_loans", { status: "rejected", ended_at: now, ended_by: u.id, end_note: String(data.note).trim(), updated_at: now }, "id = ?", [r.id]);
  const after = await reload(Number(r.id));
  await audit(req, { action: "vpn_loan.rejected", subjectType: "vpn_loan", subjectId: r.id, after: { note: after.end_note } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  await notifyUsers([Number(r.user_id)], "vpn.rejected", vpnNotice(after, "rejected", u.name, { note: after.end_note }));
  res.json({ data: await json(after, u) });
});

/** สิ้นสุดการยืม (ผู้ดูแลยกเลิกบัญชีเอง) { note } — บัญชีว่างให้คนอื่นได้ */
vpnLoanRoutes.post("/vpn-loans/:uuid/end", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (!(HOLDING as readonly string[]).includes(r.status)) throw ValidationError.withMessages({ status: t(req, "not_active") });
  const data = await validate(req.input, { note: ["nullable", "string", "max:2000"] }, { locale: req.locale });
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : null;
  const now = nowDb();
  await update("vpn_loans", { status: "ended", ended_at: now, ended_by: u.id, end_note: note, updated_at: now }, "id = ?", [r.id]);
  const after = await reload(Number(r.id));
  await audit(req, { action: "vpn_loan.ended", subjectType: "vpn_loan", subjectId: r.id, before: { status: r.status }, after: { note, days_left: daysLeft(r.expires_on) } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
  await notifyUsers([Number(r.user_id)], "vpn.ended", vpnNotice(after, "ended", u.name, { note }));
  res.json({ data: await json(after, u) });
});
