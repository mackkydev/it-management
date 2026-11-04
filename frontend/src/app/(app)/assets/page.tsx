import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { BoxIcon, DownloadIcon, PencilIcon, PlusIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Tooltip } from "@/components/tooltip";
import { FlashToast } from "@/components/toast";
import { btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { assetCategoryNames } from "@/lib/asset-categories";
import { getAccess, canCreateAssets, canEditAssets, canViewAllAssets, canViewAssets, getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { assetCategoryLabel, STATUSES, type Asset, type Branch, type Location, type MissingAsset, type Paginated } from "@/lib/types";
import { ImportAssets } from "./import-assets";
import { MissingAssets } from "./missing-assets";
import { ClickableRow } from "@/components/clickable-row";
import { AppSelect } from "@/components/app-select";
import { ConfirmDownload } from "@/components/confirm-download";


export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** อนุญาตเฉพาะพารามิเตอร์ที่รู้จัก ก่อนส่งต่อไปยัง API */
function buildQuery(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const key of ["search", "status", "category", "branch_id", "location_id", "page"]) {
    const value = params[key];
    if (typeof value === "string" && value !== "") q.set(key, value);
  }
  q.set("per_page", "20");
  return q;
}

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const params = await searchParams;
  const query = buildQuery(params);
  const { t, fmt } = await getI18n();

  // ข้อมูลส่วนหัว/ตัวกรอง (เร็ว: locations ถูก cache, user ถูก dedupe กับ layout)
  const [locations, branches, user, can] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getCurrentUser(),
    getAccess(),
  ]);
  // ผู้ใช้ทั่วไป (ไม่มี assets.view) ไม่มีเมนูสินทรัพย์ — เลือกสินทรัพย์ตอนแจ้งซ่อมได้ตามเดิม
  if (!canViewAssets(user)) redirect("/dashboard");
  // สิทธิ์เดิม (admin/manager) + การตั้งค่าหน้าสิทธิ์การใช้งาน
  const canCreate = canCreateAssets(user) && can("btn:assets:create");
  const canEdit = canEditAssets(user) && can("btn:assets:edit");
  // ส่งออก Excel ตามตัวกรองที่เลือก (ทะเบียนคอมพิวเตอร์ — คอลัมน์เดียวกับไฟล์นำเข้า)
  const canExport = canViewAllAssets(user) && can("btn:assets:export");
  const exportQuery = new URLSearchParams(query);
  exportQuery.delete("page");
  exportQuery.delete("per_page");
  const saved = SAVED.find((s) => s === params.saved);
  // แท็บ "สินทรัพย์ที่ต้องเพิ่ม" (ผู้เพิ่มสินทรัพย์ได้): เลขทรัพย์สินจากใบแจ้งซ่อมที่ยังไม่มีในระบบ
  const canSeeMissing = canCreateAssets(user);
  const missing = canSeeMissing ? (await apiFetch<{ data: MissingAsset[] }>("/assets/missing")).data : [];
  const tab = canSeeMissing && params.tab === "missing" ? "missing" : "system";
  const TAB_CLS = (active: boolean) =>
    `flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
  // ไม่มีสิทธิ์ดูทั้งหมด → API ส่งเฉพาะสินทรัพย์ที่ผู้ใช้ถือครอง
  const mineOnly = !canViewAllAssets(user);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BoxIcon}
        title={mineOnly ? t("assets.mine.title") : t("assets.title")}
        subtitle={mineOnly ? t("assets.mine.subtitle") : undefined}
        actions={
          (canCreate || canExport) && (
            <div className="flex flex-wrap gap-2">
              {canExport && (
                <Tooltip label={t("assets.import.exportHint")} side="bottom">
                  {/* ดาวน์โหลดไฟล์จาก route handler (ไม่ใช่หน้าเว็บ) */}
                  <ConfirmDownload href={`/files/assets/export?${exportQuery}`} className={btn.secondary}>
                    <DownloadIcon className="text-accent-500" />
                    {t("assets.import.export")}
                  </ConfirmDownload>
                </Tooltip>
              )}
              {canCreate && (
                <>
                  {/* นำเข้าทะเบียนคอมพิวเตอร์จาก Excel (มีปุ่มดาวน์โหลด template ใน modal) */}
                  {can("btn:assets:import") && <ImportAssets />}
                  <Link href="/assets/new" className={btn.primary}>
                    <LinkPendingIcon icon={<PlusIcon />} />
                    {t("assets.add")}
                  </Link>
                </>
              )}
            </div>
          )
        }
      />

      {saved && <FlashToast param="saved" message={t(`assets.saved.${saved}`)} />}

      {canSeeMissing && (
        <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1 sm:inline-flex">
          <Link role="tab" aria-selected={tab === "system"} href="/assets" className={TAB_CLS(tab === "system")}>
            {t("assets.tabs.system")}
          </Link>
          <Link role="tab" aria-selected={tab === "missing"} href="/assets?tab=missing" className={TAB_CLS(tab === "missing")}>
            {t("assets.tabs.missing")}
            {missing.length > 0 && (
              <span className="rounded-full bg-danger-500 px-1.5 text-xs font-semibold tabular-nums text-white">{fmt.number(missing.length)}</span>
            )}
          </Link>
        </div>
      )}

      {tab === "missing" ? (
        <MissingAssets items={missing} canAdd={can("btn:assets:add-missing")} canLink={can("btn:assets:link-missing")} />
      ) : (
        <>

      {/* ตัวกรอง: next/form = GET form ที่เปลี่ยนหน้าแบบ client-side (ยังทำงานได้แม้ปิด JavaScript) */}
      {/* จอใหญ่: ตัวกรองทั้งหมด + ปุ่มอยู่บรรทัดเดียวกัน */}
      <Form action="/assets" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto] ${card}`}>
        <div className="relative sm:col-span-2 xl:col-span-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input
            name="search"
            defaultValue={typeof params.search === "string" ? params.search : ""}
            placeholder={t("assets.searchPlaceholder")}
            maxLength={100}
            className={`${input} pl-9`}
          />
        </div>
        <AppSelect name="status" defaultValue={params.status as string | undefined} className={input}>
          <option value="">{t("assets.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="category" defaultValue={params.category as string | undefined} className={input}>
          <option value="">{t("assets.allCategories")}</option>
          {["COMPUTER", ...(await assetCategoryNames())].map((c) => (
            <option key={c} value={c}>
              {assetCategoryLabel(t, c)}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="branch_id" defaultValue={params.branch_id as string | undefined} className={input} aria-label={t("assets.col.branch")}>
          <option value="">{t("assets.allBranches")}</option>
          {branches.data.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="location_id" defaultValue={params.location_id as string | undefined} className={input}>
          <option value="">{t("assets.allLocations")}</option>
          {locations.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {l.name}
            </option>
          ))}
        </AppSelect>
        <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/assets" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1 whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      {/* key ตามเงื่อนไขค้นหา: เปลี่ยนตัวกรอง/หน้า → แสดง skeleton ระหว่างรอข้อมูลชุดใหม่ */}
      <Suspense key={query.toString()} fallback={<TableSkeleton />}>
        <AssetResults query={query} canEdit={canEdit} mineOnly={mineOnly} />
      </Suspense>
        </>
      )}
    </div>
  );
}

async function AssetResults({ query, canEdit, mineOnly }: { query: URLSearchParams; canEdit: boolean; mineOnly: boolean }) {
  const [assets, { t, fmt }] = await Promise.all([apiFetch<Paginated<Asset>>(`/assets?${query}`), getI18n()]);
  const { meta } = assets;

  const pageHref = (page: number) => {
    const q = new URLSearchParams(query);
    q.delete("per_page");
    q.set("page", String(page));
    return `/assets?${q}`;
  };

  const editLink = (a: Asset, full = false) => (
    <Link href={`/assets/${a.id}/edit`} className={full ? `${btn.soft} mt-3 w-full` : `${btn.soft} ${btn.sm}`}>
      <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
      {t("common.edit")}
    </Link>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(meta.total) })}</p>

      {assets.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{mineOnly && !query.get("search") ? t("assets.mine.empty") : t("assets.empty")}</div>
      ) : (
        <>
          {/* Desktop / Tablet แนวนอน: ตาราง */}
          <div className={`hidden md:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("assets.col.tag")}</th>
                  <th className={table.th}>{t("assets.col.name")}</th>
                  <th className={table.th}>{t("assets.col.category")}</th>
                  <th className={table.th}>{t("assets.col.branch")}</th>
                  <th className={table.th}>{t("assets.col.location")}</th>
                  <th className={table.th}>{t("assets.col.custodian")}</th>
                  <th className={table.th}>{t("assets.col.status")}</th>
                  <th className={`${table.th} text-right`}>{t("assets.col.cost")}</th>
                  {canEdit && <th className={table.th} aria-label={t("common.manage")} />}
                </tr>
              </thead>
              <tbody className={table.body}>
                {assets.data.map((a) => (
                  <ClickableRow key={a.id} href={`/assets/${a.id}`} className={table.row}>
                    <td className={`${table.td} whitespace-nowrap font-mono text-xs text-muted`}>{a.asset_tag}</td>
                    <td className={table.td}>
                      <Link href={`/assets/${a.id}`} className="cursor-pointer font-medium text-ink hover:text-accent-700 hover:underline dark:hover:text-accent-300">
                        {a.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {[a.brand, a.model].filter(Boolean).join(" ")}
                        {a.serial_number && ` · S/N ${a.serial_number}`}
                      </div>
                      {/* คอมพิวเตอร์: ผู้ใช้งาน / IP / OS */}
                      {(a.user_name || a.ip_address || a.os) && (
                        <div className="text-xs text-muted">{[a.user_name, a.ip_address, a.os].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className={table.td}>
                      {assetCategoryLabel(t, a.category)}
                    </td>
                    <td className={table.td}>{a.branch?.name ?? "-"}</td>
                    <td className={table.td}>{a.location?.name ?? "-"}</td>
                    <td className={table.td}>{a.custodian?.name ?? "-"}</td>
                    <td className={table.td}>
                      <StatusBadge status={a.status} label={a.status_label} />
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-right tabular-nums`}>
                      {a.purchase_cost ? fmt.money(a.purchase_cost) : "-"}
                    </td>
                    {canEdit && <td className={`${table.td} whitespace-nowrap text-right`}>{editLink(a)}</td>}
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / Tablet แนวตั้ง: การ์ด */}
          <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
            {assets.data.map((a) => (
              <ClickableRow key={a.id} as="li" href={`/assets/${a.id}`} className={`p-4 ${card}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs text-muted">{a.asset_tag}</span>
                  <StatusBadge status={a.status} label={a.status_label} />
                </div>
                <Link href={`/assets/${a.id}`} className="mt-1 block cursor-pointer font-medium text-ink hover:text-accent-700 hover:underline dark:hover:text-accent-300">
                  {a.name}
                </Link>
                <div className="text-xs text-muted">{[a.brand, a.model].filter(Boolean).join(" ")}</div>
                {(a.user_name || a.ip_address) && <div className="text-xs text-muted">{[a.user_name, a.ip_address].filter(Boolean).join(" · ")}</div>}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">{t("assets.col.branch")}</dt>
                  <dd>{a.branch?.name ?? "-"}</dd>
                  <dt className="text-muted">{t("assets.col.location")}</dt>
                  <dd>{a.location?.name ?? "-"}</dd>
                  <dt className="text-muted">{t("assets.col.custodian")}</dt>
                  <dd>{a.custodian?.name ?? "-"}</dd>
                  <dt className="text-muted">{t("assets.col.purchaseDate")}</dt>
                  <dd>{a.purchase_date ? fmt.date(a.purchase_date) : "-"}</dd>
                  <dt className="text-muted">{t("assets.col.cost")}</dt>
                  <dd className="tabular-nums">{a.purchase_cost ? fmt.money(a.purchase_cost) : "-"}</dd>
                </dl>
                {canEdit && editLink(a, true)}
              </ClickableRow>
            ))}
          </ul>
        </>
      )}

      <Pagination meta={meta} href={pageHref} />
    </div>
  );
}
