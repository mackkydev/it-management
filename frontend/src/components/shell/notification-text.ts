import type { MessageKey, TFunction } from "@/i18n/types";
import type { AppNotification } from "@/lib/types";

/** ข้อความของการแจ้งเตือน (ใช้ร่วมกันระหว่างกระดิ่งและหน้าต่างหลัง login) */
export function notificationText(n: AppNotification, t: TFunction): string {
  if (n.data.kind === "ticket") {
    return t(`notifications.ticket.${n.data.event}` as MessageKey, { no: n.data.ticket_no, actor: n.data.actor ?? "" });
  }
  return t("notifications.expiring", { count: n.data.count });
}

export const notificationHref = (n: AppNotification) => (n.data.kind === "ticket" ? `/tickets/${n.data.ticket_id}` : "/contracts");
