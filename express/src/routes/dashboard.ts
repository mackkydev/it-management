import { Router } from "express";
import { scalar, select } from "../db.js";
import { config } from "../config.js";
import { dateOnly, iso, localToday } from "../lib/time.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { kpiPendingCount } from "../services/kpi.js";
import { leaveSettings } from "../services/calendar.js";
import { PRE_APPROVAL } from "../services/ticket-workflow.js";
import { balanceOf } from "./calendar.js";
import { approvalsWhere } from "./tickets.js";

/**
 * GET /dashboard — ภาพรวมของผู้ใช้ที่ login (หน้า Dashboard): ใบแจ้งงานของฉัน, งานรออนุมัติ, งานฝ่าย IT (it_tickets.queue),
 * การจองห้องประชุม/รถที่กำลังจะถึง, การยืมอุปกรณ์/VPN ที่ถืออยู่, ใบลา — เฉพาะข้อมูลของตัวเอง
 */
export const dashboardRoutes = Router();

dashboardRoutes.get("/dashboard", async (req, res) => {
  const u = me(req);
  const today = localToday(config.localTimezone);
  const count = async (sql: string, params: unknown[]) => Number(await scalar(sql, params));

  // ใบแจ้งงานที่ฉันแจ้ง
  const byStatus = await select<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM it_tickets WHERE requester_id = ? AND source IS NULL GROUP BY status", [u.id]);
  const statusCount = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
  // ใบแจ้งงานล่าสุด: ฝ่าย IT (it_tickets.queue) = ทุกใบของฝ่าย (หลังอนุมัติ — it_tickets.manage_all = ทุกใบ) / คนอื่น = ใบที่ฉันแจ้ง
  const allRecent = can(u, "it_tickets.queue");
  const recentWhere = allRecent
    ? can(u, "it_tickets.manage_all")
      ? "1 = 1"
      : `t.status NOT IN (${PRE_APPROVAL.map((x) => `'${x}'`).join(", ")})`
    : "t.requester_id = ?";
  const recent = await select<{
    uuid: string; ticket_no: string; type: string; type_other: string | null; status: string; requested_at: string; requester: string | null; assignee: string | null;
  }>(
    `SELECT t.uuid, t.ticket_no, t.type, t.type_other, t.status, t.requested_at, r.name AS requester, a.name AS assignee
       FROM it_tickets t LEFT JOIN users r ON r.id = t.requester_id LEFT JOIN users a ON a.id = t.assignee_id
      WHERE ${recentWhere} ORDER BY t.id DESC LIMIT 5`,
    allRecent ? [] : [u.id],
  );
  const ap = approvalsWhere(u);
  const approvals = await count(`SELECT COUNT(*) FROM it_tickets t WHERE ${ap.sql}`, ap.params);

  // งานฝ่าย IT ของฉัน (ผู้รับงาน / ผู้ร่วมดำเนินการ)
  let it: Record<string, number> | null = null;
  if (can(u, "it_tickets.queue")) {
    // ใบที่ฉันเป็นผู้รับงาน ∪ ผู้ร่วมดำเนินการ — UNION แทน OR + EXISTS ให้แต่ละส่วนใช้ index (assignee_id + status / it_ticket_helpers.user_id)
    const mine = (cond: string, condParams: unknown[] = []) =>
      count(
        `SELECT COUNT(*) FROM (
           SELECT t.id FROM it_tickets t WHERE t.assignee_id = ? AND t.source IS NULL AND ${cond}
           UNION
           SELECT t.id FROM it_ticket_helpers h JOIN it_tickets t ON t.id = h.it_ticket_id WHERE h.user_id = ? AND t.source IS NULL AND ${cond}
         ) x`,
        [u.id, ...condParams, u.id, ...condParams],
      );
    // เดือนนี้ (completed_on เป็นวันที่ท้องถิ่น) — ช่วงวันที่แทน DATE_FORMAT เพื่อใช้ index ได้
    const monthStart = `${today.slice(0, 7)}-01`;
    const next = new Date(`${monthStart}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    it = {
      waiting: await count("SELECT COUNT(*) FROM it_tickets t WHERE t.status = 'approved' AND t.assignee_id = ? AND t.source IS NULL", [u.id]),
      in_progress: await mine("t.status = 'in_progress'"),
      review: await mine("t.status = 'pending_it_head'"),
      done_month: await mine("t.status IN ('pending_requester', 'completed') AND t.completed_on >= ? AND t.completed_on < ?", [monthStart, next.toISOString().slice(0, 10)]),
      kpi_pending: can(u, "kpi.use") ? await kpiPendingCount(u.id) : 0,
    };
  }

  // การจองที่กำลังจะถึง (ยังไม่จบ)
  const meetings = await select<{ uuid: string; title: string; room: string; booking_date: string; end_date: string | null; start_time: string; end_time: string }>(
    `SELECT m.uuid, m.title, r.name AS room, m.booking_date, m.end_date, m.start_time, m.end_time
       FROM meeting_bookings m JOIN meeting_rooms r ON r.id = m.room_id
      WHERE m.user_id = ? AND m.status = 'confirmed' AND m.deleted_at IS NULL AND COALESCE(m.end_date, m.booking_date) >= ?
      ORDER BY m.booking_date, m.start_time LIMIT 5`,
    [u.id, today],
  );
  const vehicles = await select<{ uuid: string; status: string; vehicle: string | null; plate: string | null; start_on: string; start_time: string; end_on: string; end_time: string }>(
    `SELECT b.uuid, b.status, v.name AS vehicle, v.plate_no AS plate, b.start_on, b.start_time, b.end_on, b.end_time
       FROM vehicle_bookings b LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE b.user_id = ? AND b.status IN ('pending', 'confirmed') AND b.deleted_at IS NULL AND b.end_on >= ?
      ORDER BY b.start_on, b.start_time LIMIT 5`,
    [u.id, today],
  );
  const loans = await select<{ uuid: string; status: string; asset: string; asset_tag: string; start_on: string; end_on: string; end_time: string }>(
    `SELECT l.uuid, l.status, a.name AS asset, a.asset_tag, l.start_on, l.end_on, l.end_time
       FROM equipment_loans l JOIN assets a ON a.id = l.asset_id
      WHERE l.user_id = ? AND l.status IN ('reserved', 'on_loan') ORDER BY l.start_on LIMIT 5`,
    [u.id],
  );
  const vpn = await select<{ uuid: string; status: string; expires_on: string | null; requested_until: string | null }>(
    "SELECT uuid, status, expires_on, requested_until FROM vpn_loans WHERE user_id = ? AND status IN ('requested', 'active', 'renewal_requested', 'cancel_requested') ORDER BY id DESC LIMIT 3",
    [u.id],
  );
  const leaves = await select<{ uuid: string; leave_type: string; unit: string; start_on: string; end_on: string; days: string; status: string }>(
    "SELECT uuid, leave_type, unit, start_on, end_on, days, status FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'approved') AND end_on >= ? ORDER BY start_on LIMIT 5",
    [u.id, today],
  );

  res.json({
    data: {
      tickets: {
        open: Object.entries(statusCount).filter(([s]) => !["completed", "rejected", "cancelled"].includes(s)).reduce((n, [, c]) => n + c, 0),
        // รอฉันดำเนินการ = เลือกผู้อนุมัติตามที่ฝ่าย IT ขอ + ใบที่รอฉันอนุมัติ / รอฉันปิดงาน = กดรับงานเพื่อปิดงาน (ผู้แจ้ง)
        waiting_me: (statusCount.approval_requested ?? 0) + approvals,
        to_close: statusCount.pending_requester ?? 0,
        completed: statusCount.completed ?? 0,
        by_status: statusCount,
        recent_scope: allRecent ? "all" : "mine",
        recent: recent.map((t) => ({
          id: t.uuid, ticket_no: t.ticket_no, type: t.type, type_other: t.type_other, status: t.status, requested_at: iso(t.requested_at), requester: t.requester, assignee: t.assignee,
        })),
      },
      approvals,
      it,
      meetings: meetings.map((m) => ({ id: m.uuid, title: m.title, room: m.room, date: dateOnly(m.booking_date), end_date: dateOnly(m.end_date ?? m.booking_date), start_time: m.start_time, end_time: m.end_time })),
      vehicles: vehicles.map((v) => ({ id: v.uuid, status: v.status, vehicle: v.vehicle, plate: v.plate, start_on: dateOnly(v.start_on), start_time: v.start_time, end_on: dateOnly(v.end_on), end_time: v.end_time })),
      loans: loans.map((l) => ({ id: l.uuid, status: l.status, asset: l.asset, asset_tag: l.asset_tag, start_on: dateOnly(l.start_on), end_on: dateOnly(l.end_on), end_time: l.end_time })),
      vpn: vpn.map((v) => ({ id: v.uuid, status: v.status, until: dateOnly(v.expires_on ?? v.requested_until) })),
      // วันลาปีนี้ต่อประเภท (โควตา / ใช้ไป / รออนุมัติ / คงเหลือ — null = ไม่จำกัด)
      leave_balance: await balanceOf(u.id, Number(today.slice(0, 4)), await leaveSettings()),
      leaves: leaves.map((l) => ({ id: l.uuid, leave_type: l.leave_type, unit: l.unit, start_on: dateOnly(l.start_on), end_on: dateOnly(l.end_on), days: Number(l.days), status: l.status })),
    },
  });
});
