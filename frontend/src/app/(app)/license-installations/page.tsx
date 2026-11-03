import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeftIcon, MonitorIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canEditAssets, canViewLicenses, getAccess, has, getCurrentUser } from "@/lib/auth";
import type { Branch, LicenseInstallation, LicenseSummary } from "@/lib/types";
import { InstallForm } from "./install-form";
import { RowActions } from "./row-actions";
import { LicenseCard } from "../licenses/license-card";
import { AppSelect } from "@/components/app-select";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("installations.title") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "removed", "all"] as const;

/**
 * การติดตั้ง License ของซอฟต์แวร์ 1 รายการ — เปิดจากเมนู License ซอฟต์แวร์ (/licenses → "เครื่องที่ติดตั้ง")
 * ไม่ระบุ license / ไม่พบ = กลับไปรายการ (ไม่มีเมนูแยกแล้ว)
 */
export default async function LicenseInstallationsPage({ searchParams }: PageProps<"/license-installations">) {
  const user = await getCurrentUser();
  if (!has(user, "licenses.install")) redirect(canViewLicenses(user) ? "/licenses" : "/dashboard");
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 100) : "");
  const license = UUID_RE.test(str("license")) ? str("license") : "";
  if (!license) redirect("/licenses");
  const status = STATUSES.find((s) => s === params.status) ?? "active";

  const [{ t, fmt }, { data: licenses }, { data: branches }, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: LicenseSummary[] }>("/licenses"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getAccess(),
  ]);
  const current = licenses.find((l) => l.id === license);
  if (!current) redirect("/licenses");

  const q = new URLSearchParams({ status, per_page: "25", license_id: license });
  if (str("search")) q.set("search", str("search"));
  if (/^d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <Link href="/licenses" className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-ink">
        <LinkPendingIcon icon={<ChevronLeftIcon width={15} height={15} />} size={15} />
        {t("licenses.back")}
      </Link>
      <PageHeader icon={MonitorIcon} title={t("installations.title")} subtitle={t("installations.subtitle")} />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <LicenseCard license={current} t={t} fmt={fmt} showInstalls={false} canEdit={canEditAssets(user) && can("btn:assets:edit")} />
      </ul>

      <InstallForm key={license} licenses={[current]} branches={branches} defaultLicense={license} />

      <Form action="/license-installations" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_auto] ${card}`}>
        <input type="hidden" name="license" value={license} />
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("installations.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <AppSelect name="status" defaultValue={status} className={input} aria-label={t("installations.status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`installations.statuses.${s}`)}
            </option>
          ))}
        </AppSelect>
        <div className="flex gap-2">
          <Link href={`/license-installations?license=${license}`} className={`${btn.secondary} px-3`} aria-label={t("common.clearFilters")}>
            <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
          </Link>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={q.toString()} fallback={<TableSkeleton cols={5} />}>
        <Installations query={q} pageParams={params} />
      </Suspense>
    </div>
  );
}

async function Installations({ query, pageParams }: { query: URLSearchParams; pageParams: Record<string, string | string[] | undefined> }) {
  const [res, { t, fmt }] = await Promise.all([
    apiFetch<{ data: LicenseInstallation[]; meta: { current_page: number; last_page: number; total: number; from: number | null; to: number | null } }>(
      `/license-installations?${query}`,
    ),
    getI18n(),
  ]);
  const pageHref = (page: number) => {
    const n = new URLSearchParams();
    for (const k of ["license", "status", "search"]) if (typeof pageParams[k] === "string" && pageParams[k]) n.set(k, pageParams[k] as string);
    n.set("page", String(page));
    return `/license-installations?${n}`;
  };
  const device = (i: LicenseInstallation) =>
    i.device ? (
      <Link href={`/assets/${i.device.id}`} className="cursor-pointer hover:underline">
        <span className="font-mono text-xs text-muted">{i.device.asset_tag}</span> {i.device.name}
      </Link>
    ) : (
      <span>{i.device_name}</span>
    );
  const label = (i: LicenseInstallation) => (i.device ? `${i.device.asset_tag} ${i.device.name}` : (i.device_name ?? ""));
  const statusBadge = (i: LicenseInstallation) =>
    i.uninstalled_at ? (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("installations.removedOn", { date: fmt.date(i.uninstalled_at) })}</span>
    ) : (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.success.badge}`}>{t("installations.statuses.active")}</span>
    );

  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("installations.empty")}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("installations.total", { count: fmt.number(res.meta.total) })}</p>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("installations.device")}</th>
              <th className={table.th}>{t("installations.user")}</th>
              <th className={table.th}>{t("installations.branch")}</th>
              <th className={table.th}>{t("installations.installedAt")}</th>
              <th className={table.th}>{t("installations.status")}</th>
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {res.data.map((i) => (
              <tr key={i.id} className={`${table.row} align-top`}>
                <td className={table.td}>
                  {device(i)}
                  {i.notes && <div className="text-xs text-muted">{i.notes}</div>}
                </td>
                <td className={table.td}>{i.user?.name ?? "-"}</td>
                <td className={table.td}>{i.branch?.name ?? "-"}</td>
                <td className={`${table.td} whitespace-nowrap`}>{fmt.date(i.installed_at)}</td>
                <td className={table.td}>{statusBadge(i)}</td>
                <td className={`${table.td} text-right`}>
                  <RowActions id={i.id} licenseId={i.license.id} active={!i.uninstalled_at} label={label(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {res.data.map((i) => (
          <li key={i.id} className={`space-y-1.5 p-4 text-sm ${card}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{device(i)}</div>
              {statusBadge(i)}
            </div>
            {i.notes && <div className="text-xs text-muted">{i.notes}</div>}
            <div className="text-xs text-muted">
              {[i.user?.name, i.branch?.name, fmt.date(i.installed_at)].filter(Boolean).join(" · ")}
            </div>
            <div className="flex justify-end">
              <RowActions id={i.id} licenseId={i.license.id} active={!i.uninstalled_at} label={label(i)} />
            </div>
          </li>
        ))}
      </ul>
      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}
