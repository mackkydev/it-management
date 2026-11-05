import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { Tooltip } from "@/components/tooltip";
import { FlashToast } from "@/components/toast";
import { btn, card, input } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canCreateAssets, canEditAssets, canViewLicenses, getAccess, getCurrentUser, has } from "@/lib/auth";
import { isSoftwareType, SOFTWARE_TYPES, type LicenseSummary } from "@/lib/types";
import { LicenseCard, LicenseGroupCard, licenseGroupKey } from "./license-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** สินทรัพย์ IT → ซอฟต์แวร์ License (ตาราง licenses แยกจากสินทรัพย์) — แท็บตามประเภท Office / OS / Anti Virus / อื่นๆ */
export default async function LicensesPage({ searchParams }: PageProps<"/licenses">) {
  const [user, can, params] = await Promise.all([getCurrentUser(), getAccess(), searchParams]);
  if (!canViewLicenses(user)) redirect("/dashboard");
  const search = typeof params.search === "string" ? params.search.slice(0, 100).trim() : "";
  const saved = SAVED.find((s) => s === params.saved);
  // แท็บ: ทั้งหมด / ตามประเภท / "กำลังจะหมดอายุ" (ตัวเลขแดงเท่ากับตัวเลขเมนู — หายเมื่อต่อสัญญา/ยกเลิก)
  const type = isSoftwareType(params.type) || params.type === "expiring" ? params.type : null;

  const [{ t, fmt }, { data: licenses }] = await Promise.all([getI18n(), apiFetch<{ data: LicenseSummary[] }>("/licenses")]);
  // รายการไม่ยาว — กรองชื่อ / รหัส / ผู้ขาย ที่หน้าเว็บ
  const term = search.toLocaleLowerCase();
  const found = term ? licenses.filter((l) => [l.name, l.license_no ?? "", l.serial_number ?? "", l.vendor ?? ""].some((s) => s.toLocaleLowerCase().includes(term))) : licenses;
  const inTab = (l: LicenseSummary, k: string | null) => (k === "expiring" ? l.expiring : k ? l.software_type === k : true);
  const shown = found.filter((l) => inTab(l, type));
  const countOf = (k: string | null) => found.filter((l) => inTab(l, k)).length;
  // ชื่อเดียวกันหลายรายการ (เช่น กล่องละ S/N) = การ์ดรวมใบเดียว
  const byName = new Map<string, LicenseSummary[]>();
  for (const l of shown) byName.set(licenseGroupKey(l.name), [...(byName.get(licenseGroupKey(l.name)) ?? []), l]);
  const groups = [...byName.values()];
  const tabHref = (k: string | null) => {
    const q = new URLSearchParams();
    if (k) q.set("type", k);
    if (search) q.set("search", search);
    const qs = q.toString();
    return qs ? (`/licenses?${qs}` as const) : ("/licenses" as const);
  };
  const canCreate = canCreateAssets(user) && can("btn:licenses:create");
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
            <Link href={type && type !== "expiring" ? `/licenses/new?type=${type}` : "/licenses/new"} className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("licenses.add")}
            </Link>
          )
        }
      />

      {saved && <FlashToast param="saved" message={t(`licenses.saved.${saved}`)} />}

      {/* แท็บประเภท (หมวดหมู่ของซอฟต์แวร์ License) + จำนวน */}
      <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1 sm:inline-flex">
        {[null, ...SOFTWARE_TYPES, "expiring" as const].map((k) => (
          <Link
            key={k ?? "all"}
            role="tab"
            aria-selected={type === k}
            href={tabHref(k)}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${type === k ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}
          >
            {k === "expiring" ? t("licenses.expiringTab") : k ? t(`licenses.types.${k}`) : t("licenses.allTypes")}
            {k === "expiring" ? (
              countOf(k) > 0 && <span className="rounded-full bg-danger-500 px-1.5 text-xs font-semibold tabular-nums text-white">{fmt.number(countOf(k))}</span>
            ) : (
              <span className="rounded-full bg-canvas px-1.5 text-xs tabular-nums text-muted">{fmt.number(countOf(k))}</span>
            )}
          </Link>
        ))}
      </div>

      <Form action="/licenses" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] ${card}`}>
        {type && <input type="hidden" name="type" value={type} />}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={search} placeholder={t("licenses.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <div className="flex gap-2">
          <Tooltip label={t("common.clearFilters")}>
            <Link href={tabHref(type)} className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1 whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <p className="text-sm text-muted">{t("licenses.total", { count: fmt.number(groups.length) })}</p>
      {shown.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{search || type ? t("licenses.notFound") : t("licenses.empty")}</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((items) =>
            items.length > 1 ? (
              <LicenseGroupCard key={items[0].id} items={items} t={t} fmt={fmt} />
            ) : (
              <LicenseCard key={items[0].id} license={items[0]} t={t} fmt={fmt} showInstalls={canInstall} canEdit={canEdit} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
