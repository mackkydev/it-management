import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppSelect } from "@/components/app-select";
import { ConfirmDownload } from "@/components/confirm-download";
import { DatabaseIcon, DownloadIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SubmitButton } from "@/components/pending";
import { btn, card, input, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { assetCategoryNames } from "@/lib/asset-categories";
import { assetCategoryLabel, CATEGORIES, type FixedAsset, type FixedAssetList, type FixedAssetTab } from "@/lib/types";
import { AutoLinkButton } from "./auto-link-button";
import { CreateAssetsBar, FaSelectAllBox, FaSelectBox, FaSelectionProvider } from "./create-assets";
import { LinkFixedAssetButton } from "./link-button";
import { UnlinkAllButton } from "./unlink-all-button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("fixedAssets.title") };
}

const TABS: FixedAssetTab[] = ["all", "unlinked", "disposed_active", "missing"];
const FILTERS = ["search", "site", "fa_class", "fa_dept", "status", "link"] as const;
const LINK_FILTERS = ["linked", "unlinked"] as const;
const TAB_CLS = (active: boolean) =>
  `inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
/** หัวคอลัมน์ตาราง (บรรทัดบน = ชื่อตามภาษา, บรรทัดล่าง = ชื่อฟิลด์ SyteLine) — ลำดับตาม Fixed assets info ข้อ 3.27 */
const HEAD_COLS = ["site", "class", "dept", "fanum", "mfg", "description", "status", "endUser", "serial", "recordDate", "asset"] as const;
const STATUS_TONE: Record<string, string> = { Active: tone.success.badge, Disposed: tone.idle.badge, Inactive: tone.warning.badge };

/**
 * สินทรัพย์ IT → Fixed Assets (SyteLine): สำเนาอ่านอย่างเดียวจาก STEC SyteLine (ซิงค์ที่ ตั้งค่าระบบ → SyteLine Fixed Assets)
 * แท็บที่ต้องจัดการ (ยังไม่ผูก / จำหน่ายแล้วแต่ยังใช้งาน) มีตัวเลขแดง = ตัวเลขเมนู — ผูกกับสินทรัพย์ในระบบด้วยมือได้ (fixed_assets.link)
 */
export default async function FixedAssetsPage({ searchParams }: PageProps<"/fixed-assets">) {
  const [sp, user, { t, fmt }, access] = await Promise.all([searchParams, getCurrentUser(), getI18n(), getAccess()]);
  if (!has(user, "fixed_assets.view")) redirect("/dashboard");
  const tab = TABS.find((x) => x === sp.tab) ?? "all";
  const page = typeof sp.page === "string" && /^\d+$/.test(sp.page) ? sp.page : "1";
  // แท็บ "ยังไม่ผูก" ไม่มีตัวกรองการผูก (เลือก "ผูกแล้ว" จะขัดกับแท็บจนไม่เจอรายการเลย)
  const showLinkFilter = tab !== "unlinked";
  const filters = Object.fromEntries(
    FILTERS.map((k) => [k, typeof sp[k] === "string" ? String(sp[k]).slice(0, 100) : ""]).filter(([k, v]) => v && (k !== "link" || showLinkFilter)),
  );
  const query = (extra: Record<string, string>) => new URLSearchParams({ ...filters, ...extra }).toString();
  const res = await apiFetch<FixedAssetList>(`/fixed-assets?${query({ tab, page })}`);
  const { counts, options, last_sync: lastSync } = res.meta;
  const canLink = res.meta.can_link && access("btn:fixed-assets:link");
  // เลือกหลายรายการที่ยังไม่ผูก → เพิ่มเข้าระบบสินทรัพย์ (สร้างใหม่ + ผูก)
  const canCreate = res.meta.can_link && has(user, "assets.create") && access("btn:fixed-assets:create-assets");
  const categories = canCreate
    ? [...CATEGORIES, ...(await assetCategoryNames().catch(() => []))].map((c) => ({ value: c, label: assetCategoryLabel(t, c) }))
    : [];
  const selectable = canCreate ? res.data.filter((fa) => !fa.asset).map((fa) => ({ id: fa.id, fanum: fa.fanum })) : [];
  const showLinkGroup = res.meta.can_link && (access("btn:fixed-assets:unlink-all") || access("btn:fixed-assets:auto-link"));
  const statusLabel = (s: string | null) => (s ? t(`fixedAssets.statuses.${s}` as MessageKey) : "—");
  const badge = (n: number) =>
    n > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-500 px-1.5 text-2xs font-semibold text-white">{n > 99 ? "99+" : n}</span>;
  const tabCount: Partial<Record<FixedAssetTab, number>> = { unlinked: counts.unlinked, disposed_active: counts.disposed_active };

  const assetCell = (fa: FixedAsset) =>
    fa.asset ? (
      <Link href={`/assets/${fa.asset.id}`} className="group block cursor-pointer">
        <span className="font-mono text-xs text-accent-700 group-hover:underline dark:text-accent-300">{fa.asset.cpu_tag || fa.asset.asset_tag}</span>
        <span className="block text-sm group-hover:underline">{fa.asset.name}</span>
        {fa.link_source === "manual" && <span className="text-2xs text-muted">{t("fixedAssets.linkSource.manual")}</span>}
      </Link>
    ) : (
      <span className="text-faint">{t("fixedAssets.notLinked")}</span>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={DatabaseIcon}
        title={t("fixedAssets.title")}
        subtitle={t("fixedAssets.subtitle")}
        actions={
          <>
            {/* ผูก / ยกเลิกการผูก = กลุ่มเดียวกัน */}
            {showLinkGroup && (
              <div role="group" aria-label={t("fixedAssets.linkActions")} className="flex flex-wrap items-center gap-1 rounded-xl bg-subtle p-1">
                {access("btn:fixed-assets:auto-link") && <AutoLinkButton />}
                {access("btn:fixed-assets:unlink-all") && <UnlinkAllButton />}
              </div>
            )}
            {access("btn:fixed-assets:export") && (
              <ConfirmDownload href={`/fixed-assets/export?${query({ tab })}`} className={btn.secondary}>
                <DownloadIcon />
                {t("fixedAssets.export")}
              </ConfirmDownload>
            )}
          </>
        }
      />

      <p className="text-sm text-muted">
        {lastSync
          ? t("fixedAssets.lastSync", { at: fmt.dateTime(lastSync.finished_at ?? lastSync.started_at), status: t(`fixedAssetSync.runStatuses.${lastSync.status}` as MessageKey) })
          : t("fixedAssets.neverSynced")}
        {has(user, "settings.manage") && (
          <>
            {" "}
            <Link href="/settings?tab=syteline" className="cursor-pointer font-medium text-accent-700 underline hover:no-underline dark:text-accent-300">
              {t("fixedAssets.openSyncSettings")}
            </Link>
          </>
        )}
      </p>

      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((x) => (
          <Link key={x} href={`/fixed-assets?${query({ tab: x })}`} aria-current={x === tab ? "page" : undefined} className={TAB_CLS(x === tab)}>
            {t(`fixedAssets.tabs.${x}`)}
            {badge(tabCount[x] ?? 0)}
            {x === "missing" && counts.missing > 0 && <span className="text-xs text-muted">{fmt.number(counts.missing)}</span>}
          </Link>
        ))}
      </nav>

      {tab !== "all" && <p className="text-sm text-muted">{t(`fixedAssets.tabHints.${tab}`)}</p>}

      <Form action="/fixed-assets" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 ${showLinkFilter ? "xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto]" : "xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]"} ${card}`}>
        <input type="hidden" name="tab" value={tab} />
        <div className="relative sm:col-span-2 xl:col-span-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={filters.search ?? ""} placeholder={t("fixedAssets.searchPlaceholder")} maxLength={100} aria-label={t("common.search")} className={`${input} pl-9`} />
        </div>
        {(
          [
            ["site", options.sites, "fixedAssets.allSites"],
            ["fa_class", options.classes, "fixedAssets.allClasses"],
            ["fa_dept", options.departments, "fixedAssets.allDepartments"],
            ["status", options.statuses, "fixedAssets.allStatuses"],
          ] as const
        ).map(([name, list, all]) => (
          <AppSelect key={name} name={name} defaultValue={filters[name]} className={input} aria-label={t(all)}>
            <option value="">{t(all)}</option>
            {list.map((v) => (
              <option key={v} value={v}>
                {name === "status" ? statusLabel(v) : v}
              </option>
            ))}
          </AppSelect>
        ))}
        {showLinkFilter && (
          <AppSelect name="link" defaultValue={filters.link} className={input} aria-label={t("fixedAssets.allLinks")}>
            <option value="">{t("fixedAssets.allLinks")}</option>
            {LINK_FILTERS.map((v) => (
              <option key={v} value={v}>
                {t(`fixedAssets.linkFilter.${v}`)}
              </option>
            ))}
          </AppSelect>
        )}
        <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} whitespace-nowrap`}>
          {t("common.search")}
        </SubmitButton>
      </Form>

      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{lastSync ? t(`fixedAssets.empty.${tab}`) : t("fixedAssets.neverSynced")}</div>
      ) : (
        <FaSelectionProvider>
          {/* จอใหญ่: ตาราง */}
          {/* ทุกช่องอยู่บรรทัดเดียว — เกินความกว้างเลื่อนด้วยแถบเลื่อนแนวนอน (.scroll-x) */}
          <div className={`scroll-x hidden lg:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  {canCreate && (
                    <th className={`${table.th} w-10`}>
                      <FaSelectAllBox rows={selectable} />
                    </th>
                  )}
                  {/* ลำดับคอลัมน์ตามฟิลด์ Fixed assets info (ข้อ 3.27) */}
                  {HEAD_COLS.map((k) => (
                    <th key={k} className={`${table.th} whitespace-nowrap`}>
                      <span className="block">{t(`fixedAssets.col.${k}`)}</span>
                      {t(`fixedAssets.colSource.${k}`) !== t(`fixedAssets.col.${k}`) && (
                        <span className="block text-2xs font-normal normal-case tracking-normal text-faint">{t(`fixedAssets.colSource.${k}`)}</span>
                      )}
                    </th>
                  ))}
                  {canLink && <th className={table.th} aria-label={t("common.manage")} />}
                </tr>
              </thead>
              <tbody className={table.body}>
                {res.data.map((fa) => (
                  <tr key={fa.id} className={table.row}>
                    {canCreate && <td className={table.td}>{!fa.asset && <FaSelectBox id={fa.id} fanum={fa.fanum} />}</td>}
                    <td className={`${table.td} whitespace-nowrap`}>
                      {fa.site}
                      {fa.branch && <span className="text-xs text-muted"> · {fa.branch.name}</span>}
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{fa.fa_class || "—"}</td>
                    <td className={`${table.td} whitespace-nowrap`}>{fa.fa_dept || "—"}</td>
                    <td className={`${table.td} whitespace-nowrap font-mono text-xs text-accent-700 dark:text-accent-300`}>{fa.fanum}</td>
                    <td className={`${table.td} whitespace-nowrap font-mono text-xs`}>{fa.mfg || "—"}</td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      {fa.description || "—"}
                      {fa.missing_since && (
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${tone.warning.badge}`}>
                          {t("fixedAssets.missingSince", { date: fmt.date(fa.missing_since) })}
                        </span>
                      )}
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[fa.fa_status ?? ""] ?? tone.idle.badge}`}>{statusLabel(fa.fa_status)}</span>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{fa.end_user || "—"}</td>
                    <td className={`${table.td} whitespace-nowrap font-mono text-xs`}>{fa.serial || "—"}</td>
                    <td className={`${table.td} whitespace-nowrap`}>{fa.record_date ? fmt.date(fa.record_date) : "—"}</td>
                    <td className={`${table.td} whitespace-nowrap`}>{assetCell(fa)}</td>
                    {canLink && (
                      <td className={`${table.td} whitespace-nowrap text-right`}>
                        <LinkFixedAssetButton fa={fa} compact />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* มือถือ / แท็บเล็ต: การ์ด */}
          <ul className="space-y-3 lg:hidden">
            {res.data.map((fa) => (
              <li key={fa.id} className={`space-y-2 p-4 ${card}`}>
                <div className="flex items-start justify-between gap-3">
                  {canCreate && !fa.asset && (
                    <span className="pt-0.5">
                      <FaSelectBox id={fa.id} fanum={fa.fanum} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-accent-700 dark:text-accent-300">{fa.fanum}</span>
                    <span className="text-xs text-muted"> · {fa.site}{fa.branch ? ` (${fa.branch.name})` : ""}</span>
                    <p className="font-medium">{fa.description}</p>
                    {fa.missing_since && (
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${tone.warning.badge}`}>
                    {t("fixedAssets.missingSince", { date: fmt.date(fa.missing_since) })}
                  </span>
                )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[fa.fa_status ?? ""] ?? tone.idle.badge}`}>{statusLabel(fa.fa_status)}</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("fixedAssets.col.class")}</dt>
                  <dd>{fa.fa_class || "—"}</dd>
                  <dt className="text-muted">{t("fixedAssets.col.dept")}</dt>
                  <dd>{fa.fa_dept || "—"}</dd>
                  <dt className="text-muted">{t("fixedAssets.col.mfg")}</dt>
                  <dd className="break-all">{fa.mfg || "—"}</dd>
                  <dt className="text-muted">{t("fixedAssets.col.endUser")}</dt>
                  <dd className="break-words">{fa.end_user || "—"}</dd>
                  <dt className="text-muted">{t("fixedAssets.col.serial")}</dt>
                  <dd className="break-all font-mono text-xs">{fa.serial || "—"}</dd>
                  <dt className="text-muted">{t("fixedAssets.col.recordDate")}</dt>
                  <dd>{fa.record_date ? fmt.date(fa.record_date) : "—"}</dd>
                </dl>
                <div className="flex items-end justify-between gap-3 border-t border-line pt-2">
                  <div className="min-w-0">{assetCell(fa)}</div>
                  {canLink && <LinkFixedAssetButton fa={fa} />}
                </div>
              </li>
            ))}
          </ul>
          <Pagination meta={res.meta} href={(n: number) => `/fixed-assets?${query({ tab, page: String(n) })}`} />
          {canCreate && <CreateAssetsBar categories={categories} />}
        </FaSelectionProvider>
      )}
    </div>
  );
}
