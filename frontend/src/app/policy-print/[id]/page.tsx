import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { PolicyDocument, SystemPolicy } from "@/lib/types";
import { PrintButton } from "../../leave-print/[id]/print-button";

const loadDocument = async (id: string): Promise<PolicyDocument> => {
  try {
    return (await apiFetch<{ data: PolicyDocument }>(`/policy/documents/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
};

/** ชื่อหน้า = ชื่อไฟล์ตอนบันทึกเป็น PDF */
export async function generateMetadata({ params }: PageProps<"/policy-print/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getI18n();
  if (!/^\d+$/.test(id)) return { title: t("policyDoc.blankTitle") };
  const doc = await loadDocument(id);
  return { title: `${t("policyDoc.title")} - ${doc.user.name}` };
}

/**
 * เอกสารยอมรับนโยบาย A4 (นอกเมนูหลัก — พิมพ์ / บันทึก PDF จากเบราว์เซอร์)
 *   /policy-print/{userId} = ของผู้ใช้คนนั้น: ประทับชื่อ-สกุลเมื่อยอมรับแล้ว + ลายเซ็นเมื่อผู้ใช้มีลายเซ็น
 *   /policy-print/blank    = แบบฟอร์มเปล่าของฉบับปัจจุบัน ไว้เซ็นบนกระดาษ
 */
export default async function PolicyPrintPage({ params }: PageProps<"/policy-print/[id]">) {
  const { id } = await params;
  if (id !== "blank" && !/^\d+$/.test(id)) notFound();
  const { t, fmt } = await getI18n();
  const doc = id === "blank" ? null : await loadDocument(id);
  const policy = doc ? null : (await apiFetch<{ data: SystemPolicy }>("/policy")).data;
  const version = doc?.version ?? policy?.version ?? 0;
  const sections = doc?.sections ?? policy?.sections ?? [];
  const row = (label: string, value: string | null) => (
    <tr>
      <th className="w-32 border border-gray-300 bg-gray-50 px-3 py-1.5 text-left font-medium">{label}</th>
      <td className="border border-gray-300 px-3 py-1.5">{value || "-"}</td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-canvas py-6 text-black print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 15mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4">
        <p className="text-sm text-muted">{t("policyDoc.pdfHint")}</p>
        <PrintButton label={t("policyDoc.print")} />
      </div>
      <article className="mx-auto max-w-[210mm] space-y-5 bg-white p-10 shadow print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-xl font-bold">{doc ? t("policyDoc.title") : t("policyDoc.blankTitle")}</h1>
          {version > 0 && <p className="text-sm text-gray-600">{t("policyDoc.version", { version })}</p>}
        </header>

        {doc && (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {row(t("policyDoc.name"), doc.name_stamp ?? doc.user.name)}
              {row(t("policyDoc.jobTitle"), doc.user.job_title)}
              {row(t("policyDoc.department"), doc.user.department)}
              {row(t("policyDoc.branch"), doc.user.branch)}
              {row(t("policyDoc.email"), doc.user.email)}
              {doc.accepted_at && row(t("policyDoc.acceptedAt"), fmt.dateTime(doc.accepted_at))}
              {doc.ip && row(t("policyDoc.ip"), doc.ip)}
            </tbody>
          </table>
        )}

        <div className="space-y-3 text-sm leading-relaxed">
          {sections.map((s, i) => (
            <section key={i} className="break-inside-avoid-page">
              <h2 className="font-semibold">
                {i + 1}. {s.title}
              </h2>
              <p className="whitespace-pre-line">{s.body}</p>
            </section>
          ))}
        </div>

        <footer className="break-inside-avoid space-y-5 pt-2 text-sm">
          <p>{t("policyDoc.statement")}</p>
          {doc && !doc.accepted_at && <p className="font-medium text-red-700">{t("policyDoc.notAccepted")}</p>}
          {/* ช่องลงนามแบบเอกสารทั่วไป: ลายเซ็นบนเส้น + ชื่อ-สกุลตอนยอมรับ + ตำแหน่ง + วันที่ */}
          <div className="ml-auto w-96 max-w-full text-center">
            <div className="flex items-end gap-2">
              <span className="shrink-0 whitespace-nowrap">{t("policyDoc.signLabel")}</span>
              <div className="flex h-20 min-w-0 flex-1 items-end justify-center border-b border-dotted border-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นส่วนตัวผ่าน /files */}
                {doc?.accepted_at && doc.signature_url && <img src={`/files${doc.signature_url}`} alt="" className="-mb-2 max-h-20 max-w-full object-contain" />}
              </div>
              <span className="shrink-0 whitespace-nowrap">{t("policyDoc.signer")}</span>
            </div>
            <p className="mt-2 font-medium">( {doc ? (doc.name_stamp ?? doc.user.name) : <span className="inline-block w-48 border-b border-dotted border-black" />} )</p>
            {doc?.user.job_title && <p className="mt-1">{t("policyDoc.jobTitleLine", { title: doc.user.job_title })}</p>}
            <p className="mt-1">{doc?.accepted_at ? t("policyDoc.dateLine", { date: fmt.date(doc.accepted_at) }) : t("policyDoc.date")}</p>
            {doc?.accepted_at && !doc.signature_url && <p className="no-print mt-1 text-xs text-gray-500">{t("policyDoc.noSignature")}</p>}
          </div>
        </footer>
      </article>
    </div>
  );
}
