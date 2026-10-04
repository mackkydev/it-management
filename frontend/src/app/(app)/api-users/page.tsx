import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AlertIcon, ResetIcon, SearchIcon, ShieldIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { ApiConnection, ApiUser, Paginated } from "@/lib/types";
import { LinkAccountButton } from "./link-account-button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("access.title") };
}

const ROLE_STYLE: Record<ApiUser["role"], string> = {
  admin: "bg-accent-300 text-accent-900 dark:bg-accent-400/35 dark:text-accent-100",
  manager: "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-200",
  viewer: "bg-surface text-muted ring-1 ring-inset ring-line",
};

/** ข้อมูลหลัก → ผู้ใช้จาก API (Local Admin) */
export default async function ApiUsersPage({ searchParams }: PageProps<"/api-users">) {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const [{ t }, connections] = await Promise.all([getI18n(), apiFetch<{ data: ApiConnection[] }>("/api-connections").then((r) => r.data)]);

  // ส่งต่อเฉพาะค่าที่รู้จัก
  const q = new URLSearchParams();
  if (str("search")) q.set("search", str("search"));
  if (["manager", "viewer"].includes(str("role"))) q.set("role", str("role"));
  if (["active", "inactive"].includes(str("status"))) q.set("status", str("status"));
  if (connections.some((c) => String(c.id) === str("connection_id"))) q.set("connection_id", str("connection_id"));
  if (str("conflict") === "1") q.set("conflict", "1");
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("access.title")} subtitle={t("access.subtitle")} />

      <Form action="/api-users" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_12rem_auto_auto] ${card}`}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("access.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <select name="role" defaultValue={str("role")} className={input} aria-label={t("access.col.role")}>
          <option value="">{t("access.allRoles")}</option>
          <option value="manager">{t("roles.manager")}</option>
          <option value="viewer">{t("roles.viewer")}</option>
        </select>
        <select name="status" defaultValue={str("status")} className={input} aria-label={t("access.col.status")}>
          <option value="">{t("access.allStatuses")}</option>
          <option value="active">{t("users.statuses.active")}</option>
          <option value="inactive">{t("users.statuses.inactive")}</option>
        </select>
        <select name="connection_id" defaultValue={str("connection_id")} className={input} aria-label={t("access.col.connection")}>
          <option value="">{t("access.allConnections")}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="conflict" value="1" defaultChecked={str("conflict") === "1"} className="cursor-pointer accent-[var(--accent-500)]" />
          {t("access.onlyConflicts")}
        </label>
        <div className="flex gap-2">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/api-users" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={q.toString()} fallback={<TableSkeleton cols={6} />}>
        <ApiUserTable query={q} />
      </Suspense>
    </div>
  );
}

async function ApiUserTable({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<ApiUser>>(`/api-users?${query}`), getI18n()]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/api-users?${n}`;
  };
  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("access.empty")}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("access.col.name")}</th>
              <th className={table.th}>{t("access.col.connection")}</th>
              <th className={table.th}>{t("access.col.role")}</th>
              <th className={table.th}>{t("access.col.status")}</th>
              <th className={table.th}>{t("access.col.synced")}</th>
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((u) => (
              <tr key={u.id} className={`${table.row} ${u.is_active ? "" : "opacity-60"}`}>
                <td className={table.td}>
                  <div className="font-medium">{u.name}</div>
                  <div className="truncate text-xs text-muted">{u.email ?? t("access.noEmail")}</div>
                  {u.conflict_email && (
                    <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone.warning.badge}`}>
                      <AlertIcon width={12} height={12} />
                      {t("access.conflict", { email: u.conflict_email })}
                    </div>
                  )}
                </td>
                <td className={table.td}>
                  <div>{u.connection_name}</div>
                  <div className="text-xs text-faint">
                    {t("access.externalId")}: {u.external_id}
                  </div>
                </td>
                <td className={table.td}>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLE[u.role]}`}>{t(`roles.${u.role}`)}</span>
                  {u.overrides_count > 0 && (
                    <div className="mt-1 text-xs text-muted">
                      {t("access.col.overrides")}: {t("access.overridesCount", { count: fmt.number(u.overrides_count) })}
                    </div>
                  )}
                </td>
                <td className={table.td}>
                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${u.is_active ? tone.success.badge : tone.idle.badge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
                    {u.is_active ? t("users.statuses.active") : t("users.statuses.inactive")}
                  </span>
                </td>
                <td className={`${table.td} whitespace-nowrap text-muted`}>{u.external_synced_at ? fmt.dateTime(u.external_synced_at) : "-"}</td>
                <td className={`${table.td} text-right`}>
                  <div className="flex justify-end gap-2">
                    {u.conflict_email && u.conflict_user_id && (
                      <LinkAccountButton apiUserId={u.id} localUserId={u.conflict_user_id} connection={u.connection_name} email={u.conflict_email} />
                    )}
                    <Link href={`/api-users/${u.id}`} className={`${btn.soft} ${btn.sm}`}>
                      <LinkPendingIcon icon={<ShieldIcon width={13} height={13} />} size={13} />
                      {t("access.editPermissions")}
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}
