import type { MessageKey, TFunction } from "@/i18n/types";
import type { AppNotification } from "@/lib/types";

/** ข้อความของการแจ้งเตือน (ใช้ร่วมกันระหว่างกระดิ่งและหน้าต่างหลัง login) */
export function notificationText(n: AppNotification, t: TFunction): string {
  if (n.data.kind === "ticket") {
    return t(`notifications.ticket.${n.data.event}` as MessageKey, { no: n.data.ticket_no, actor: n.data.actor ?? "" });
  }
  if (n.data.kind === "secret_revealed") {
    return t(n.data.secret === "vault" ? "notifications.secretVault" : "notifications.secretLicense", { actor: n.data.actor, title: n.data.title });
  }
  if (n.data.kind === "access_changed") {
    return t(`notifications.access.${n.data.change}` as MessageKey, { actor: n.data.actor, subject: n.data.subject });
  }
  if (n.data.kind === "leave") {
    const period = n.data.start_on === n.data.end_on ? n.data.start_on : `${n.data.start_on} – ${n.data.end_on}`;
    return t(`notifications.leave.${n.data.event}` as MessageKey, { actor: n.data.actor, type: t(`leave.types.${n.data.leave_type}` as MessageKey), period, owner: n.data.owner ?? "" });
  }
  if (n.data.kind === "vehicle") {
    const d = n.data;
    const period = d.start_on === d.end_on ? `${d.start_on} ${d.start_time}–${d.end_time}` : `${d.start_on} ${d.start_time} – ${d.end_on} ${d.end_time}`;
    return t(`notifications.vehicle.${d.event}` as MessageKey, { actor: d.actor, vehicle: d.vehicle ?? "", period });
  }
  if (n.data.kind === "loan") {
    const d = n.data;
    const period = d.start_on === d.end_on ? `${d.start_on} ${d.start_time}–${d.end_time}` : `${d.start_on} ${d.start_time} – ${d.end_on} ${d.end_time}`;
    return t(`notifications.loan.${d.event}` as MessageKey, { actor: d.actor ?? "", device: d.device, period, end: `${d.end_on} ${d.end_time}` });
  }
  if (n.data.kind === "meeting") {
    const d = n.data;
    return t(`notifications.meeting.${d.event}` as MessageKey, { actor: d.actor, room: d.room, title: d.title, date: d.date, start: d.start_time, end: d.end_time });
  }
  return t("notifications.expiring", { count: n.data.count });
}

export function notificationHref(n: AppNotification): string {
  if (n.data.kind === "ticket") return `/tickets/${n.data.ticket_id}`;
  // รหัสผ่านในคลังบัญชี → หน้าแก้ไขที่มีประวัติการเปิดดู / License key → หน้าสินทรัพย์
  if (n.data.kind === "secret_revealed") return n.data.secret === "vault" ? `/vault/${n.data.subject_id}/edit` : `/assets/${n.data.subject_id}`;
  // การเปลี่ยนสิทธิ์ → หน้าสิทธิ์ของผู้ใช้ / หน้าสิทธิ์ตามกลุ่ม · PIN กลาง → คลังบัญชี (ฟอร์ม PIN)
  if (n.data.kind === "access_changed") {
    if (n.data.change === "user") return `/users/${n.data.subject_id}/permissions`;
    return n.data.change === "pin" ? "/vault" : "/role-permissions";
  }
  // ใบลา: ส่งมาให้อนุมัติ → หน้ารออนุมัติลา, ผลการอนุมัติ → ใบลาของฉัน
  if (n.data.kind === "leave") return n.data.event === "submitted" ? "/leave/approvals" : `/leave?open=${n.data.leave_id}`;
  // จองรถ: รอจัดรถ → หน้าจัดคิวรถ, อื่นๆ → การจองรถของฉัน
  if (n.data.kind === "vehicle") {
    if (n.data.event === "requested") return "/vehicles/dispatch";
    return n.data.event === "cancelled" ? "/vehicles/mine?status=cancelled" : "/vehicles/mine";
  }
  // ยืมอุปกรณ์: รอส่งมอบ → หน้าส่งมอบ/รับคืน, เกินกำหนด → ผู้จัดการไปแท็บเกินกำหนด (ผู้ยืมไปการยืมของฉัน — ลิงก์เดียวกัน redirect ตามสิทธิ์), อื่นๆ → การยืมของฉัน
  if (n.data.kind === "loan") {
    if (n.data.event === "requested") return "/loans/manage?status=pending";
    if (n.data.event === "cancelled") return "/loans/mine?status=cancelled";
    if (n.data.event === "returned") return "/loans/mine?status=past";
    return "/loans/mine";
  }
  // การจองห้องประชุมที่ผู้จัดการแก้/ยกเลิก/ลบ → การจองของฉัน (ยกเลิก = แท็บยกเลิกแล้ว)
  if (n.data.kind === "meeting") return n.data.event === "cancelled" ? "/meeting-rooms/mine?status=cancelled" : "/meeting-rooms/mine";
  return "/contracts";
}
