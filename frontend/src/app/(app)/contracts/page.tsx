import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BellIcon, CheckCircleIcon, FileTextIcon, PencilIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { alert, btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getAccess, getCurrentUser } from "@/lib/auth";
import type { Contract } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("contracts.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;
const STATUSES = ["expiring", "expired", "active"] as const;
const STATUS_TONE = { active: tone.success, expiring: tone.warning, expired: tone.danger } as const;

/** 4.1.2 สัญญา vendor พร้อมแจ้งเตือนล่วงหน้า */
export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const user = await getCurrentUser();
  if (!has(user, "contracts.view")) redirect("/tickets");
  const params = await searchParams;
  const [{ t }, can] = await Promise.all([getI18n(), getAccess()]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const saved = SAVED.find((s) => s === params.saved);
  const status = STATUSES.find((s) => s === params.status);

  const q = new URLSearchParams();
  if (str("search")) q.set("search", str("search"));
  if (status) q.set("status", status);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FileTextIcon}
        title={t("contracts.title")}
        subtitle={t("contracts.subtitle")}
        actions={
          has(user, "contracts.create") && can("btn:contracts:create") && (
            <Link href="/contracts/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("contracts.add")}
            </Link>
          )
        }
      />
      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`contracts.saved.${saved}`)}
        </div>
      )}
      <Form action="/contracts" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_auto] ${card}`}>
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("contracts.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <div className="flex gap-2">
          <Link href="/contracts" className={`${btn.secondary} px-3`} aria-label={t("common.clearFilters")}>
            <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
          </Link>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>
      <Suspense key={q.toString()} fallback={<TableSkeleton cols={5} />}>
        <ContractResults query={q} status={status} search={str("search")} canEdit={has(user, "contracts.update")} />
      </Suspense>
    </div>
  );
}

async function ContractResults({ query, status, search, canEdit }: { query: URLSearchParams; status?: (typeof STATUSES)[number]; search: string; canEdit: boolean }) {
  const [res, { t, fmt }] = await Promise.all([
    apiFetch<{ data: Contract[]; summary: Record<(typeof STATUSES)[number], number> }>(`/contracts?${query}`),
    getI18n(),
  ]);
  const total = res.summary.active + res.summary.expiring + res.summary.expired;
  const chipHref = (s?: string) => {
    const n = new URLSearchParams();
    if (search) n.set("search", search);
    if (s) n.set("status", s);
    return n.size ? `/contracts?${n}` : "/contracts";
  };
  const chip = (active: boolean) =>
    `inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
      active ? "bg-accent-100 text-accent-700 ring-accent-300" : "bg-surface text-muted ring-line hover:bg-subtle"
    }`;

  const remaining = (c: Contract) =>
    c.days_left < 0 ? t("contracts.expiredAgo", { days: fmt.number(-c.days_left) }) : c.days_left === 0 ? t("contracts.today") : t("contracts.daysLeft", { days: fmt.number(c.days_left) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Link href={chipHref()} className={chip(!status)}>
          {t("contracts.allStatuses")} <span className="text-xs opacity-70">{fmt.number(total)}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={chipHref(s)} className={chip(status === s)}>
            <span className={`h-2 w-2 rounded-full ${STATUS_TONE[s].dot}`} />
            {t(`contracts.statuses.${s}`)} <span className="text-xs opacity-70">{fmt.number(res.summary[s])}</span>
          </Link>
        ))}
      </div>

      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("contracts.empty")}</div>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>{t("contracts.col.title")}</th>
                <th className={table.th}>{t("contracts.col.vendor")}</th>
                <th className={table.th}>{t("contracts.col.period")}</th>
                <th className={table.th}>{t("contracts.col.remaining")}</th>
                <th className={table.th}>{t("contracts.col.status")}</th>
                <th className={table.th} aria-label={t("common.manage")} />
              </tr>
            </thead>
            <tbody className={table.body}>
              {res.data.map((c) => (
                <tr key={c.id} className={`${table.row} align-top`}>
                  <td className={table.td}>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-xs text-muted">
                      {c.contract_no && <span className="font-mono">{c.contract_no}</span>}
                      {c.contract_no && c.branch && " · "}
                      {c.branch?.name}
                    </div>
                  </td>
                  <td className={table.td}>
                    <div>{c.vendor_name}</div>
                    {(c.contact_name || c.contact_phone) && <div className="text-xs text-muted">{[c.contact_name, c.contact_phone].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className={`${table.td} whitespace-nowrap text-sm`}>
                    {fmt.date(c.start_date)} – {fmt.date(c.end_date)}
                  </td>
                  <td className={`${table.td} whitespace-nowrap`}>
                    <div className="text-sm">{remaining(c)}</div>
                    <div className="flex items-center gap-1 text-xs text-faint">
                      <BellIcon width={11} height={11} />
                      {c.notify_enabled ? t("contracts.notifyInfo", { days: fmt.number(c.effective_notify_days) }) : t("contracts.notifyOff")}
                    </div>
                  </td>
                  <td className={table.td}>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[c.status].badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[c.status].dot}`} />
                      {t(`contracts.statuses.${c.status}`)}
                    </span>
                  </td>
                  <td className={`${table.td} text-right`}>
                    {canEdit && (
                      <Link href={`/contracts/${c.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                        <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                        {t("common.edit")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
