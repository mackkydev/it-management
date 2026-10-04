import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChartIcon, ResetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { btn, card, input } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, isAdmin } from "@/lib/auth";
import { KpiForm, KpiItem, type KpiEntry } from "./kpi-client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("kpi.title") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** บันทึก KPI — บันทึกการปฏิบัติงานรายวัน (admin / หัวหน้า IT เห็นของทุกคน) */
export default async function KpiPage({ searchParams }: PageProps<"/kpi">) {
  const params = await searchParams;
  const [{ t }, can] = await Promise.all([getI18n(), getAccess()]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  const q = new URLSearchParams();
  if (DATE_RE.test(str("from"))) q.set("from", str("from"));
  if (DATE_RE.test(str("to"))) q.set("to", str("to"));
  if (/^\d+$/.test(str("page"))) q.set("page", str("page"));

  return (
    <div className="space-y-5">
      <PageHeader icon={ChartIcon} title={t("kpi.title")} subtitle={t("kpi.subtitle")} />

      {can("btn:kpi:create") && (
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("kpi.newTitle")}</h2>
          <KpiForm />
        </section>
      )}

      <Form action="/kpi" className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] ${card}`}>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("kpi.from")}</span>
          <input type="date" name="from" defaultValue={q.get("from") ?? ""} className={input} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("kpi.to")}</span>
          <input type="date" name="to" defaultValue={q.get("to") ?? ""} className={input} />
        </label>
        <div className="flex items-end gap-2">
          <Link href="/kpi" className={`${btn.secondary} px-3`} aria-label={t("common.clearFilters")}>
            <LinkPendingIcon icon={<ResetIcon className="text-faint" />} />
          </Link>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} flex-1`}>
            {t("common.search")}
          </SubmitButton>
        </div>
      </Form>

      <Suspense key={q.toString()} fallback={<TableSkeleton cols={3} />}>
        <KpiList query={q} />
      </Suspense>
    </div>
  );
}

async function KpiList({ query }: { query: URLSearchParams }) {
  const [res, { t, fmt }, user] = await Promise.all([
    apiFetch<{ data: KpiEntry[]; meta: { current_page: number; last_page: number; total: number; from: number | null; to: number | null } }>(
      `/kpi?${query}`,
    ),
    getI18n(),
    getCurrentUser(),
  ]);
  // admin / หัวหน้า IT เห็นบันทึกของทุกคน → แสดงชื่อผู้บันทึก
  const showUser = isAdmin(user) || Boolean(user.is_it_head);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(query);
    n.set("page", String(p));
    return `/kpi?${n}`;
  };

  if (res.data.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("kpi.empty")}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("common.total", { count: fmt.number(res.meta.total) })}</p>
      <ul className="space-y-3">
        {res.data.map((e) => (
          <KpiItem key={e.id} entry={e} dateLabel={fmt.date(e.work_date)} showUser={showUser} />
        ))}
      </ul>
      <Pagination meta={res.meta} href={pageHref} />
    </div>
  );
}
