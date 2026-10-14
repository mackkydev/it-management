import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { LeaveRequest } from "@/lib/types";
import { PrintButton } from "./print-button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("leave.printTitle") };
}

/** ใบลา A4 (นอกเมนูหลัก — พิมพ์ / บันทึก PDF จากเบราว์เซอร์) พร้อมลายเซ็นปัจจุบันของผู้ลาและผู้อนุมัติ */
export default async function LeavePrintPage({ params }: PageProps<"/leave-print/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let l: LeaveRequest;
  try {
    l = (await apiFetch<{ data: LeaveRequest }>(`/leave/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { t, fmt } = await getI18n();
  const period = l.start_on === l.end_on ? fmt.date(l.start_on) : `${fmt.date(l.start_on)} – ${fmt.date(l.end_on)}`;
  const unit = t(`leave.units.${l.unit}`) + (l.unit === "hours" && l.start_time ? ` ${l.start_time}–${l.end_time}` : "");
  const row = (label: string, value: string | null) => (
    <tr>
      <th className="w-40 border border-gray-300 bg-gray-50 px-3 py-2 text-left font-medium">{label}</th>
      <td className="border border-gray-300 px-3 py-2">{value || "-"}</td>
    </tr>
  );
  const sign = (who: "requester" | "approver", name: string | null, date: string | null) => (
    <div className="flex-1 text-center">
      <div className="flex h-20 items-end justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นส่วนตัวผ่าน /files */}
        {(who === "requester" || l.status === "approved") && <img src={`/files/leave/${l.id}/signature/${who}`} alt="" className="max-h-20 max-w-48 object-contain" />}
      </div>
      <p className="border-t border-dotted border-gray-500 pt-1 text-sm">{t("leave.printSignHere")}</p>
      <p className="text-sm font-medium">{name ?? "-"}</p>
      <p className="text-xs text-gray-600">{who === "requester" ? t("leave.printRequester") : t("leave.printApprover")}</p>
      {date && <p className="text-xs text-gray-600">{fmt.dateTime(date)}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 py-6 text-black print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 15mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end">
        <PrintButton label={t("leave.print")} />
      </div>
      <article className="mx-auto max-w-[210mm] space-y-6 bg-white p-10 shadow print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-xl font-bold">{t("leave.printTitle")}</h1>
          <p className="text-sm text-gray-600">{t(`leave.types.${l.leave_type}`)} · {t(`leave.statuses.${l.status}`)}</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {row(t("leave.printRequester"), l.user.name)}
            {row(t("leave.printDept"), l.user.department)}
            {row(t("leave.printBranch"), l.user.branch)}
            {row(t("leave.form.type"), t(`leave.types.${l.leave_type}`))}
            {row(t("leave.printPeriod"), `${period} (${unit})`)}
            {row(t("leave.printDays"), fmt.number(l.days))}
            {row(t("leave.form.reason"), l.reason)}
            {row(t("leave.printSubmitted"), l.created_at ? fmt.dateTime(l.created_at) : null)}
            {row(t("leave.printApprover"), l.approver?.name ?? null)}
            {l.decision_note && row(t("leave.note"), l.decision_note)}
          </tbody>
        </table>
        <div className="flex gap-10 pt-6">
          {sign("requester", l.user.name, l.created_at)}
          {sign("approver", l.approver?.name ?? null, l.status === "approved" ? l.decided_at : null)}
        </div>
      </article>
    </div>
  );
}
