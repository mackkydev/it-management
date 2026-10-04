import { tone } from "@/components/ui";
import type { TicketStatus, TicketType } from "@/lib/types";
import type { TFunction } from "@/i18n/types";

/** สีสถานะใบแจ้งงาน — ใช้ token สีสถานะของระบบ (ไม่ชนกับสีธีม) */
const STATUS_STYLE: Record<TicketStatus, { badge: string; dot: string }> = {
  pending_supervisor: tone.warning,
  approved: tone.idle,
  in_progress: tone.info,
  pending_it_head: {
    badge: "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-200",
    dot: "bg-accent-400",
  },
  completed: tone.success,
  rejected: tone.danger,
};

export function TicketStatusBadge({ status, t }: { status: TicketStatus; t: TFunction }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {t(`tickets.statuses.${status}`)}
    </span>
  );
}

/** ชื่อเรื่อง: "อื่นๆ" แสดงสิ่งที่ผู้แจ้งระบุ */
export function ticketSubject(type: TicketType, typeOther: string | null, t: TFunction): string {
  return type === "other" && typeOther ? `${t("tickets.types.other")}: ${typeOther}` : t(`tickets.types.${type}`);
}
