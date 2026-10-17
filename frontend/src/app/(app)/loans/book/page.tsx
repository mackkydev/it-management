import type { Metadata } from "next";
import { CalendarIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Loan, LoanDevice } from "@/lib/types";
import { monthGrid } from "../../calendar/calendar-grid";
import { LoanBoard } from "../loan-board";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.form.newTitle") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * ยืมโน้ตบุ๊ก (หน้าเดียวของระบบยืม) — ซ้าย: โน้ตบุ๊กที่ติ๊ก "เป็นเครื่องสำหรับยืม" + ยืม-จอง, ขวา: ปฏิทินการยืม (ทุกคนเห็นทุกเครื่อง)
 * ?month= เลือกเดือนปฏิทิน, ?date=&device= เปิดฟอร์มของเครื่องนั้นไว้ให้ (ลิงก์เดิม)
 */
export default async function BookLoanPage({ searchParams }: PageProps<"/loans/book">) {
  const sp = await searchParams;
  const today = localToday();
  const month = MONTH_RE.test(str(sp.month)) ? str(sp.month) : today.slice(0, 7);
  const { from, to } = monthGrid(month);
  const [{ t }, loans, devices, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Loan[] }>(`/loans?${new URLSearchParams({ from, to })}`).then((r) => r.data),
    apiFetch<{ data: LoanDevice[] }>("/loan-devices").then((r) => r.data),
    getAccess(),
  ]);
  const date = DATE_RE.test(str(sp.date)) && str(sp.date) >= today ? str(sp.date) : today;
  const device = devices.find((d) => String(d.id) === str(sp.device));

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarIcon} title={t("loan.form.newTitle")} subtitle={t("loan.board.subtitle")} />
      <LoanBoard
        month={month}
        loans={loans}
        devices={devices}
        canBook={can("btn:loans:book")}
        initialOpen={device ? { deviceId: device.id, date, nonce: 1 } : null}
      />
    </div>
  );
}
