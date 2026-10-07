import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { ResetIcon, SearchIcon, WrenchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { Formatters, MessageKey, TFunction } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { canViewAllAssets, getCurrentUser } from "@/lib/auth";
import { CATEGORIES, type AssetRepair, type Branch, type Paginated } from "@/lib/types";
import { TicketStatusBadge } from "../tickets/ticket-ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("repairs.title") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildQuery(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const key of ["search", "status", "repair_method", "category", "branch_id", "from", "to", "page"]) {
    const value = params[key];
    if (typeof value !== "string" || value === "") continue;
    if ((key === "from" || key === "to") && !DATE_RE.test(value)) continue;
    q.set(key, value);
  }
  q.set("per_page", "25");
  return q;
}

/** หน้ารวมประวัติการซ่อมทุกเครื่อง — ข้อมูลจากใบแจ้งซ่อม (ประวัติของเครื่องเดียวดูที่หน้ารายละเอียดสินทรัพย์) */
export default async function RepairsPage({ searchParams }: PageProps<"/repairs">) {
  if (!canViewAllAssets(await getCurrentUser())) redirect("/assets");
  const params = await searchParams;
  const query = buildQuery(params);
  const [{ t }, branches] = await Promise.all([getI18n(), apiFetch<{ data: Branch[] }>("/branches")]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  return (
    <div className="space-y-5">
      <PageHeader icon={WrenchIcon} title={t("repairs.title")} subtitle={t("repairs.subtitle")} />

      {/* จอใหญ่: ตัวกรองทั้งหมด + ปุ่มอยู่บรรทัดเดียวกัน */}
      <Form
        action="/repairs"
        className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))_auto] ${card}`}
      >
        <div className="relative sm:col-span-2 lg:col-span-2 2xl:col-span-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
          <input name="search" defaultValue={str("search")} placeholder={t("repairs.searchPlaceholder")} maxLength={100} className={`${input} pl-9`} />
        </div>
        <AppSelect name="status" defaultValue={str("status")} className={input} aria-label={t("tickets.col.status")}>
          <option value="">{t("repairs.allStatuses")}</option>
          <option value="open">{t("repairs.statusOpen")}</option>
          <option value="completed">{t("repairs.statusCompleted")}</option>
        </AppSelect>
        <AppSelect name="repair_method" defaultValue={str("repair_method")} className={input} aria-label={t("tickets.result.method")}>
          <option value="">{t("repairs.allMethods")}</option>
          <option value="in_house">{t("repairs.inHouse")}</option>
          <option value="external">{t("repairs.external")}</option>
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
        <DateInput name="from" defaultValue={str("from")} placeholder={t("movements.from")} aria-label={t("movements.from")} className={input} />
        <DateInput name="to" defaultValue={str("to")} placeholder={t("movements.to")} aria-label={t("movements.to")} className={input} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Tooltip label={t("common.clearFilters")} side="top">
            <Link href="/repairs" className={`${btn.secondary} h-full`} aria-label={t("common.clearFilters")}>
              <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
            </Link>
          </Tooltip>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1 whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={query.toString()} fallback={<TableSkeleton cols={6} />}>
        <RepairResults query={query} />
      </Suspense>
    </div>
  );
}

/** ผลการซ่อมแบบย่อ: ผล · ลักษณะงานซ่อม (+บริษัท) · อะไหล่ */
function resultLines(r: AssetRepair, t: TFunction, fmt: Formatters): string[] {
  const lines: string[] = [];
  if (r.result === "completed") lines.push(`${t("tickets.result.completed")}${r.completed_on ? ` (${fmt.date(r.completed_on)})` : ""}`);
  else if (r.result === "cannot_complete") lines.push(`${t("tickets.result.cannot")}${r.cannot_reason ? ` — ${r.cannot_reason}` : ""}`);
  if (r.repair_method === "in_house") lines.push(t("repairs.inHouse"));
  else if (r.repair_method === "external") lines.push(`${t("repairs.external")}${r.external_vendor ? ` (${r.external_vendor})` : ""}`);
  if (r.parts.length) lines.push(`${t("tickets.result.parts")}: ${r.parts.map((p) => `${p.name} × ${fmt.number(p.quantity)}`).join(", ")}`);
  return lines;
}

async function RepairResults({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }] = await Promise.all([apiFetch<Paginated<AssetRepair>>(`/repairs?${query}`), getI18n()]);

  const pageHref = (page: number) => {
    const q = new URLSearchParams(query);
    q.delete("per_page");
    q.set("page", String(page));
    return `/repairs?${q}`;
  };

  const assetCell = (r: AssetRepair) =>
    r.asset ? (
      <Link href={`/assets/${r.asset.id}`} className="group block cursor-pointer">
        <span className="font-mono text-xs text-accent-700 group-hover:underline dark:text-accent-300">{r.asset.asset_tag}</span>
        <span className="block font-medium text-ink">{r.asset.name}</span>
        {r.branch && <span className="block text-xs text-muted">{r.branch}</span>}
      </Link>
    ) : (
      <div>
        {r.asset_tag && <span className="font-mono text-xs text-muted">{r.asset_tag}</span>}
        <span className="block font-medium text-ink">{r.device_name || "-"}</span>
        <span className="block text-xs text-faint">{t("repairs.notRegistered")}</span>
      </div>
    );

  const ticketCell = (r: AssetRepair) => (
    <div className="space-y-1">
      <Link href={`/tickets/${r.id}`} className="block cursor-pointer whitespace-nowrap font-mono text-sm font-medium text-accent-700 dark:text-accent-300">
        {r.ticket_no}
      </Link>
      <TicketStatusBadge status={r.status} t={t} />
    </div>
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
                  <th className={table.th}>{t("repairs.col.date")}</th>
                  <th className={table.th}>{t("repairs.col.ticket")}</th>
                  <th className={table.th}>{t("repairs.col.asset")}</th>
                  <th className={table.th}>{t("repairs.col.symptom")}</th>
                  <th className={table.th}>{t("repairs.col.result")}</th>
                  <th className={table.th}>{t("repairs.col.assignee")}</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {res.data.map((r) => (
                  <tr key={r.id} className={`${table.row} align-top`}>
                    <td className={`${table.td} whitespace-nowrap text-muted`}>{fmt.date(r.requested_at)}</td>
                    <td className={table.td}>{ticketCell(r)}</td>
                    <td className={table.td}>{assetCell(r)}</td>
                    <td className={`${table.td} max-w-xs whitespace-pre-line`}>{r.symptom || "-"}</td>
                    <td className={`${table.td} max-w-sm text-sm`}>
                      {resultLines(r, t, fmt).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      {r.repair_details && <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{r.repair_details}</p>}
                    </td>
                    <td className={`${table.td} text-muted`}>{r.assignee ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
            {res.data.map((r) => (
              <li key={r.id} className={`space-y-2 p-4 ${card}`}>
                <div className="flex items-start justify-between gap-2">
                  {assetCell(r)}
                  {ticketCell(r)}
                </div>
                <p className="whitespace-pre-line text-sm">{r.symptom || "-"}</p>
                {resultLines(r, t, fmt).map((line) => (
                  <p key={line} className="text-sm text-muted">
                    {line}
                  </p>
                ))}
                <p className="text-xs text-faint">
                  {fmt.date(r.requested_at)}
                  {r.assignee && ` · ${r.assignee}`}
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
