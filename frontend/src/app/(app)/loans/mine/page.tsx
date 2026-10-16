import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircleIcon, InboxIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert, btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import type { Loan } from "@/lib/types";
import { LoanList } from "../loan-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.mine.title") };
}

const TABS = ["active", "past", "cancelled"] as const;
const TAB_CLS = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** การยืมของฉัน — แท็บ กำลังยืม / รอรับ, คืนแล้ว, ยกเลิก (เกินกำหนดคืน = ป้ายสีแดง) */
export default async function MyLoansPage({ searchParams }: PageProps<"/loans/mine">) {
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "active";
  const [{ t }, items, can] = await Promise.all([getI18n(), apiFetch<{ data: Loan[] }>(`/loans/mine?status=${status}`).then((r) => r.data), getAccess()]);
  const overdue = items.filter((l) => l.is_overdue).length;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={InboxIcon}
        title={t("loan.mine.title")}
        subtitle={t("loan.mine.subtitle")}
        actions={
          can("btn:loans:book") && (
            <Link href="/loans/book" className={btn.primary}>
              <PlusIcon />
              {t("loan.book")}
            </Link>
          )
        }
      />
      {sp.done && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t("loan.form.saved")}
        </p>
      )}
      {overdue > 0 && <p className={alert.error}>{t("loan.mine.overdueAlert", { n: overdue })}</p>}
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/loans/mine?status=${s}`} aria-current={s === status ? "page" : undefined} className={TAB_CLS(s === status)}>
            {t(`loan.mine.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t("loan.empty")}</div> : <LoanList items={items} />}
    </div>
  );
}
