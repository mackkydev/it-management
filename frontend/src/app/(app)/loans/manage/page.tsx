import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { Loan } from "@/lib/types";
import { LoanList } from "../loan-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.manage.title") };
}

const TABS = ["pending", "on_loan", "overdue", "all"] as const;
const TAB_CLS = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** ส่งมอบ / รับคืนอุปกรณ์ (loans.manage) — รอส่งมอบ / ยืมอยู่ / เกินกำหนดคืน / ทั้งหมด */
export default async function ManageLoansPage({ searchParams }: PageProps<"/loans/manage">) {
  const user = await getCurrentUser();
  if (!has(user, "loans.manage")) redirect("/loans");
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "pending";
  const [{ t }, items] = await Promise.all([getI18n(), apiFetch<{ data: Loan[] }>(`/loans/manage?status=${status}`).then((r) => r.data)]);

  return (
    <div className="space-y-5">
      <PageHeader icon={CheckCircleIcon} title={t("loan.manage.title")} subtitle={t("loan.manage.subtitle")} />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/loans/manage?status=${s}`} aria-current={s === status ? "page" : undefined} className={TAB_CLS(s === status)}>
            {t(`loan.manage.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t("loan.empty")}</div> : <LoanList items={items} showBorrower />}
    </div>
  );
}
