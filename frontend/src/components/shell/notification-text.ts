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
  return t("notifications.expiring", { count: n.data.count });
}

export function notificationHref(n: AppNotification): string {
  if (n.data.kind === "ticket") return `/tickets/${n.data.ticket_id}`;
  // รหัสผ่านในคลังบัญชี → หน้าแก้ไขที่มีประวัติการเปิดดู / License key → หน้าสินทรัพย์
  if (n.data.kind === "secret_revealed") return n.data.secret === "vault" ? `/vault/${n.data.subject_id}/edit` : `/assets/${n.data.subject_id}`;
  return "/contracts";
}
