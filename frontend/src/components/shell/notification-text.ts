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
  return "/contracts";
}
