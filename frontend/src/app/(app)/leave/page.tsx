import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, CheckCircleIcon, DownloadIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card, alert } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import { LEAVE_STATUSES, type LeaveBalance, type LeaveRequest, type LeaveStatus } from "@/lib/types";
import { LeaveCard } from "./leave-card";
import { ConfirmDownload } from "@/components/confirm-download";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("leave.title") };
}

const TAB_CLS = (active: boolean) =>
  `flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** ใบลาของฉัน (แท็บตามสถานะ) + คงเหลือ — ผู้มี leave.view_all สลับดูของทุกคนและส่งออก Excel ได้ */
export default async function LeavePage({ searchParams }: PageProps<"/leave">) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const viewAll = has(user, "leave.view_all");
  const can = await getAccess();
  const scope = viewAll && params.scope === "all" ? "all" : "mine";
  const status: LeaveStatus = LEAVE_STATUSES.find((s) => s === params.status) ?? "pending";
  const year = typeof params.year === "string" && /^\d{4}$/.test(params.year) ? params.year : localToday().slice(0, 4);
  const open = typeof params.open === "string" ? params.open : "";
  const q = new URLSearchParams({ scope, year });
  const [{ t, fmt }, list, balance] = await Promise.all([
    getI18n(),
    apiFetch<{ data: LeaveRequest[] }>(`/leave?${q}`).then((r) => r.data),
    apiFetch<{ data: LeaveBalance[] }>(`/leave/balance?year=${year}`).then((r) => r.data),
  ]);
  const counts = Object.fromEntries(LEAVE_STATUSES.map((s) => [s, list.filter((l) => l.status === s).length])) as Record<LeaveStatus, number>;
  // เปิดจากปฏิทิน (?open=) → ไปแท็บของใบนั้น
  const opened = open ? list.find((l) => l.id === open) : undefined;
  const tab = opened && !params.status ? opened.status : status;
  const shown = list.filter((l) => l.status === tab);
  const href = (patch: Record<string, string>) => `/leave?${new URLSearchParams({ scope, year, status: tab, ...patch })}` as const;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CalendarIcon}
        title={scope === "all" ? t("leave.allTitle") : t("leave.title")}
        subtitle={t("leave.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {can("btn:leave:export") && (
              <ConfirmDownload href={`/files/leave/export?${new URLSearchParams({ scope, year })}`} className={btn.secondary}>
                <DownloadIcon />
                {t("leave.export")}
              </ConfirmDownload>
            )}
            {can("btn:leave:create") && (
              <Link href="/leave/new" className={btn.primary}>
                <PlusIcon />
                {t("leave.newTitle")}
              </Link>
            )}
          </div>
        }
      />

      {params.done === "1" && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t("leave.submitted")}
        </p>
      )}

      {scope === "mine" && (
        <section className={`p-4 ${card}`}>
          <h2 className="mb-3 text-sm font-semibold">{t("leave.balance", { year: fmt.date(`${year}-01-01`).slice(-4) })}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {balance.map((b) => (
              <li key={b.type} className="rounded-xl bg-subtle/60 p-3">
                <p className="text-xs text-muted">{t(`leave.types.${b.type}`)}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{b.remaining === null ? t("leave.unlimited") : t("leave.remaining", { n: fmt.number(b.remaining) })}</p>
                {b.quota !== null && <p className="text-xs text-faint">{t("leave.usedOf", { used: fmt.number(b.approved + b.pending), quota: fmt.number(b.quota) })}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
          {LEAVE_STATUSES.map((s) => (
            <Link key={s} href={href({ status: s })} role="tab" aria-selected={tab === s} className={TAB_CLS(tab === s)}>
              {t(`leave.tabs.${s}`)}
              <span className="rounded-full bg-line/70 px-1.5 text-xs tabular-nums text-muted">{counts[s]}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {viewAll && (
            <div className="inline-flex gap-1 rounded-xl bg-subtle p-1">
              {(["mine", "all"] as const).map((s) => (
                <Link key={s} href={href({ scope: s })} className={TAB_CLS(scope === s)}>
                  {t(s === "mine" ? "leave.mine" : "leave.everyone")}
                </Link>
              ))}
            </div>
          )}
          <span className="text-muted">{t("leave.year")}</span>
          {[Number(localToday().slice(0, 4)) - 1, Number(localToday().slice(0, 4)), Number(localToday().slice(0, 4)) + 1].map((y) => (
            <Link key={y} href={href({ year: String(y) })} className={`${btn.sm} ${String(y) === year ? btn.soft : btn.secondary}`}>
              {fmt.date(`${y}-01-01`).slice(-4)}
            </Link>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("leave.empty")}</div>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((l) => (
            <LeaveCard key={l.id} leave={l} showUser={scope === "all"} highlight={l.id === open} />
          ))}
        </ul>
      )}
    </div>
  );
}
