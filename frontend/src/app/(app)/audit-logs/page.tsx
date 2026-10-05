import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DateInput } from "@/components/date-input";
import { HistoryIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { AuditLog, Paginated } from "@/lib/types";
import { AppSelect } from "@/components/app-select";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("audit.title") };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ตั้งค่าระบบ → บันทึกการเปลี่ยนแปลง (Local Admin) */
export default async function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const [{ t }, actions] = await Promise.all([getI18n(), apiFetch<{ data: string[] }>("/audit-logs/actions").then((r) => r.data)]);

  const q = new URLSearchParams();
  if (actions.includes(str("action"))) q.set("action", str("action"));
  if (ISO_DATE.test(str("from"))) q.set("from", str("from"));
  if (ISO_DATE.test(str("to"))) q.set("to", str("to"));
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader icon={HistoryIcon} title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Form action="/audit-logs" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto] ${card}`}>
        <AppSelect name="action" defaultValue={str("action")} className={input} aria-label={t("audit.col.action")}>
          <option value="">{t("audit.allActions")}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(t, a)}
            </option>
          ))}
        </AppSelect>
        <DateInput name="from" defaultValue={str("from")} aria-label={t("audit.from")} className={input} />
        <DateInput name="to" defaultValue={str("to")} aria-label={t("audit.to")} className={input} />
        <div className="flex gap-2">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/audit-logs" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>
      <Suspense key={q.toString()} fallback={<TableSkeleton cols={5} />}>
        <AuditTable query={q} />
      </Suspense>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getI18n>>["t"];

/** "api_connection.updated" → ข้อความแปล (ไม่รู้จัก = แสดง key เดิม) */
function actionLabel(t: T, action: string): string {
  const key = `audit.actions.${action.replace(/\./g, "_")}` as MessageKey;
  const text = t(key);
  return text === key ? action : text;
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** ค่าก่อน-หลังที่ต่างกัน (key ระดับบนสุด) */
function changes(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .map((k) => ({ key: k, before: before?.[k], after: after?.[k] }))
    .filter((c) => !before || !after || JSON.stringify(c.before) !== JSON.stringify(c.after));
}

async function AuditTable({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<AuditLog>>(`/audit-logs?${query}`), getI18n()]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/audit-logs?${n}`;
  };
  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("audit.empty")}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("audit.col.time")}</th>
              <th className={table.th}>{t("audit.col.actor")}</th>
              <th className={table.th}>{t("audit.col.action")}</th>
              <th className={table.th}>{t("audit.col.subject")}</th>
              <th className={table.th}>{t("audit.col.ip")}</th>
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((log) => {
              const diff = changes(log.before, log.after);
              return (
                <tr key={log.id} className={`${table.row} align-top`}>
                  <td className={`${table.td} whitespace-nowrap text-muted`}>{fmt.dateTime(log.created_at)}</td>
                  <td className={table.td}>{log.actor_name ?? t("audit.system")}</td>
                  <td className={table.td}>
                    <div className="font-medium">{actionLabel(t, log.action)}</div>
                    {diff.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-accent-600 dark:text-accent-300">{t("audit.field")} ({fmt.number(diff.length)})</summary>
                        <table className="mt-2 w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted">
                              <th className="pr-3 font-medium">{t("audit.field")}</th>
                              <th className="pr-3 font-medium">{t("audit.before")}</th>
                              <th className="font-medium">{t("audit.after")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.map((c) => (
                              <tr key={c.key} className="border-t border-line">
                                <td className="py-1 pr-3 font-mono">{c.key}</td>
                                <td className="max-w-xs break-all py-1 pr-3 text-muted">{show(c.before)}</td>
                                <td className="max-w-xs break-all py-1">{show(c.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    ) : (
                      <p className="mt-1 text-xs text-faint">{t("audit.noChanges")}</p>
                    )}
                  </td>
                  <td className={table.td}>
                    {log.subject_name ?? log.subject_type}
                    {log.subject_id && <span className="text-xs text-faint"> #{log.subject_id}</span>}
                  </td>
                  <td className={`${table.td} whitespace-nowrap font-mono text-xs text-muted`}>{log.ip ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}
