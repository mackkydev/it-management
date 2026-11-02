import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, KeyIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canCreateAssets, canEditAssets, canViewLicenses, getAccess, getCurrentUser, has } from "@/lib/auth";
import type { LicenseSummary } from "@/lib/types";
import { LicenseCard } from "./license-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** สินทรัพย์ IT → License ซอฟต์แวร์ (สินทรัพย์หมวด SOFTWARE แยกจากรายการสินทรัพย์) */
export default async function LicensesPage({ searchParams }: PageProps<"/licenses">) {
  const [user, can, params] = await Promise.all([getCurrentUser(), getAccess(), searchParams]);
  if (!canViewLicenses(user)) redirect("/dashboard");
  const search = typeof params.search === "string" ? params.search.slice(0, 100).trim() : "";
  const saved = SAVED.find((s) => s === params.saved);

  const [{ t, fmt }, { data: licenses }] = await Promise.all([getI18n(), apiFetch<{ data: LicenseSummary[] }>("/license-installations/licenses")]);
  // รายการไม่ยาว — กรองชื่อ / รหัส / ผู้ขาย ที่หน้าเว็บ
  const term = search.toLocaleLowerCase();
  const shown = term ? licenses.filter((l) => [l.name, l.asset_tag, l.vendor ?? ""].some((s) => s.toLocaleLowerCase().includes(term))) : licenses;
  const canCreate = canCreateAssets(user) && can("btn:assets:create");
  const canInstall = has(user, "licenses.install");
  const canEdit = canEditAssets(user) && can("btn:assets:edit");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={KeyIcon}
        title={t("licenses.title")}
        subtitle={t("licenses.subtitle")}
        actions={
          canCreate && (
            <Link href="/assets/new?category=SOFTWARE" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("licenses.add")}
            </Link>
          )
        }
      />

      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`licenses.saved.${saved}`)}
        </div>
      )}

      <Form action="/licenses" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] ${card}`}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={search} placeholder={t("licenses.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <div className="flex gap-2">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/licenses" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1 whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <p className="text-sm text-muted">{t("licenses.total", { count: fmt.number(shown.length) })}</p>
      {shown.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{search ? t("licenses.notFound") : t("licenses.empty")}</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((l) => (
            <LicenseCard key={l.id} license={l} t={t} fmt={fmt} showInstalls={canInstall} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}
