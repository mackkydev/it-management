import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { alert, btn, card, input, table } from "@/components/ui";
import { CheckCircleIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, canAccessItData, getCurrentUser } from "@/lib/auth";
import { TICKET_STATUSES, TICKET_TYPES, type Paginated, type TicketCounts, type TicketSummary } from "@/lib/types";
import { TicketStatusBadge, ticketSubject } from "./ticket-ui";

export type TicketScope = "mine" | "approvals" | "it";

const BASE: Record<TicketScope, string> = { mine: "/tickets", approvals: "/tickets/approvals", it: "/it/tickets" };

function buildQuery(scope: TicketScope, params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams({ scope });
  for (const key of ["search", "status", "type", "assigned", "page"]) {
    const v = params[key];
    if (typeof v === "string" && v !== "") q.set(key, v.slice(0, 100));
  }
  q.set("per_page", "20");
  return q;
}

/** หน้ารายการใบแจ้งงาน (ใช้ร่วม 3 หน้า: ของฉัน / รออนุมัติ / งาน IT หลังบ้าน) */
export async function TicketListPage({ scope, params }: { scope: TicketScope; params: Record<string, string | string[] | undefined> }) {
  const [{ t }, user, can] = await Promise.all([getI18n(), getCurrentUser(), getAccess()]);
  const query = buildQuery(scope, params);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const title = scope === "mine" ? t("tickets.mineTitle") : scope === "approvals" ? t("tickets.approvalsTitle") : t("tickets.itTitle");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardIcon}
        title={title}
        subtitle={scope === "it" ? t("tickets.itSubtitle") : undefined}
        actions={
          can("btn:tickets:create") && (
            <Link href="/tickets/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("tickets.create")}
            </Link>
          )
        }
      />

      <Suspense fallback={<div className="h-10" />}>
        <ScopeTabs scope={scope} showIt={canAccessItData(user)} />
      </Suspense>

      <Form action={BASE[scope]} className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto] ${card}`}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("tickets.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <select name="type" defaultValue={str("type")} className={input} aria-label={t("tickets.col.subject")}>
          <option value="">{t("tickets.allTypes")}</option>
          {TICKET_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`tickets.types.${ty}`)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={str("status")} className={input} aria-label={t("tickets.col.status")}>
          <option value="">{t("tickets.allStatuses")}</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tickets.statuses.${s}`)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Link href={BASE[scope]} className={`${btn.secondary} px-3`} aria-label={t("common.clearFilters")}>
            <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
          </Link>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
        {scope === "it" && (
          <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
            <input type="checkbox" name="assigned" value="me" defaultChecked={str("assigned") === "me"} className="h-4 w-4 accent-[var(--accent-500)]" />
            {t("tickets.assignedToMe")}
          </label>
        )}
      </Form>

      <Suspense key={query.toString()} fallback={<TableSkeleton cols={7} />}>
        <TicketResults scope={scope} query={query} />
      </Suspense>
    </div>
  );
}

/** แท็บ: ของฉัน / รออนุมัติ / งาน IT — พร้อมตัวเลขค้าง */
async function ScopeTabs({ scope, showIt }: { scope: TicketScope; showIt: boolean }) {
  const [{ t }, res] = await Promise.all([getI18n(), apiFetch<{ counts: TicketCounts }>("/tickets?per_page=1")]);
  const c = res.counts;
  const tabs: { key: TicketScope; label: string; count?: number }[] = [
    { key: "mine", label: t("tickets.tabs.mine"), count: c.mine_open },
    { key: "approvals", label: t("tickets.tabs.approvals"), count: c.approvals },
    ...(showIt ? [{ key: "it" as const, label: t("tickets.tabs.it"), count: (c.it_new ?? 0) + (c.it_review ?? 0) }] : []),
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-subtle p-1" aria-label="Tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={BASE[tab.key]}
          aria-current={tab.key === scope ? "page" : undefined}
          className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition-colors ${
            tab.key === scope ? "bg-surface font-medium text-accent-800 shadow-sm ring-1 ring-line dark:text-accent-200" : "text-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.count ? (
            <span className="rounded-full bg-accent-200 px-1.5 text-[11px] font-semibold text-accent-900 dark:bg-accent-400/30 dark:text-accent-100">
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

async function TicketResults({ scope, query }: { scope: TicketScope; query: URLSearchParams }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<TicketSummary>>(`/tickets?${query}`), getI18n()]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.delete("scope");
    n.delete("per_page");
    n.set("page", String(p));
    return `${BASE[scope]}?${n}`;
  };

  if (res.data.length === 0) {
    return <div className={`p-10 text-center text-muted ${card}`}>{t("tickets.empty")}</div>;
  }

  const actionHint = (tk: TicketSummary) =>
    tk.actions.length > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-800 dark:bg-accent-400/15 dark:text-accent-200">
        {t(`tickets.actions.${tk.actions[0]}`)}
      </span>
    ) : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("tickets.col.no")}</th>
              <th className={table.th}>{t("tickets.col.subject")}</th>
              <th className={table.th}>{t("tickets.col.requester")}</th>
              <th className={table.th}>{t("tickets.col.branch")}</th>
              <th className={table.th}>{t("tickets.col.assignee")}</th>
              <th className={table.th}>{t("tickets.col.due")}</th>
              <th className={table.th}>{t("tickets.col.status")}</th>
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((tk) => (
              <tr key={tk.id} className={table.row}>
                <td className={`${table.td} whitespace-nowrap`}>
                  <Link href={`/tickets/${tk.id}`} className="cursor-pointer font-mono text-xs font-semibold text-accent-700 hover:underline dark:text-accent-300">
                    {tk.ticket_no}
                  </Link>
                  <div className="text-xs text-faint">{fmt.date(tk.requested_at)}</div>
                </td>
                <td className={table.td}>
                  <Link href={`/tickets/${tk.id}`} className="cursor-pointer font-medium text-ink hover:underline">
                    {ticketSubject(tk.type, tk.type_other, t)}
                  </Link>
                  <div className="line-clamp-1 max-w-md text-xs text-muted">{tk.details}</div>
                </td>
                <td className={table.td}>{tk.requester?.name ?? "-"}</td>
                <td className={table.td}>{tk.branch?.name ?? "-"}</td>
                <td className={table.td}>{tk.assignee?.name ?? <span className="text-faint">-</span>}</td>
                <td className={`${table.td} whitespace-nowrap`}>{tk.due_date ? fmt.date(tk.due_date) : "-"}</td>
                <td className={table.td}>
                  <div className="flex flex-col items-start gap-1">
                    <TicketStatusBadge status={tk.status} t={t} />
                    {actionHint(tk)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
        {res.data.map((tk) => (
          <li key={tk.id}>
            <Link href={`/tickets/${tk.id}`} className={`block cursor-pointer space-y-2 p-4 transition-colors hover:ring-accent-300 ${card}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-accent-700 dark:text-accent-300">{tk.ticket_no}</span>
                <TicketStatusBadge status={tk.status} t={t} />
              </div>
              <div className="font-medium">{ticketSubject(tk.type, tk.type_other, t)}</div>
              <div className="line-clamp-2 text-xs text-muted">{tk.details}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{tk.requester?.name}</span>
                {tk.branch && <span>· {tk.branch.name}</span>}
                <span>· {fmt.date(tk.requested_at)}</span>
              </div>
              {actionHint(tk)}
            </Link>
          </li>
        ))}
      </ul>

      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}

/** แถบแจ้งผลหลังทำรายการ (?done=...) */
export async function DoneBanner({ done }: { done?: string }) {
  if (!done) return null;
  const { t } = await getI18n();
  const key = done === "created" ? "tickets.created" : `tickets.actions.done.${done}`;
  const known = ["created", "approve", "reject", "accept", "result", "close", "return"].includes(done);
  if (!known) return null;
  return (
    <div role="status" className={alert.success}>
      <CheckCircleIcon className="shrink-0 text-success-500" />
      {t(key as Parameters<typeof t>[0])}
    </div>
  );
}
