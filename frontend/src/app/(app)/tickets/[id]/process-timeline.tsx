import { AlertIcon, CheckIcon, XIcon } from "@/components/icons";
import { card, tone } from "@/components/ui";
import type { Formatters, TFunction } from "@/i18n/types";
import type { TicketDetail, TicketStatus } from "@/lib/types";
import { headApprovedAt } from "../ticket-ui";

type StageKey = "submitted" | "approval" | "accepted" | "working" | "review" | "confirm" | "completed";
type State = "done" | "current" | "upcoming" | "failed";

interface Stage {
  key: StageKey;
  state: State;
  label: string;
  who?: string | null;
  at?: string | null;
  note?: string | null;
}

const ORDER: StageKey[] = ["submitted", "approval", "accepted", "working", "review", "confirm", "completed"];

/** สถานะ → ขั้นที่กำลังทำ (index ใน ORDER) */
const CURRENT: Partial<Record<TicketStatus, number>> = {
  pending_supervisor: 1,
  approved: 2,
  in_progress: 3,
  pending_it_head: 4,
  pending_requester: 5,
  completed: 7,
};

/**
 * ไทม์ไลน์ขั้นตอนของใบแจ้งงาน: แจ้งงาน → หัวหน้าอนุมัติ → IT รับงาน → ดำเนินการ → หัวหน้า IT ตรวจรับ → ผู้แจ้งรับงาน → ปิดงาน
 * ไฮไลต์ขั้นที่กำลังดำเนินการ, ไม่อนุมัติ/ยกเลิก = ขั้นนั้นเป็นสีแดง, รอยกเลิก = แถบแจ้งเหตุผล
 */
export function ProcessTimeline({ tk, t, fmt }: { tk: TicketDetail; t: TFunction; fmt: Formatters }) {
  // ระหว่างรอยกเลิก/ยกเลิกแล้ว ใช้สถานะก่อนขอยกเลิกเป็นตำแหน่งในไทม์ไลน์
  const base: TicketStatus = tk.status === "pending_cancel" || tk.status === "cancelled" ? (tk.cancel_requested_status ?? "approved") : tk.status;
  const current = tk.status === "rejected" ? 1 : (CURRENT[base] ?? 1);
  const progressCount = tk.events.filter((e) => e.action === "progress").length;
  const confirmed = tk.events.find((e) => e.action === "confirmed");
  const waitingApprovers = tk.approval_steps.find((s) => s.step_no === tk.current_step)?.approvers.map((a) => a.name).join(", ");

  const info: Record<StageKey, Pick<Stage, "who" | "at" | "note">> = {
    submitted: { who: tk.requester?.name, at: tk.requested_at },
    approval: {
      who: tk.approver?.name ?? null,
      at: tk.approved_at,
      note: tk.status === "pending_supervisor" && waitingApprovers ? t("tickets.timeline.waitingFor", { name: waitingApprovers }) : null,
    },
    accepted: { who: tk.assignee?.name ?? null, at: tk.accepted_at },
    working: { who: tk.assignee?.name ?? null, at: tk.resulted_at, note: progressCount ? t("tickets.timeline.updates", { count: progressCount }) : null },
    review: { who: tk.it_head?.name ?? null, at: headApprovedAt(tk) },
    // ใบเดิมที่หัวหน้า IT ปิดงานเอง (ไม่มีเหตุการณ์ confirmed) ไม่มีผู้รับงาน
    confirm: { who: confirmed ? tk.requester?.name : null, at: confirmed?.created_at ?? null },
    completed: { at: tk.status === "completed" ? tk.closed_at : null },
  };

  const stages: Stage[] = ORDER.map((key, i) => {
    let state: State = i < current ? "done" : i === current ? "current" : "upcoming";
    if (tk.status === "rejected" && i === 1) state = "failed";
    if (tk.status === "cancelled" && i === current) state = "failed";
    if (tk.status === "completed") state = "done";
    const label = state === "failed" ? (tk.status === "rejected" ? t("tickets.timeline.rejected") : t("tickets.timeline.cancelled")) : t(`tickets.timeline.${key}`);
    return { key, state, label, ...info[key], ...(state === "upcoming" ? { who: null, at: null, note: null } : {}) };
  });
  // ไม่อนุมัติ / ยกเลิก: ขั้นหลังจากนั้นจะไม่เกิดขึ้น — ไม่แสดง
  const failedAt = stages.findIndex((s) => s.state === "failed");
  const visible = failedAt >= 0 ? stages.slice(0, failedAt + 1) : stages;

  const dot = (s: State) =>
    s === "done" ? tone.success.badge : s === "failed" ? tone.danger.badge : s === "current" ? "bg-accent-500 text-white ring-4 ring-accent-200 dark:ring-accent-400/30" : tone.idle.badge;

  return (
    <section className={`p-4 sm:p-6 print:hidden ${card}`} aria-label={t("tickets.timeline.title")}>
      <h2 className="mb-4 text-sm font-semibold">{t("tickets.timeline.title")}</h2>
      <ol className="flex flex-col gap-4 md:flex-row md:gap-0">
        {visible.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 md:flex-1 md:flex-col md:items-center md:gap-2 md:text-center">
            {/* เส้นเชื่อม */}
            {i < visible.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[15px] top-8 h-[calc(100%-8px)] w-0.5 md:left-[calc(50%+18px)] md:top-[15px] md:h-0.5 md:w-[calc(100%-36px)] ${s.state === "done" ? "bg-success-300 dark:bg-success-400/40" : "bg-line"}`}
              />
            )}
            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${dot(s.state)}`} aria-current={s.state === "current" ? "step" : undefined}>
              {s.state === "done" ? <CheckIcon width={15} height={15} /> : s.state === "failed" ? <XIcon width={15} height={15} /> : i + 1}
            </span>
            <div className="min-w-0 md:px-1">
              <p className={`text-sm font-medium ${s.state === "upcoming" ? "text-faint" : s.state === "failed" ? "text-danger-600 dark:text-danger-300" : "text-ink"}`}>{s.label}</p>
              {s.state === "current" && <p className="text-xs font-medium text-accent-600 dark:text-accent-300">{t("tickets.timeline.now")}</p>}
              {s.who && <p className="truncate text-xs text-muted">{s.who}</p>}
              {s.at && <p className="text-xs text-faint">{fmt.dateTime(s.at)}</p>}
              {s.note && <p className="text-xs text-muted">{s.note}</p>}
            </div>
          </li>
        ))}
      </ol>

      {(tk.status === "pending_cancel" || tk.status === "cancelled") && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${tk.status === "pending_cancel" ? tone.danger.badge : tone.idle.badge}`}>
          <AlertIcon className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              {tk.status === "pending_cancel" ? t("tickets.timeline.cancelPending") : t("tickets.timeline.cancelled")}
              {tk.status === "cancelled" && tk.cancelled_by && ` · ${tk.cancelled_by.name}`}
              {tk.status === "cancelled" && tk.cancelled_at && ` · ${fmt.dateTime(tk.cancelled_at)}`}
            </p>
            {tk.cancel_reason && <p className="mt-0.5">{t("tickets.timeline.cancelReason", { reason: tk.cancel_reason })}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
