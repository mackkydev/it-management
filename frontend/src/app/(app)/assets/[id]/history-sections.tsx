import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ChevronRightIcon, HistoryIcon, UsersIcon, WrenchIcon } from "@/components/icons";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { AssetMovement, AssetRepair, AssetUserLog, Paginated } from "@/lib/types";
import { TicketStatusBadge } from "../../tickets/ticket-ui";
import { MOVEMENT_STYLE } from "../movement-timeline";

function Header({ icon, title, count, href, more }: { icon: ReactNode; title: string; count: string; href?: Route; more?: string }) {
  return (
    <h2 className="mb-3 flex flex-wrap items-center gap-2 font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">{icon}</span>
      {title}
      <span className="text-sm font-normal text-muted">{count}</span>
      {href && more && (
        <Link href={href} className="ml-auto inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
          {more}
          <ChevronRightIcon width={13} height={13} />
        </Link>
      )}
    </h2>
  );
}

/**
 * แถวประวัติแบบย่อ: ลำดับ · วันที่ · สรุป — มี href = ทั้งแถวคลิกไปหน้าประวัติเต็ม (หน้ารายงาน)
 */
function Row({ no, date, children, href }: { no: number; date: ReactNode; children: ReactNode; href?: Route }) {
  const body = (
    <>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-faint">{no}</span>
      <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{date}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">{children}</span>
      {href && <ChevronRightIcon width={14} height={14} className="shrink-0 text-faint" />}
    </>
  );
  const cls = "flex items-center gap-3 px-3 py-2.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={`${cls} cursor-pointer transition-colors hover:bg-subtle`}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

const List = ({ children }: { children: ReactNode }) => <ol className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">{children}</ol>;

/** ชื่อเดิม (ขีดฆ่า) → ชื่อใหม่ */
function Change({ from, to, none }: { from: string | null; to: string | null; none: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      {from !== null && from !== to && (
        <>
          <span className="text-muted line-through decoration-faint">{from}</span>
          <span className="text-accent-400" aria-hidden="true">
            →
          </span>
        </>
      )}
      <span className="font-medium text-ink">{to ?? none}</span>
    </span>
  );
}

/** ประวัติการโอนย้าย (ย่อ) — วันที่ + ประเภท + สาขา (เดิม → ใหม่) · ผู้ถือครอง, คลิก = หน้าประวัติการโอนย้าย (รายงานรวม กรองตามรหัสสินทรัพย์) */
export async function MovementSummary({ id, href }: { id: string; href?: Route }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<AssetMovement>>(`/assets/${id}/movements?per_page=50`), getI18n()]);
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <Header icon={<HistoryIcon width={15} height={15} />} title={t("movements.title")} count={t("movements.count", { count: fmt.number(res.meta.total) })} href={href} more={t("assets.history.viewAll")} />
      {res.data.length === 0 ? (
        <p className="text-sm text-muted">{t("movements.empty")}</p>
      ) : (
        <List>
          {res.data.map((m, i) => (
            <Row key={m.id} no={res.data.length - i} date={<time dateTime={m.moved_at}>{fmt.date(m.moved_at)}</time>} href={href}>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLE[m.type].badge}`}>{m.type_label}</span>
              {m.to_branch && m.from_branch?.id !== m.to_branch.id ? (
                <Change from={m.type === "registered" ? null : (m.from_branch?.name ?? null)} to={m.to_branch.name} none={t("common.none")} />
              ) : null}
              <span className="min-w-0 truncate text-ink">
                {[m.to_branch && m.from_branch?.id !== m.to_branch.id ? null : m.to_location?.name, m.to_custodian?.name].filter(Boolean).join(" · ") ||
                  (m.to_branch ? "" : t("common.none"))}
              </span>
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}

/** ประวัติการซ่อม (ย่อ) — วันที่ + เลขใบงาน + อาการ + สถานะ, คลิก = หน้าประวัติการซ่อม (รายงานรวม กรองตามรหัสสินทรัพย์) */
export async function RepairHistory({ id, href }: { id: string; href?: Route }) {
  const [{ data }, { t, fmt }] = await Promise.all([apiFetch<{ data: AssetRepair[] }>(`/assets/${id}/repairs`), getI18n()]);
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <Header icon={<WrenchIcon width={15} height={15} />} title={t("assets.repairs.title")} count={t("movements.count", { count: fmt.number(data.length) })} href={href} more={t("assets.history.viewAll")} />
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t("assets.repairs.empty")}</p>
      ) : (
        <List>
          {data.map((r, i) => (
            <Row key={r.id} no={data.length - i} date={<time dateTime={r.requested_at}>{fmt.date(r.requested_at)}</time>} href={href}>
              <span className="font-mono text-xs text-muted">{r.ticket_no}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{r.symptom || "-"}</span>
              <TicketStatusBadge status={r.status} t={t} />
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}

const SOURCE_TONE: Record<AssetUserLog["source"], string> = { create: tone.success.badge, edit: tone.info.badge, import: tone.warning.badge };

/** ประวัติผู้ใช้งาน (ผู้ถือครอง/ผู้ใช้งาน) — แถวเหมือนประวัติการโอนย้าย: คนเดิมขีดฆ่า → คนใหม่ (+ Department ถ้าเปลี่ยน) */
export async function UserHistory({ id }: { id: string }) {
  const [{ data }, { t, fmt }] = await Promise.all([apiFetch<{ data: AssetUserLog[] }>(`/assets/${id}/user-logs`), getI18n()]);
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <Header icon={<UsersIcon width={15} height={15} />} title={t("assets.userLogs.title")} count={t("movements.count", { count: fmt.number(data.length) })} />
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t("assets.userLogs.empty")}</p>
      ) : (
        <List>
          {data.map((l, i) => {
            const created = l.source === "create";
            return (
              <Row key={l.id} no={data.length - i} date={<time dateTime={l.changed_at}>{fmt.date(l.changed_at)}</time>}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_TONE[l.source]}`}>{t(`assets.userLogs.sources.${l.source}`)}</span>
                <Change from={created ? null : l.from_user_name} to={l.to_user_name} none={t("common.none")} />
                {l.from_department !== l.to_department && (
                  <span className="text-xs text-muted">
                    ({t("assets.computer.department")}: <Change from={created ? null : l.from_department} to={l.to_department} none={t("common.none")} />)
                  </span>
                )}
              </Row>
            );
          })}
        </List>
      )}
    </section>
  );
}
