import type { Metadata } from "next";
import { BoxIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { LoanDevice } from "@/lib/types";
import { LoanForm } from "../loan-form";
import { TIME_OPTIONS } from "../loan-utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.form.newTitle") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** จองยืมอุปกรณ์ IT — เปิดจากปฏิทินส่ง ?date=&device= มาเติมให้ (ไม่ส่งวัน = เลือกวันก่อนจึงเลือกอุปกรณ์ได้) */
export default async function BookLoanPage({ searchParams }: PageProps<"/loans/book">) {
  const sp = await searchParams;
  const today = localToday();
  const date = DATE_RE.test(str(sp.date)) && str(sp.date) >= today ? str(sp.date) : "";
  const [{ t }, user, devices] = await Promise.all([getI18n(), getCurrentUser(), apiFetch<{ data: LoanDevice[] }>("/loan-devices").then((r) => r.data)]);
  const device = devices.some((d) => String(d.id) === str(sp.device)) ? str(sp.device) : "";

  return (
    <div className="space-y-5">
      <PageHeader icon={BoxIcon} title={t("loan.form.newTitle")} subtitle={t("loan.form.subtitle")} />
      {devices.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("loan.noDevices")}</div>
      ) : (
        <LoanForm
          id={null}
          initial={{ asset_id: device, purpose: "", note: "", start_on: date, start_time: TIME_OPTIONS.includes("09:00") ? "09:00" : TIME_OPTIONS[0], end_on: date, end_time: "17:00" }}
          devices={devices}
          borrower={{ name: user?.name ?? "", department: user?.department ?? null }}
        />
      )}
    </div>
  );
}
