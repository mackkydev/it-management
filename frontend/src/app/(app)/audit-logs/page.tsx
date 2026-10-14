import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DateInput } from "@/components/date-input";
import { DownloadIcon, HistoryIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { AuditLog, Paginated } from "@/lib/types";
import { AppSelect } from "@/components/app-select";
import { actionLabel, auditQuery } from "./labels";
import { ConfirmDownload } from "@/components/confirm-download";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("audit.title") };
}

/** ตั้งค่าระบบ → บันทึกการเปลี่ยนแปลง (Local Admin) */
export default async function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  if (!has(await getCurrentUser(), "audit_logs.view")) redirect("/tickets");
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const [{ t }, actions, branches] = await Promise.all([
    getI18n(),
    apiFetch<{ data: string[] }>("/audit-logs/actions").then((r) => r.data),
    apiFetch<{ data: { id: number; name: string }[] }>("/branches").then((r) => r.data),
  ]);

  // ตัวกรอง: การกระทำ / ผู้ทำ (พิมพ์ชื่อ) / สาขาของผู้ทำ / ช่วงวันที่ — ไฟล์ Excel ใช้ตัวกรองเดียวกัน
  const filters = auditQuery(str, actions);
  const q = new URLSearchParams(filters);
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader icon={HistoryIcon} title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Form action="/audit-logs" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_12rem_11rem_11rem_auto] ${card}`}>
        <input name="actor" defaultValue={str("actor")} placeholder={t("audit.actorPlaceholder")} aria-label={t("audit.col.actor")} className={input} />
        <AppSelect name="action" defaultValue={str("action")} className={input} aria-label={t("audit.col.action")}>
          <option value="">{t("audit.allActions")}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(t, a)}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="branch_id" defaultValue={str("branch_id")} className={input} aria-label={t("audit.col.branch")}>
          <option value="">{t("audit.allBranches")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
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
      {(await getAccess())("btn:audit-logs:export") && (
        <div className="flex justify-end">
          <ConfirmDownload href={`/audit-logs/export?${filters}`} className={`${btn.secondary} ${btn.sm}`}>
            <DownloadIcon width={14} height={14} />
            {t("audit.export")}
          </ConfirmDownload>
        </div>
      )}
      <Suspense key={q.toString()} fallback={<TableSkeleton cols={6} />}>
        <AuditTable query={q} />
      </Suspense>
    </div>
  );
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
              <th className={table.th}>{t("audit.col.branch")}</th>
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
                  <td className={`${table.td} whitespace-nowrap text-muted`}>{log.branch_name ?? "—"}</td>
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
