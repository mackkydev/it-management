import { randomUUID } from "node:crypto";
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
import { assertCanReveal, notifyReveal } from "../services/secret-guard.js";
import { decryptVaultNullable } from "../services/vault-crypto.js";
import {
  daysLeft, displayDate, HOLDING, loadVpnLoan, managesVpn, VPN_CATEGORY, VPN_SELECT, vpnJson, vpnManagerIds, vpnNotice, vpnTicketSubject, type VpnLoanRow,
} from "../services/vpn-loans.js";
import { createSystemTicket } from "./tickets.js";

/**
 * ยืม VPN — บัญชีจากคลังบัญชี/รหัสผ่าน หมวด VPN (services/vpn-loans.ts)
 *   ทุกคน: POST /vpn-loans (ขอใช้), GET /vpn-loans/mine, GET /vpn-loans/:uuid (ของตัวเอง), POST /vpn-loans/:uuid/cancel (ยกเลิกคำขอ),
 *          POST /vpn-loans/:uuid/reveal (เปิดดูรหัส — ระหว่างยังใช้ได้), POST /vpn-loans/:uuid/choice { choice: renew|cancel } → ใบแจ้งงานเข้าคิว IT
 *   loans.manage: GET /vpn-accounts (บัญชี VPN + ผู้ถือ), GET /vpn-loans/manage?status=, POST /vpn-loans/:uuid/assign, PUT /vpn-loans/:uuid,
 *          POST /vpn-loans/:uuid/reject, POST /vpn-loans/:uuid/end
 *   ทุกการเปลี่ยนแปลงลง audit_logs · เปิดดูรหัส = assertCanReveal + credential_access_logs + notifyReveal
 */
export const vpnLoanRoutes = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const t = (req: Request, key: string, replace: Record<string, string | number> = {}) => trans(req.locale, `eam.vpn.${key}`, replace);

async function findVpn(req: Request): Promise<VpnLoanRow> {
  const uuid = String(req.params.uuid);
  const row = isUuid(uuid) ? await loadVpnLoan("v.uuid = ?", [uuid]) : null;
  if (!row) throw notFound();
  return row;
}
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
    [HOLDING, HOLDING, VPN_CATEGORY],
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
    [credentialId, HOLDING, exceptLoanId],
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
  res.json({ data: rows.map((r) => vpnJson(r, u)) });
});

/** ผู้ดูแล: requested = รอมอบบัญชี, active = ใช้อยู่ (รวมรอใบงาน), expiring = ถึงช่วงแจ้งเตือน / หมดอายุ, ended = สิ้นสุด / ไม่อนุมัติ / ยกเลิก */
vpnLoanRoutes.get("/vpn-loans/manage", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const f = await validate(req.input, { status: ["nullable", "in:requested,active,expiring,ended"] }, { locale: req.locale });
  const status = (f.status as string) ?? "requested";
  const today = localToday();
  const where = {
    requested: ["v.status = 'requested'", []],
    active: ["v.status IN (?)", [HOLDING]],
    expiring: ["v.status IN (?) AND DATE_SUB(v.expires_on, INTERVAL v.notify_days_before DAY) <= ?", [HOLDING, today]],
    ended: ["v.status IN ('ended', 'rejected', 'cancelled')", []],
  }[status] as [string, unknown[]];
  const order = status === "ended" ? "v.updated_at DESC, v.id DESC" : status === "requested" ? "v.created_at, v.id" : "v.expires_on, v.id";
  const rows = await select<VpnLoanRow>(`${VPN_SELECT} WHERE ${where[0]} ORDER BY ${order} LIMIT 500`, where[1]);
  res.json({ data: rows.map((r) => vpnJson(r, u)) });
});

vpnLoanRoutes.get("/vpn-loans/:uuid", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id || managesVpn(u));
  res.json({ data: vpnJson(r, u) });
});

/* ---------------------------------------------------------------- ผู้ใช้ */

/** ขอใช้ VPN { purpose, requested_until } — แจ้งผู้ดูแล */
vpnLoanRoutes.post("/vpn-loans", async (req, res) => {
  const u = me(req);
  const today = localToday();
  const data = await validate(
    req.input,
    { purpose: ["required", "string", "max:2000", regex(/\S/)], requested_until: ["nullable", regex(DATE)] },
    { locale: req.locale },
  );
  const until = typeof data.requested_until === "string" && data.requested_until ? data.requested_until : null;
  if (until && (until < today || until > plusDays(today, MAX_DAYS))) throw ValidationError.withMessages({ requested_until: t(req, "until_range", { days: MAX_DAYS }) });
  if (await first("SELECT 1 AS x FROM vpn_loans WHERE user_id = ? AND status = 'requested'", [u.id])) {
    throw ValidationError.withMessages({ purpose: t(req, "already_requested") });
  }
  const now = nowDb();
  const id = await insert("vpn_loans", {
    uuid: randomUUID(), user_id: u.id, department: u.department, purpose: String(data.purpose).trim(), requested_until: until, status: "requested", created_at: now, updated_at: now,
  });
  const r = await reload(id);
  await audit(req, { action: "vpn_loan.requested", subjectType: "vpn_loan", subjectId: id, after: { purpose: r.purpose, requested_until: until } });
  const ids = (await vpnManagerIds()).filter((x) => x !== u.id);
  if (ids.length) await notifyUsers(ids, "vpn.requested", vpnNotice(r, "requested", u.name, { requested_until: until }));
  res.status(201).json({ data: vpnJson(r, u) });
});

vpnLoanRoutes.post("/vpn-loans/:uuid/cancel", async (req, res) => {
  const u = me(req);
  const r = await findVpn(req);
  authorize(Number(r.user_id) === u.id);
  if (r.status !== "requested") throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const now = nowDb();
  await update("vpn_loans", { status: "cancelled", ended_at: now, ended_by: u.id, updated_at: now }, "id = ?", [r.id]);
  await audit(req, { action: "vpn_loan.cancelled", subjectType: "vpn_loan", subjectId: r.id, before: { status: r.status } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  res.json({ data: vpnJson(await reload(Number(r.id)), u) });
});

/** เปิดดูรหัส VPN ของตัวเอง — ระหว่างยังถือบัญชีและยังไม่หมดอายุ (ยืนยันตัวตนซ้ำ / จำกัด IP ตามหน้าตั้งค่า + บันทึกประวัติ + แจ้งเตือน) */
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
  await assertCanReveal(req, { reauth: Boolean(c.require_reauth) });
  await insert("credential_access_logs", { credential_id: c.id, user_id: u.id, action: "vpn_reveal", ip: req.ip ?? null, created_at: nowDb() });
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
  if (r.status !== "active") throw ValidationError.withMessages({ choice: t(req, "not_active") });
  const data = await validate(
    req.input,
    { choice: ["required", "in:renew,cancel"], renew_until: ["required_if:choice,renew", "nullable", regex(DATE)], reason: ["nullable", "string", "max:2000"] },
    { locale: req.locale },
  );
  const choice = data.choice as "renew" | "cancel";
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
    t(req, "ticket_footer"),
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
    await update(
      "vpn_loans",
      { status: choice === "renew" ? "renewal_requested" : "cancel_requested", renew_until: renewUntil, choice_reason: reason, choice_at: now, ticket_id: created.id, updated_at: now },
      "id = ?",
      [r.id],
    );
    return created;
  });
  await audit(req, { action: `vpn_loan.${choice === "renew" ? "renewal_requested" : "cancel_requested"}`, subjectType: "vpn_loan", subjectId: r.id, after: { renew_until: renewUntil, reason, ticket: ticket.ticket_no } });
  // เลือกแล้ว = แจ้งเตือนใกล้หมดอายุ / หมดอายุหมดหน้าที่
  await markNoticesRead("vpn_id", r.uuid, { events: ["expiring", "expired"] });
  res.json({ data: vpnJson(await reload(Number(r.id)), u), ticket: { id: ticket.uuid, ticket_no: ticket.ticket_no } });
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

/** มอบบัญชี VPN { credential_id, start_on, expires_on, notify_days_before } — คำขอ → ใช้งาน (แจ้งผู้ใช้) */
vpnLoanRoutes.post("/vpn-loans/:uuid/assign", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (r.status !== "requested") throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const data = await periodInput(req, { requireCredential: true });
  const start = String(data.start_on);
  const expires = String(data.expires_on);
  if (expires < start || expires < localToday() || expires > plusDays(start, MAX_DAYS)) throw ValidationError.withMessages({ expires_on: t(req, "expires_range", { days: MAX_DAYS }) });
  const credentialId = int(data.credential_id)!;
  const notifyDays = "notify_days_before" in data ? int(data.notify_days_before)! : 7;
  await transaction(async () => {
    await lockNamed(lockKey(credentialId));
    await assertAccountFree(req, credentialId, Number(r.id));
    const now = nowDb();
    await update(
      "vpn_loans",
      { status: "active", credential_id: credentialId, assigned_by: u.id, assigned_at: now, start_on: start, expires_on: expires, notify_days_before: notifyDays, reminded_for: null, expired_notified_for: null, updated_at: now },
      "id = ?",
      [r.id],
    );
  });
  const after = await reload(Number(r.id));
  await audit(req, { action: "vpn_loan.assigned", subjectType: "vpn_loan", subjectId: r.id, after: { credential_id: credentialId, start_on: start, expires_on: expires, notify_days_before: notifyDays } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  await notifyUsers([Number(r.user_id)], "vpn.assigned", vpnNotice(after, "assigned", u.name));
  res.json({ data: vpnJson(after, u) });
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
  res.json({ data: vpnJson(after, u) });
});

/** ไม่อนุมัติคำขอ { note } */
vpnLoanRoutes.post("/vpn-loans/:uuid/reject", async (req, res) => {
  const u = me(req);
  authorize(managesVpn(u));
  const r = await findVpn(req);
  if (r.status !== "requested") throw ValidationError.withMessages({ status: t(req, "not_requested") });
  const data = await validate(req.input, { note: ["required", "string", "max:2000", regex(/\S/)] }, { locale: req.locale });
  const now = nowDb();
  await update("vpn_loans", { status: "rejected", ended_at: now, ended_by: u.id, end_note: String(data.note).trim(), updated_at: now }, "id = ?", [r.id]);
  const after = await reload(Number(r.id));
  await audit(req, { action: "vpn_loan.rejected", subjectType: "vpn_loan", subjectId: r.id, after: { note: after.end_note } });
  await markNoticesRead("vpn_id", r.uuid, { events: ["requested"] });
  await notifyUsers([Number(r.user_id)], "vpn.rejected", vpnNotice(after, "rejected", u.name, { note: after.end_note }));
  res.json({ data: vpnJson(after, u) });
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
  res.json({ data: vpnJson(after, u) });
});
