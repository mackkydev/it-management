import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  BoxIcon, CalendarIcon, CarIcon, ChartIcon, CheckCircleIcon, ClipboardIcon, GaugeIcon, InboxIcon, KeyIcon, MeetingRoomIcon, UserIcon, WrenchIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { TicketStatus, TicketType } from "@/lib/types";
import { TicketStatusBadge, ticketSubject } from "../tickets/ticket-ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("dashboard.title") };
}

interface Dashboard {
  tickets: {
    open: number;
    waiting_me: number;
    to_close: number;
    completed: number;
    recent_scope: "all" | "mine";
    recent: { id: string; ticket_no: string; type: TicketType; type_other: string | null; status: TicketStatus; requested_at: string; requester: string | null; assignee: string | null }[];
  };
  approvals: number;
  it: { waiting: number; in_progress: number; review: number; done_month: number; kpi_pending: number } | null;
  meetings: { id: string; title: string; room: string; date: string; end_date: string; start_time: string; end_time: string }[];
  vehicles: { id: string; status: string; vehicle: string | null; plate: string | null; start_on: string; start_time: string; end_on: string; end_time: string }[];
  loans: { id: string; status: string; asset: string; asset_tag: string; start_on: string; end_on: string; end_time: string }[];
  vpn: { id: string; status: string; until: string | null }[];
  leave_balance: { type: string; quota: number | null; approved: number; pending: number; remaining: number | null }[];
  leaves: { id: string; leave_type: string; unit: string; start_on: string; end_on: string; days: number; status: string }[];
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** โทนพาสเทลของกล่อง (token สีสถานะ / สีธีม — จางลงในโหมดมืด) */
const PASTEL = {
  accent: { box: "bg-accent-50 ring-accent-100 dark:bg-accent-400/[0.07] dark:ring-accent-400/15", chip: "bg-accent-100 text-accent-700 dark:bg-accent-400/15 dark:text-accent-300" },
  info: { box: "bg-info-50 ring-info-100 dark:bg-info-400/[0.07] dark:ring-info-400/15", chip: "bg-info-100 text-info-700 dark:bg-info-400/15 dark:text-info-300" },
  success: { box: "bg-success-50 ring-success-100 dark:bg-success-400/[0.07] dark:ring-success-400/15", chip: "bg-success-100 text-success-700 dark:bg-success-400/15 dark:text-success-300" },
  warning: { box: "bg-warning-50 ring-warning-100 dark:bg-warning-400/[0.07] dark:ring-warning-400/15", chip: "bg-warning-100 text-warning-700 dark:bg-warning-400/15 dark:text-warning-300" },
  danger: { box: "bg-danger-50 ring-danger-100 dark:bg-danger-400/[0.07] dark:ring-danger-400/15", chip: "bg-danger-100 text-danger-700 dark:bg-danger-400/15 dark:text-danger-300" },
  idle: { box: "bg-idle-50 ring-idle-100 dark:bg-idle-400/[0.07] dark:ring-idle-400/15", chip: "bg-idle-100 text-idle-700 dark:bg-idle-400/15 dark:text-idle-300" },
} as const;
type Pastel = keyof typeof PASTEL;

/** ตัวเลขสรุป (กล่องสีพาสเทล) — คลิกไปหน้าที่เกี่ยวข้อง */
function Stat({ href, label, value, icon: Icon, color }: { href: string; label: string; value: number; icon: Icon; color: Pastel }) {
  return (
    <Link href={href} className={`group flex cursor-pointer items-center gap-3 rounded-2xl p-4 ring-1 transition hover:brightness-[0.98] hover:shadow-sm ${PASTEL[color].box}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${PASTEL[color].chip}`}>
        <Icon width={20} height={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        <span className="block truncate text-xs text-muted group-hover:text-ink">{label}</span>
      </span>
    </Link>
  );
}

/** กล่องรายการ (พื้นปกติ — สีพาสเทลเฉพาะไอคอน) ว่าง = ข้อความ พร้อมลิงก์ "ดูทั้งหมด" */
function Panel({ title, icon: Icon, href, more, empty, color, children }: { title: string; icon: Icon; href: string; more: string; empty: string; color: Pastel; children: ReactNode[] }) {
  return (
    <section className={`flex flex-col p-4 sm:p-5 ${card}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <span className={`grid h-7 w-7 place-items-center rounded-lg ${PASTEL[color].chip}`}>
            <Icon width={15} height={15} />
          </span>
          {title}
        </h3>
        <Link href={href} className="cursor-pointer text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
          {more}
        </Link>
      </div>
      {children.length ? <ul className="divide-y divide-line">{children}</ul> : <p className="py-4 text-center text-sm text-muted">{empty}</p>}
    </section>
  );
}

/** หัวข้อของแต่ละกลุ่ม */
function Group({ title, icon: Icon, children }: { title: string; icon: Icon; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon width={18} height={18} className="text-accent-500" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * ภาพรวม (GET /dashboard) — 3 หัวข้อ:
 *   งานฝ่าย IT (ใบแจ้งงาน + งานที่รอฉัน + งานของเจ้าหน้าที่ IT + ใบแจ้งงานล่าสุด + อุปกรณ์ที่ยืม/VPN) · การจอง (ห้องประชุม / รถ) · สรุปข้อมูลส่วนบุคคล (วันลา)
 *   สีพื้นพาสเทลเฉพาะกล่องตัวเลขสรุป (Stat) — กล่องรายการพื้นปกติ
 */
export default async function DashboardPage() {
  const [{ data: d }, user, { t, fmt }] = await Promise.all([apiFetch<{ data: Dashboard }>("/dashboard"), getCurrentUser(), getI18n()]);
  const range = (from: string, to: string) => (from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`);
  const row = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm";
  const isIt = Boolean(d.it);
  const waitingHref = d.approvals > 0 ? "/tickets/approvals" : "/tickets?mine=1&status=approval_requested";

  return (
    <div className="space-y-7">
      <PageHeader icon={GaugeIcon} title={t("dashboard.title")} subtitle={t("dashboard.subtitle", { name: user.name })} />

      {/* งานฝ่าย IT — ใบแจ้งงานของฉัน / งานที่รอฉัน (+ งานของเจ้าหน้าที่ IT) + ใบแจ้งงานล่าสุด + อุปกรณ์ที่ยืม/VPN */}
      <Group title={t("dashboard.sectionIt")} icon={WrenchIcon}>
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${isIt ? "lg:grid-cols-4 xl:grid-cols-7" : "lg:grid-cols-4"}`}>
          {!isIt && <Stat href="/tickets?mine=1" label={t("dashboard.ticketsOpen")} value={d.tickets.open} icon={ClipboardIcon} color="info" />}
          <Stat href={waitingHref} label={t("dashboard.ticketsWaitingMe")} value={d.tickets.waiting_me} icon={InboxIcon} color="warning" />
          <Stat href="/tickets?mine=1&status=pending_requester" label={t("dashboard.toClose")} value={d.tickets.to_close} icon={CheckCircleIcon} color="danger" />
          <Stat href="/tickets?mine=1&status=completed" label={t("dashboard.ticketsCompleted")} value={d.tickets.completed} icon={CheckCircleIcon} color="success" />
          {d.it && (
            <>
              <Stat href="/it/tickets?status=approved" label={t("dashboard.itWaiting")} value={d.it.waiting} icon={InboxIcon} color="accent" />
              <Stat href="/it/tickets?status=in_progress" label={t("dashboard.itInProgress")} value={d.it.in_progress} icon={WrenchIcon} color="info" />
              <Stat href="/it/tickets?status=pending_it_head" label={t("dashboard.itReview")} value={d.it.review} icon={ClipboardIcon} color="idle" />
              <Stat href="/kpi" label={t("dashboard.kpiPending")} value={d.it.kpi_pending} icon={ChartIcon} color="warning" />
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title={t(d.tickets.recent_scope === "all" ? "dashboard.recentAll" : "dashboard.recentTickets")}
            icon={ClipboardIcon}
            href={d.tickets.recent_scope === "all" ? "/tickets/all" : "/tickets?mine=1"}
            more={t("dashboard.viewAll")}
            empty={t("dashboard.noTickets")}
            color="info"
          >
            {d.tickets.recent.map((tk) => (
              <li key={tk.id} className={row}>
                <Link href={`/tickets/${tk.id}`} className="min-w-0 cursor-pointer hover:underline">
                  <span className="font-mono text-xs text-accent-700 dark:text-accent-300">{tk.ticket_no}</span>
                  <span className="block truncate">{ticketSubject(tk.type, tk.type_other, t)}</span>
                  {d.tickets.recent_scope === "all" && (
                    <span className="block truncate text-xs text-muted">
                      {tk.requester ?? "-"}
                      {tk.assignee ? ` → ${tk.assignee}` : ""}
                    </span>
                  )}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-faint">{fmt.date(tk.requested_at)}</span>
                  <TicketStatusBadge status={tk.status} t={t} />
                </span>
              </li>
            ))}
          </Panel>

          <Panel title={t("dashboard.loans")} icon={BoxIcon} href="/loans/mine" more={t("dashboard.viewAll")} empty={t("dashboard.noLoans")} color="accent">
            {[
              ...d.loans.map((l) => (
                <li key={l.id} className={row}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.asset}</span>
                    <span className="block font-mono text-xs text-muted">{l.asset_tag}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {t("dashboard.returnBy", { date: `${fmt.date(l.end_on)} ${l.end_time}` })}
                    <span className={`rounded-full px-2 py-0.5 font-medium ${l.status === "on_loan" ? tone.info.badge : tone.warning.badge}`}>{t(`dashboard.loanStatus.${l.status}` as MessageKey)}</span>
                  </span>
                </li>
              )),
              ...d.vpn.map((v) => (
                <li key={v.id} className={row}>
                  <span className="flex items-center gap-2 font-medium">
                    <KeyIcon width={14} height={14} className="text-accent-500" />
                    VPN
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {v.until && t("dashboard.vpnUntil", { date: fmt.date(v.until) })}
                    <span className={`rounded-full px-2 py-0.5 font-medium ${v.status === "active" ? tone.success.badge : tone.warning.badge}`}>{t(`dashboard.vpnStatus.${v.status}` as MessageKey)}</span>
                  </span>
                </li>
              )),
            ]}
          </Panel>
        </div>
      </Group>

      {/* การจอง — ห้องประชุม / รถ ที่กำลังจะถึง */}
      <Group title={t("dashboard.sectionBooking")} icon={CalendarIcon}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title={t("dashboard.meetings")} icon={MeetingRoomIcon} href="/meeting-rooms/mine" more={t("dashboard.viewAll")} empty={t("dashboard.noMeetings")} color="success">
            {d.meetings.map((m) => (
              <li key={m.id} className={row}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="block text-xs text-muted">{m.room}</span>
                </span>
                <span className="text-xs text-muted">
                  {range(m.date, m.end_date)} · {m.start_time}–{m.end_time}
                </span>
              </li>
            ))}
          </Panel>

          <Panel title={t("dashboard.vehicles")} icon={CarIcon} href="/vehicles/mine" more={t("dashboard.viewAll")} empty={t("dashboard.noVehicles")} color="warning">
            {d.vehicles.map((v) => (
              <li key={v.id} className={row}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{v.vehicle ? `${v.vehicle}${v.plate ? ` (${v.plate})` : ""}` : t("dashboard.vehicleUnassigned")}</span>
                  <span className="block text-xs text-muted">
                    {range(v.start_on, v.end_on)} · {v.start_time}–{v.end_time}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.status === "confirmed" ? tone.success.badge : tone.warning.badge}`}>
                  {t(`dashboard.vehicleStatus.${v.status}` as MessageKey)}
                </span>
              </li>
            ))}
          </Panel>
        </div>
      </Group>

      {/* สรุปข้อมูลส่วนบุคคล — วันลาคงเหลือปีนี้ + วันลาที่กำลังจะถึง */}
      <Group title={t("dashboard.sectionPersonal")} icon={UserIcon}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={`p-4 sm:p-5 ${card}`}>
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <span className={`grid h-7 w-7 place-items-center rounded-lg ${PASTEL.accent.chip}`}>
                <ChartIcon width={15} height={15} />
              </span>
              {t("dashboard.leaveBalance")}
            </h3>
            {/* แถวละประเภท: ชื่อ + แถบใช้ไป/โควตา · ใช้ไป · คงเหลือ (ไม่จำกัด = ไม่มีแถบ) */}
            <ul className="space-y-3">
              {d.leave_balance.map((b) => {
                const used = b.approved + b.pending;
                const pct = b.quota ? Math.min(100, Math.round((used / b.quota) * 100)) : 0;
                const low = b.remaining !== null && b.quota !== null && b.remaining <= Math.max(1, b.quota * 0.2);
                return (
                  <li key={b.type} className="rounded-xl bg-subtle/60 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t(`leave.types.${b.type}` as MessageKey)}</span>
                      <span className="flex items-center gap-1.5 text-xs tabular-nums">
                        <span className="rounded-full bg-surface px-2 py-0.5 text-muted ring-1 ring-line">
                          {t("dashboard.leaveUsed", { used: fmt.number(used) })}
                          {b.quota !== null && ` / ${fmt.number(b.quota)}`}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ${b.remaining === null ? tone.idle.badge : low ? tone.warning.badge : tone.success.badge}`}>
                          {b.remaining === null ? t("dashboard.unlimited") : t("dashboard.leaveLeft", { days: fmt.number(b.remaining) })}
                        </span>
                      </span>
                    </div>
                    {b.quota !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${low ? "bg-warning-400" : "bg-accent-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <Panel title={t("dashboard.leaves")} icon={CalendarIcon} href="/leave" more={t("dashboard.viewAll")} empty={t("dashboard.noLeaves")} color="danger">
            {d.leaves.map((l) => (
              <li key={l.id} className={row}>
                <span className="min-w-0">
                  <span className="block font-medium">{t(`leave.types.${l.leave_type}` as MessageKey)}</span>
                  <span className="block text-xs text-muted">
                    {range(l.start_on, l.end_on)} · {t("dashboard.leaveDays", { days: fmt.number(l.days) })}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.status === "approved" ? tone.success.badge : tone.warning.badge}`}>
                  {t(`leave.statuses.${l.status}` as MessageKey)}
                </span>
              </li>
            ))}
          </Panel>
        </div>
      </Group>
    </div>
  );
}
