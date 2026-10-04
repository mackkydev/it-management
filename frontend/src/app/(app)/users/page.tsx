import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckCircleIcon, PencilIcon, PlusIcon, ResetIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, canManageAssets, getCurrentUser } from "@/lib/auth";
import { ROLES, type ManagedUser, type Paginated, type User, type UserOption } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.title") };
}

/** simplePaginate ของ Laravel: ไม่มี total/last_page (ไม่ต้องนับทั้งตาราง) */
interface SimplePage<T> {
  data: T[];
  links: { next: string | null };
  meta: { current_page: number; from: number | null; to: number | null };
}

/** บทบาทใช้ความเข้มของสีธีม (ไม่ใช้สีสถานะของระบบ) */
const ROLE_STYLE: Record<User["role"], string> = {
  admin: "bg-accent-300 text-accent-900 dark:bg-accent-400/35 dark:text-accent-100",
  manager: "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-200",
  viewer: "bg-surface text-muted ring-1 ring-inset ring-line",
};

const SAVED = ["created", "updated", "deleted"] as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/assets"); // API อนุญาตเฉพาะ admin / manager

  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const isAdmin = user.role === "admin";
  const [{ t }, can] = await Promise.all([getI18n(), getAccess()]);
  const saved = SAVED.find((s) => s === params.saved);

  // อนุญาตเฉพาะค่าที่รู้จักก่อนส่งต่อ API
  const q = new URLSearchParams();
  if (str("search")) q.set("search", str("search"));
  if (isAdmin && (ROLES as readonly string[]).includes(str("role"))) q.set("role", str("role"));
  if (isAdmin && ["active", "inactive"].includes(str("status"))) q.set("status", str("status"));
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UsersIcon}
        title={t("users.title")}
        subtitle={isAdmin ? t("users.manageSubtitle") : t("users.subtitle")}
        actions={
          isAdmin && can("btn:users:create") && (
            <Link href="/users/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("users.add")}
            </Link>
          )
        }
      />

      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`users.saved.${saved}`)}
        </div>
      )}

      <Form action="/users" className={`grid grid-cols-1 gap-3 p-4 ${isAdmin ? "sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto]" : "sm:grid-cols-[1fr_auto]"} ${card}`}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("users.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        {isAdmin && (
          <>
            <select name="role" defaultValue={str("role")} className={input} aria-label={t("users.col.role")}>
              <option value="">{t("users.allRoles")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={str("status")} className={input} aria-label={t("users.col.status")}>
              <option value="">{t("users.allStatuses")}</option>
              <option value="active">{t("users.statuses.active")}</option>
              <option value="inactive">{t("users.statuses.inactive")}</option>
            </select>
          </>
        )}
        <div className="flex gap-2">
          {isAdmin && (
            <Tooltip label={t("common.clearFilters")} side="top">
              <Link href="/users" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
                <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
              </Link>
            </Tooltip>
          )}
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={q.toString()} fallback={<TableSkeleton cols={isAdmin ? 5 : 2} />}>
        {isAdmin ? <ManagedUsers query={q} selfId={user.id} /> : <UserResults query={q} />}
      </Suspense>
    </div>
  );
}

/** admin: ตารางจัดการผู้ใช้ */
async function ManagedUsers({ query, selfId }: { query: URLSearchParams; selfId: number }) {
  const q = new URLSearchParams(query);
  q.set("manage", "1");
  q.set("per_page", "25");
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<ManagedUser>>(`/users?${q}`), getI18n()]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/users?${n}`;
  };

  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("users.empty")}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("users.col.name")}</th>
              <th className={table.th}>{t("users.col.role")}</th>
              <th className={table.th}>{t("users.col.status")}</th>
              <th className={`${table.th} text-right`}>{t("users.col.assets")}</th>
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((u) => (
              <tr key={u.id} className={`${table.row} ${u.is_active ? "" : "opacity-60"}`}>
                <td className={table.td}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">
                      {initials(u.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        {u.name}
                        {u.id === selfId && (
                          <span className="rounded-full bg-accent-200 px-2 py-0.5 text-[10px] font-semibold text-accent-800 dark:bg-accent-400/25 dark:text-accent-200">
                            {t("users.you")}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className={table.td}>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLE[u.role]}`}>{t(`roles.${u.role}`)}</span>
                </td>
                <td className={table.td}>
                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${u.is_active ? tone.success.badge : tone.idle.badge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
                    {u.is_active ? t("users.statuses.active") : t("users.statuses.inactive")}
                  </span>
                </td>
                <td className={`${table.td} whitespace-nowrap text-right tabular-nums text-muted`}>
                  {t("users.assetsCount", { count: fmt.number(u.custodian_assets_count ?? 0) })}
                </td>
                <td className={`${table.td} text-right`}>
                  <Link href={`/users/${u.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                    <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                    {t("common.edit")}
                  </Link>
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

/** manager: รายชื่อผู้ใช้ที่ใช้งานอยู่ (ดูอย่างเดียว) */
async function UserResults({ query }: { query: URLSearchParams }) {
  const q = new URLSearchParams(query);
  q.set("per_page", "25");
  const [res, { t }] = await Promise.all([apiFetch<SimplePage<UserOption>>(`/users?${q}`), getI18n()]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/users?${n}`;
  };

  return (
    <div className="space-y-3">
      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("users.empty")}</div>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>{t("users.col.name")}</th>
                <th className={table.th}>{t("users.col.email")}</th>
              </tr>
            </thead>
            <tbody className={table.body}>
              {res.data.map((u) => (
                <tr key={u.id} className={table.row}>
                  <td className={table.td}>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">
                        {initials(u.name)}
                      </span>
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className={`${table.td} text-muted`}>{u.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={res.meta} href={pageHref} hasNext={Boolean(res.links.next)} />
    </div>
  );
}
