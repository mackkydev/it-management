import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintDocument } from "@/components/document-template";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { PolicyAcceptanceList } from "@/lib/types";

const load = (version: string) =>
  apiFetch<PolicyAcceptanceList>(`/policy/versions/${version}/acceptances`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });

/** ชื่อหน้า = ชื่อไฟล์ตอนบันทึกเป็น PDF */
export async function generateMetadata({ params }: PageProps<"/policy-print/acceptances/[version]">): Promise<Metadata> {
  const { version } = await params;
  const { t } = await getI18n();
  return { title: `${t("policyPage.printTitle")} - ${t("policyDoc.version", { version })}` };
}

/** รายชื่อผู้ยอมรับนโยบายของฉบับหนึ่ง A4 (นอกเมนูหลัก — พิมพ์ / บันทึก PDF จากเบราว์เซอร์) — policy.manage ตรวจที่ API */
export default async function PolicyAcceptancesPrintPage({ params }: PageProps<"/policy-print/acceptances/[version]">) {
  const { version } = await params;
  if (!/^\d+$/.test(version)) notFound();
  const [list, { t, fmt }] = await Promise.all([load(version), getI18n()]);
  const rows = list.data.filter((r) => r.accepted_at);
  const th = "border border-gray-300 bg-gray-50 px-2 py-1.5 text-left font-medium";
  const td = "border border-gray-300 px-2 py-1.5 align-top";

  return (
    <PrintDocument className="space-y-4">
        <header className="text-center">
          <h1 className="text-xl font-bold">{t("policyPage.printTitle")}</h1>
          <p className="text-sm text-gray-600">{t("policyPage.versionOf", { title: list.title, version: list.version })}</p>
          <p className="text-sm text-gray-600">{t("policyPage.printSummary", { count: fmt.number(rows.length), date: fmt.dateTime(new Date().toISOString()) })}</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <thead className="table-header-group">
            <tr>
              <th className={`${th} w-10 text-center`}>{t("policyPage.columns.no")}</th>
              <th className={th}>{t("policyDoc.name")}</th>
              <th className={th}>{t("policyDoc.jobTitle")}</th>
              <th className={th}>{t("policyDoc.department")}</th>
              <th className={th}>{t("policyDoc.branch")}</th>
              <th className={th}>{t("policyDoc.acceptedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={`${td} py-6 text-center text-gray-500`}>
                  {t("settingsPage.policy.noRows")}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.user.id} className="break-inside-avoid">
                <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                <td className={td}>{r.name_stamp ?? r.user.name}</td>
                <td className={td}>{r.user.job_title || "-"}</td>
                <td className={td}>{r.user.department || "-"}</td>
                <td className={td}>{r.user.branch || "-"}</td>
                <td className={`${td} whitespace-nowrap`}>{fmt.dateTime(r.accepted_at!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
    </PrintDocument>
  );
}
