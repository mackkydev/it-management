import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckCircleIcon, KeyIcon, PencilIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { alert, btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getAccess, getCurrentUser } from "@/lib/auth";
import { CREDENTIAL_CATEGORIES, type Credential, type Paginated } from "@/lib/types";
import { RevealPassword } from "./reveal-password";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** 4.1.1 คลังบัญชี/รหัสผ่าน — admin และเจ้าหน้าที่ IT */
export default async function VaultPage({ searchParams }: PageProps<"/vault">) {
  const user = await getCurrentUser();
  if (!has(user, "vault.use")) redirect("/tickets");
  const params = await searchParams;
  const [{ t }, can] = await Promise.all([getI18n(), getAccess()]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const saved = SAVED.find((s) => s === params.saved);

  const q = new URLSearchParams();
  if (str("search")) q.set("search", str("search"));
  if ((CREDENTIAL_CATEGORIES as readonly string[]).includes(str("category"))) q.set("category", str("category"));
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader
        icon={KeyIcon}
        title={t("vault.title")}
        subtitle={t("vault.subtitle")}
        actions={
          can("btn:vault:create") && (
            <Link href="/vault/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("vault.add")}
            </Link>
          )
        }
      />
      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`vault.saved.${saved}`)}
        </div>
      )}
      <Form action="/vault" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_14rem_auto] ${card}`}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("vault.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <select name="category" defaultValue={str("category")} className={input} aria-label={t("vault.col.category")}>
          <option value="">{t("vault.allCategories")}</option>
          {CREDENTIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`vault.categories.${c}`)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Link href="/vault" className={`${btn.secondary} px-3`} aria-label={t("common.clearFilters")}>
            <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
          </Link>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>
      <Suspense key={q.toString()} fallback={<TableSkeleton cols={6} />}>
        <VaultResults query={q} />
      </Suspense>
    </div>
  );
}

async function VaultResults({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }, can] = await Promise.all([apiFetch<Paginated<Credential>>(`/credentials?${query}&per_page=25`), getI18n(), getAccess()]);
  const canReveal = can("btn:vault:reveal");
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/vault?${n}`;
  };

  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("vault.empty")}</div>;

  const expiry = (c: Credential) => {
    if (!c.expires_at) return "-";
    const days = Math.ceil((new Date(c.expires_at).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    const style = days < 0 ? tone.danger.badge : days <= 30 ? tone.warning.badge : "";
    return <span className={style ? `rounded-full px-2 py-0.5 text-xs font-medium ${style}` : ""}>{fmt.date(c.expires_at)}</span>;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t("common.total", { count: fmt.number(res.meta.total) })}</span>
        <span className="text-xs">{t("vault.revealLogged")}</span>
      </div>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={`${table.th} min-w-48`}>{t("vault.col.title")}</th>
              <th className={`${table.th} whitespace-nowrap`}>{t("vault.col.username")}</th>
              <th className={`${table.th} whitespace-nowrap`}>{t("vault.col.password")}</th>
              <th className={`${table.th} whitespace-nowrap`}>{t("vault.col.expires")}</th>
              <th className={`${table.th} whitespace-nowrap`}>{t("vault.col.updated")}</th>
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((c) => (
              <tr key={c.id} className={`${table.row} align-top`}>
                <td className={table.td}>
                  <div className="font-medium">{c.title}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="rounded-full bg-subtle px-2 py-0.5 ring-1 ring-inset ring-line">{t(`vault.categories.${c.category}`)}</span>
                    {c.url && <span className="max-w-56 truncate font-mono">{c.url}</span>}
                    {c.branch && <span>· {c.branch.name}</span>}
                  </div>
                </td>
                <td className={`${table.td} font-mono text-xs`}>{c.username ?? "-"}</td>
                <td className={table.td}>{c.has_password ? (canReveal ? <RevealPassword id={c.id} /> : <code className="rounded-lg bg-subtle px-2 py-1 font-mono text-xs">••••••••••</code>) : <span className="text-xs text-faint">{t("vault.noPassword")}</span>}</td>
                <td className={`${table.td} whitespace-nowrap`}>{expiry(c)}</td>
                <td className={`${table.td} whitespace-nowrap text-xs text-muted`}>
                  {c.updated_at ? fmt.dateTime(c.updated_at) : "-"}
                  {c.updated_by && <div>{c.updated_by}</div>}
                </td>
                <td className={`${table.td} text-right`}>
                  <Link href={`/vault/${c.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
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
