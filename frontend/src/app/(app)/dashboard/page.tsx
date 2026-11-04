import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  BellIcon, BoxIcon, CalendarIcon, CarIcon, ChartIcon, CheckCircleIcon, ClipboardIcon, GaugeIcon, InboxIcon, KeyIcon, MeetingRoomIcon, UserIcon, WrenchIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { NewsAnnouncement, TicketStatus, TicketType } from "@/lib/types";
import { TicketStatusBadge, ticketSubject } from "../tickets/ticket-ui";
import { NewsCarousel } from "./news-carousel";

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
    recent: { id: string; type: TicketType; type_other: string | null; status: TicketStatus; requested_at: string; requester: string | null; assignee: string | null }[];
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

/** สีไอคอนของกล่อง (token สีสถานะ / สีธีม) — พื้นกล่องเป็นสีขาวตามการ์ดปกติ */
const CHIP = {
  accent: "bg-accent-100 text-accent-700 dark:bg-accent-400/15 dark:text-accent-300",
  info: "bg-info-100 text-info-700 dark:bg-info-400/15 dark:text-info-300",
  success: "bg-success-100 text-success-700 dark:bg-success-400/15 dark:text-success-300",
  warning: "bg-warning-100 text-warning-700 dark:bg-warning-400/15 dark:text-warning-300",
  danger: "bg-danger-100 text-danger-700 dark:bg-danger-400/15 dark:text-danger-300",
  idle: "bg-idle-100 text-idle-700 dark:bg-idle-400/15 dark:text-idle-300",
} as const;
type Chip = keyof typeof CHIP;

/** ตัวเลขสรุป (บล็อกขาว + ไอคอนสี) — คลิกไปหน้าที่เกี่ยวข้อง */
function Stat({ href, label, value, icon: Icon, color }: { href: string; label: string; value: number; icon: Icon; color: Chip }) {
  return (
    <Link href={href} className={`group flex cursor-pointer flex-col gap-3 p-4 transition-shadow hover:shadow-md ${card}`}>
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${CHIP[color]}`}>
        <Icon width={20} height={20} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted group-hover:text-ink">{label}</span>
        <span className="mt-0.5 block text-2xl font-semibold tabular-nums">{value}</span>
      </span>
    </Link>
  );
}

/** วงแหวนสัดส่วน (เช่น วันลาที่ใช้ไป / โควตา) */
function Ring({ pct, className }: { pct: number; className: string }) {
  const r = 26;
  const length = 2 * Math.PI * r;
  return (
    <span className="relative grid h-16 w-16 shrink-0 place-items-center" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-line" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - pct / 100)} className={className} />
      </svg>
      <span className="text-xs font-semibold tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

/** กล่องรายการ (พื้นปกติ — สีพาสเทลเฉพาะไอคอน) ว่าง = ข้อความ พร้อมลิงก์ "ดูทั้งหมด" */
function Panel({ title, icon: Icon, href, more, empty, color, className = "", listClassName = "", children }: { title: string; icon: Icon; href: string; more: string; empty: string; color: Chip; className?: string; listClassName?: string; children: ReactNode[] }) {
  return (
    <section className={`flex flex-col p-4 sm:p-5 ${card} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <span className={`grid h-7 w-7 place-items-center rounded-lg ${CHIP[color]}`}>
            <Icon width={15} height={15} />
          </span>
          {title}
        </h3>
        <Link href={href} className="cursor-pointer text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
          {more}
        </Link>
      </div>
      {children.length ? <ul className={`divide-y divide-line ${listClassName}`}>{children}</ul> : <p className="py-4 text-center text-sm text-muted">{empty}</p>}
    </section>
  );
}

/** หัวข้อของแต่ละกลุ่ม */
function Group({ title, icon: Icon, className = "", children }: { title: string; icon: Icon; className?: string; children: ReactNode }) {
  return (
    <section className={`space-y-3 ${className}`}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon width={18} height={18} className="text-accent-500" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** ประกาศข่าวสาร (เปิดใช้งาน + อยู่ในช่วงวันที่) — ดึงไม่ได้ก็ยังแสดงหน้าภาพรวมตามปกติ */
const loadNews = () => apiFetch<{ data: NewsAnnouncement[] }>("/announcements/feed").then((r) => r.data).catch(() => [] as NewsAnnouncement[]);

/**
 * ภาพรวม (GET /dashboard) = ศูนย์รวมข้อมูลและข่าวสาร:
 *   แถวบน ข่าวสาร (ซ้าย) · งานฝ่าย IT + ใบแจ้งงานล่าสุด (ขวา) → สรุปข้อมูลส่วนบุคคล (วันลา) → การจอง + อุปกรณ์ที่ยืม/VPN
 *   ตัวเลขสรุป = บล็อกขาว + ไอคอนสี
 */
export default async function DashboardPage() {
  const [{ data: d }, user, { t, fmt }, news] = await Promise.all([apiFetch<{ data: Dashboard }>("/dashboard"), getCurrentUser(), getI18n(), loadNews()]);
  const range = (from: string, to: string) => (from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`);
  const row = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm";
  const isIt = Boolean(d.it);
  const waitingHref = d.approvals > 0 ? "/tickets/approvals" : "/tickets?mine=1&status=approval_requested";

  return (
    <div className="space-y-7">
      <PageHeader icon={GaugeIcon} title={t("dashboard.title")} subtitle={t("dashboard.subtitle", { name: user.name })} />

      {/* แถวบน: ข่าวสาร · งานฝ่าย IT + ใบแจ้งงานล่าสุด */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Group title={t("dashboard.news.title")} icon={BellIcon} className="flex flex-col">
          <NewsCarousel key={news.map((a) => a.id).join(",")} items={news} />
        </Group>
        <Group title={t("dashboard.sectionIt")} icon={WrenchIcon} className="flex flex-col">
          <div className={`grid grid-cols-2 gap-3 ${isIt ? "sm:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
            {!isIt && <Stat href="/tickets?mine=1" label={t("dashboard.ticketsOpen")} value={d.tickets.open} icon={ClipboardIcon} color="info" />}
            <Stat href={waitingHref} label={t("dashboard.ticketsWaitingMe")} value={d.tickets.waiting_me} icon={InboxIcon} color="warning" />
            <Stat href="/tickets?mine=1&status=pending_requester" label={t("dashboard.toClose")} value={d.tickets.to_close} icon={CheckCircleIcon} color="danger" />
            <Stat href="/tickets?mine=1&status=completed" label={t("dashboard.ticketsCompleted")} value={d.tickets.completed} icon={CheckCircleIcon} color="success" />
            {d.it && (
              <>
                <Stat href="/it/tickets?status=approved" label={t("dashboard.itWaiting")} value={d.it.waiting} icon={InboxIcon} color="accent" />
                <Stat href="/it/tickets?status=in_progress" label={t("dashboard.itInProgress")} value={d.it.in_progress} icon={WrenchIcon} color="info" />
                <Stat href="/it/tickets?status=pending_it_head" label={t("dashboard.itReview")} value={d.it.review} icon={ClipboardIcon} color="idle" />
                <Stat href="/it/tickets?status=completed" label={t("dashboard.itDoneMonth")} value={d.it.done_month} icon={CheckCircleIcon} color="success" />
                <Stat href="/kpi" label={t("dashboard.kpiPending")} value={d.it.kpi_pending} icon={ChartIcon} color="warning" />
              </>
            )}
          </div>
          <Panel
            title={t(d.tickets.recent_scope === "all" ? "dashboard.recentAll" : "dashboard.recentTickets")}
            icon={ClipboardIcon}
            href={d.tickets.recent_scope === "all" ? "/tickets/all" : "/tickets?mine=1"}
            more={t("dashboard.viewAll")}
            empty={t("dashboard.noTickets")}
            color="info"
            className="flex-1"
            listClassName="flex flex-1 flex-col"
          >
            {/* แถวขยายเต็มความสูงกล่อง (ให้จบตรงกับกล่องข่าว) แต่ไม่สูงเกินไปเมื่อมีน้อยใบ */}
            {d.tickets.recent.map((tk) => (
              <li key={tk.id} className="flex max-h-24 min-h-16 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 text-sm">
                <Link href={`/tickets/${tk.id}`} className="min-w-0 cursor-pointer hover:underline">
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
        </Group>
      </div>

      {/* สรุปข้อมูลส่วนบุคคล — วันลาคงเหลือปีนี้ (วงแหวน) + วันลาที่กำลังจะถึง */}
      <Group title={t("dashboard.sectionPersonal")} icon={UserIcon}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={`p-4 sm:p-5 ${card}`}>
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <span className={`grid h-7 w-7 place-items-center rounded-lg ${CHIP.accent}`}>
                <ChartIcon width={15} height={15} />
              </span>
              {t("dashboard.leaveBalance")}
            </h3>
            {/* การ์ดละประเภท: ชื่อ + คงเหลือ + ใช้ไป/โควตา + วงแหวน (ไม่จำกัด = ไม่มีวงแหวน) */}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {d.leave_balance.map((b) => {
                const used = b.approved + b.pending;
                const pct = b.quota ? Math.min(100, Math.round((used / b.quota) * 100)) : 0;
                const low = b.remaining !== null && b.quota !== null && b.remaining <= Math.max(1, b.quota * 0.2);
                return (
                  <li key={b.type} className="flex items-center justify-between gap-3 rounded-xl p-3 ring-1 ring-line">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-muted">{t(`leave.types.${b.type}` as MessageKey)}</span>
                      <span className="mt-0.5 block text-lg font-semibold tabular-nums">{b.remaining === null ? t("dashboard.unlimited") : t("dashboard.leaveLeft", { days: fmt.number(b.remaining) })}</span>
                      <span className="block text-xs tabular-nums text-faint">
                        {t("dashboard.leaveUsed", { used: fmt.number(used) })}
                        {b.quota !== null && ` / ${fmt.number(b.quota)}`}
                      </span>
                    </span>
                    {b.quota !== null && <Ring pct={pct} className={low ? "stroke-warning-400" : "stroke-accent-400"} />}
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

      {/* การจอง — ห้องประชุม / รถ ที่กำลังจะถึง + อุปกรณ์ที่ยืม / VPN */}
      <Group title={t("dashboard.sectionBooking")} icon={CalendarIcon}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

    </div>
  );
}
