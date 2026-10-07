import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { HistoryIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { DateInput } from "@/components/date-input";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { MessageKey } from "@/i18n/types";
import { CATEGORIES, type AssetMovement, type Branch, type Location, type Paginated } from "@/lib/types";
import { MOVEMENT_STYLE, MovementChanges } from "../assets/movement-timeline";
import { AppSelect } from "@/components/app-select";
import { Tooltip } from "@/components/tooltip";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("movements.title") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildQuery(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const key of ["search", "type", "category", "branch_id", "location_id", "from", "to", "page"]) {
    const value = params[key];
    if (typeof value !== "string" || value === "") continue;
    if ((key === "from" || key === "to") && !DATE_RE.test(value)) continue;
    q.set(key, value);
  }
  q.set("per_page", "25");
  return q;
}

export default async function MovementsPage({ searchParams }: PageProps<"/movements">) {
  // รายงานรวมของทุกสินทรัพย์ — ผู้ที่เห็นเฉพาะของตัวเองดูประวัติได้ในหน้ารายละเอียดสินทรัพย์
  if (!has(await getCurrentUser(), "movements.view")) redirect("/assets");
  const params = await searchParams;
  const query = buildQuery(params);
  const [{ t }, locations, branches] = await Promise.all([getI18n(), apiFetch<{ data: Location[] }>("/locations"), apiFetch<{ data: Branch[] }>("/branches")]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  return (
    <div className="space-y-5">
      <PageHeader icon={HistoryIcon} title={t("movements.title")} subtitle={t("movements.subtitle")} />

      {/* จอใหญ่: ตัวกรองทั้งหมด + ปุ่มอยู่บรรทัดเดียวกัน */}
      <Form
        action="/movements"
        className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))_auto] ${card}`}
      >
        <div className="relative sm:col-span-2 lg:col-span-2 2xl:col-span-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("movements.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <AppSelect name="type" defaultValue={str("type")} className={input} aria-label={t("movements.col.type")}>
          <option value="">{t("movements.allTypes")}</option>
          <option value="registered">{t("movements.types.registered")}</option>
          <option value="transfer">{t("movements.types.transfer")}</option>
          <option value="location">{t("movements.types.location")}</option>
          <option value="custodian">{t("movements.types.custodian")}</option>
        </AppSelect>
        <AppSelect name="category" defaultValue={str("category")} className={input} aria-label={t("assets.col.category")}>
          <option value="">{t("assets.allCategories")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`assets.categories.${c}` as MessageKey)}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="branch_id" defaultValue={str("branch_id")} className={input} aria-label={t("assets.col.branch")}>
          <option value="">{t("assets.allBranches")}</option>
          {branches.data.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </AppSelect>
        <AppSelect name="location_id" defaultValue={str("location_id")} className={input} aria-label={t("movements.location")}>
          <option value="">{t("assets.allLocations")}</option>
          {locations.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {l.name}
            </option>
          ))}
        </AppSelect>
        <DateInput name="from" defaultValue={str("from")} placeholder={t("movements.from")} aria-label={t("movements.from")} className={input} />
        <DateInput name="to" defaultValue={str("to")} placeholder={t("movements.to")} aria-label={t("movements.to")} className={input} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/movements" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1 whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={query.toString()} fallback={<TableSkeleton cols={5} />}>
        <MovementResults query={query} />
      </Suspense>
    </div>
  );
}

async function MovementResults({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<AssetMovement>>(`/movements?${query}`), getI18n()]);

  const pageHref = (page: number) => {
    const q = new URLSearchParams(query);
    q.delete("per_page");
    q.set("page", String(page));
    return `/movements?${q}`;
  };

  const assetCell = (m: AssetMovement) =>
    m.asset ? (
      <Link href={`/assets/${m.asset.id}`} className="group block cursor-pointer">
        <span className="font-mono text-xs text-accent-700 group-hover:underline dark:text-accent-300">{m.asset.asset_tag}</span>
        <span className="block font-medium text-ink">{m.asset.name}</span>
      </Link>
    ) : (
      "-"
    );

  const typeBadge = (m: AssetMovement) => (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${MOVEMENT_STYLE[m.type].badge}`}>{m.type_label}</span>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>

      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("common.noResults")}</div>
      ) : (
        <>
          <div className={`hidden md:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("movements.col.date")}</th>
                  <th className={table.th}>{t("movements.col.asset")}</th>
                  <th className={table.th}>{t("movements.col.type")}</th>
                  <th className={table.th}>{t("movements.col.change")}</th>
                  <th className={table.th}>{t("movements.col.by")}</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {res.data.map((m) => (
                  <tr key={m.id} className={`${table.row} align-top`}>
                    <td className={`${table.td} whitespace-nowrap text-muted`}>{fmt.dateTime(m.moved_at)}</td>
                    <td className={table.td}>{assetCell(m)}</td>
                    <td className={table.td}>{typeBadge(m)}</td>
                    <td className={table.td}>
                      <MovementChanges m={m} />
                    </td>
                    <td className={`${table.td} text-muted`}>{m.performed_by?.name ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
            {res.data.map((m) => (
              <li key={m.id} className={`space-y-2 p-4 ${card}`}>
                <div className="flex items-start justify-between gap-2">
                  {assetCell(m)}
                  {typeBadge(m)}
                </div>
                <MovementChanges m={m} />
                <p className="text-xs text-faint">
                  {fmt.dateTime(m.moved_at)}
                  {m.performed_by && ` · ${t("movements.by", { name: m.performed_by.name })}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}
