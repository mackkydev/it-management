import type { Metadata } from "next";
import Form from "next/form";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppSelect } from "@/components/app-select";
import { ChartIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/pending";
import { TableSkeleton } from "@/components/skeletons";
import { btn, card, input } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Branch, KpiMonth } from "@/lib/types";
import { KpiExport, KpiSheet } from "./kpi-client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("kpi.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" ย้อนหลัง n เดือนจากเดือนนี้ (+ ล่วงหน้า 2 เดือนสำหรับลงวันหยุด) ล่าสุดก่อน */
function monthOptions(current: string, back = 24): string[] {
  const [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  for (let i = -2; i < back; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** KPI ฝ่าย IT — ชีตรายเดือนตามแบบฟอร์ม KPI (ใบแจ้งงานที่รับแล้ว + แถวกรอกเอง + วันหยุด) และ export Excel */
export default async function KpiPage({ searchParams }: PageProps<"/kpi">) {
  const user = await getCurrentUser();
  if (!has(user, "kpi.use")) redirect("/tickets");
  const params = await searchParams;
  const [{ t, locale }, can] = await Promise.all([getI18n(), getAccess()]);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  const thisMonth = localToday().slice(0, 7);
  const month = MONTH_RE.test(str("month")) ? str("month") : thisMonth;
  const viewAll = has(user, "kpi.view_all");
  const userId = viewAll && /^\d+$/.test(str("user_id")) ? Number(str("user_id")) : (user?.id ?? 0);
  const staff = viewAll ? (await apiFetch<{ data: { id: number; name: string }[] }>("/it-staff")).data : [];
  if (viewAll && user && !staff.some((s) => s.id === user.id)) staff.unshift({ id: user.id, name: user.name });

  const monthLabel = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const months = monthOptions(thisMonth).map((m) => ({ value: m, label: monthLabel.format(new Date(`${m}-01T00:00:00Z`)) }));

  return (
    <div className="space-y-5">
      <PageHeader icon={ChartIcon} title={t("kpi.title")} subtitle={t("kpi.subtitle")} />

      <div className={`grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] ${card}`}>
        <Form action="/kpi" className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(2,minmax(0,14rem))_auto] sm:items-end">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("kpi.month")}</span>
            <AppSelect name="month" defaultValue={month} className={input}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </AppSelect>
          </label>
          {viewAll ? (
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t("kpi.staff")}</span>
              <AppSelect name="user_id" defaultValue={String(userId)} className={input}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </AppSelect>
            </label>
          ) : (
            <span className="hidden sm:block" />
          )}
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={btn.primary}>
            {t("kpi.show")}
          </SubmitButton>
        </Form>
        <KpiExport months={months} defaultMonth={month} userId={userId} />
      </div>

      <Suspense key={`${month}-${userId}`} fallback={<TableSkeleton cols={10} />}>
        <Sheet month={month} userId={userId} monthText={months.find((m) => m.value === month)?.label ?? month} canCreate={can("btn:kpi:create")} />
      </Suspense>
    </div>
  );
}

async function Sheet({ month, userId, monthText, canCreate }: { month: string; userId: number; monthText: string; canCreate: boolean }) {
  const [res, branches] = await Promise.all([apiFetch<KpiMonth>(`/kpi/month?month=${month}&user_id=${userId}`), apiFetch<{ data: Branch[] }>("/branches")]);
  // เพิ่มบรรทัดได้เมื่อแก้ชีตนี้ได้ (ของตัวเอง หรือมีสิทธิ์แก้ของผู้อื่น) + ปุ่มไม่ถูกซ่อนในหน้าการมองเห็นเมนู
  const user = await getCurrentUser();
  const canEdit = user?.id === res.user.id ? has(user, "kpi.use") : has(user, "kpi.edit_all");
  return <KpiSheet sheet={res} branches={branches.data.map((b) => b.name)} monthText={monthText} canAdd={canEdit && canCreate} canEdit={canEdit} />;
}
