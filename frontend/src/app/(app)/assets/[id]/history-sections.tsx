import Link from "next/link";
import type { ReactNode } from "react";
import { UserIcon, UsersIcon, WrenchIcon } from "@/components/icons";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { AssetRepair, AssetUserLog } from "@/lib/types";
import { TicketStatusBadge } from "../../tickets/ticket-ui";

function Header({ icon, title, count }: { icon: ReactNode; title: string; count: string }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">{icon}</span>
      {title}
      <span className="text-sm font-normal text-muted">{count}</span>
    </h2>
  );
}

/** แถว "ชื่อ: ค่า" ในรายการซ่อม */
function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex flex-wrap gap-x-1.5 text-sm">
      <span className="text-muted">{label}:</span>
      <span className="min-w-0 whitespace-pre-line text-ink">{children}</span>
    </div>
  );
}

/** ประวัติการซ่อม — ใบแจ้งซ่อมที่ผูกกับสินทรัพย์นี้ (ไม่รวมใบที่ยกเลิก/ไม่อนุมัติ) */
export async function RepairHistory({ id }: { id: string }) {
  const [{ data }, { t, fmt }] = await Promise.all([apiFetch<{ data: AssetRepair[] }>(`/assets/${id}/repairs`), getI18n()]);
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <Header icon={<WrenchIcon width={15} height={15} />} title={t("assets.repairs.title")} count={t("movements.count", { count: fmt.number(data.length) })} />
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t("assets.repairs.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="space-y-1.5 rounded-xl p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/tickets/${r.id}`} className="cursor-pointer font-mono text-sm font-medium text-accent-700 dark:text-accent-300">
                  {r.ticket_no}
                </Link>
                <TicketStatusBadge status={r.status} t={t} />
                <time dateTime={r.requested_at} className="text-sm text-muted">
                  {fmt.date(r.requested_at)}
                </time>
              </div>
              <Row label={t("assets.repairs.symptom")}>{r.symptom}</Row>
              <Row label={t("tickets.result.outcome")}>
                {r.result === "completed"
                  ? `${t("tickets.result.completed")}${r.completed_on ? ` (${fmt.date(r.completed_on)})` : ""}`
                  : r.result === "cannot_complete"
                    ? `${t("tickets.result.cannot")}${r.cannot_reason ? ` — ${r.cannot_reason}` : ""}`
                    : null}
              </Row>
              <Row label={t("tickets.result.method")}>
                {r.repair_method === "in_house"
                  ? t("tickets.result.inHouse")
                  : r.repair_method === "external"
                    ? `${t("tickets.result.external")}${r.external_vendor ? ` (${r.external_vendor})` : ""}`
                    : null}
              </Row>
              <Row label={t("tickets.result.warranty")}>
                {r.warranty === "in_warranty" ? t("tickets.result.inWarranty") : r.warranty === "out_of_warranty" ? t("tickets.result.outOfWarranty") : null}
              </Row>
              <Row label={t("tickets.result.details")}>{r.repair_details}</Row>
              <Row label={t("tickets.result.parts")}>{r.parts.length ? r.parts.map((p) => `${p.name} × ${fmt.number(p.quantity)}`).join(", ") : null}</Row>
              <p className="text-xs text-faint">
                {[r.requester && t("assets.repairs.requester", { name: r.requester }), r.assignee && t("assets.repairs.assignee", { name: r.assignee })].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SOURCE_TONE: Record<AssetUserLog["source"], string> = { create: tone.success.badge, edit: tone.info.badge, import: tone.warning.badge };

/** "จาก → ไป" ของช่องข้อความ — แสดงเฉพาะเมื่อค่าเปลี่ยน */
function Change({ icon, label, from, to, none }: { icon: ReactNode; label: string; from: string | null; to: string | null; none: string }) {
  if (from === to) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      <span className="flex items-center gap-1 text-muted">
        {icon}
        {label}:
      </span>
      {from !== null && (
        <>
          <span className="text-muted line-through decoration-faint">{from}</span>
          <span className="text-accent-400" aria-hidden="true">
            →
          </span>
        </>
      )}
      <span className="font-medium text-ink">{to ?? none}</span>
    </div>
  );
}

/** ประวัติผู้ใช้งาน — การเปลี่ยน "ชื่อ-สกุลผู้ใช้งาน" / Department ของทะเบียนคอมพิวเตอร์ */
export async function UserHistory({ id }: { id: string }) {
  const [{ data }, { t, fmt }] = await Promise.all([apiFetch<{ data: AssetUserLog[] }>(`/assets/${id}/user-logs`), getI18n()]);
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <Header icon={<UsersIcon width={15} height={15} />} title={t("assets.userLogs.title")} count={t("movements.count", { count: fmt.number(data.length) })} />
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t("assets.userLogs.empty")}</p>
      ) : (
        <ol className="relative space-y-5 border-l-2 border-accent-100 pl-6 dark:border-accent-400/20">
          {data.map((l) => (
            <li key={l.id} className="relative">
              <span className={`absolute -left-[37px] top-0 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-surface ${SOURCE_TONE[l.source]}`}>
                <UserIcon width={14} height={14} />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SOURCE_TONE[l.source]}`}>{t(`assets.userLogs.sources.${l.source}`)}</span>
                <time dateTime={l.changed_at} className="text-sm text-muted">
                  {fmt.dateTime(l.changed_at)}
                </time>
              </div>
              <div className="mt-1.5 space-y-1">
                <Change icon={<UserIcon width={13} height={13} />} label={t("assets.computer.userName")} from={l.source === "create" ? null : l.from_user_name} to={l.to_user_name} none={t("common.none")} />
                <Change icon={<UsersIcon width={13} height={13} />} label={t("assets.computer.department")} from={l.source === "create" ? null : l.from_department} to={l.to_department} none={t("common.none")} />
                {l.performed_by && <p className="mt-1 text-xs text-faint">{t("movements.by", { name: l.performed_by.name })}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
