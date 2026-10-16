import type { Metadata } from "next";
import Link from "next/link";
import { BoxIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Loan, LoanDevice } from "@/lib/types";
import { monthGrid } from "../calendar/calendar-grid";
import { LoanCalendar } from "./loan-calendar";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ปฏิทินยืมอุปกรณ์ IT (หน้าแรกของระบบยืม) — ทุกคนเห็นการยืมของทุกอุปกรณ์ */
export default async function LoansPage({ searchParams }: PageProps<"/loans">) {
  const params = await searchParams;
  const month = typeof params.month === "string" && MONTH_RE.test(params.month) ? params.month : localToday().slice(0, 7);
  const { from, to } = monthGrid(month);
  const [{ t }, loans, devices, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Loan[] }>(`/loans?${new URLSearchParams({ from, to })}`).then((r) => r.data),
    apiFetch<{ data: LoanDevice[] }>("/loan-devices").then((r) => r.data),
    getAccess(),
  ]);
  const canBook = can("btn:loans:book");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BoxIcon}
        title={t("loan.title")}
        subtitle={t("loan.subtitle")}
        actions={
          canBook && (
            <Link href="/loans/book" className={btn.primary}>
              <PlusIcon />
              {t("loan.book")}
            </Link>
          )
        }
      />
      {devices.length === 0 && <div className={`px-4 py-3 text-sm text-muted ${card}`}>{t("loan.noDevices")}</div>}
      <LoanCalendar month={month} initialLoans={loans} canBook={canBook && devices.length > 0} />
    </div>
  );
}
