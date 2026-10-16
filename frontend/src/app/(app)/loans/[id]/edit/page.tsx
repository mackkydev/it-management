import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BoxIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { Loan, LoanDevice } from "@/lib/types";
import { LoanForm } from "../../loan-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.form.editTitle") };
}

/** แก้ไขการจองยืม — ได้ระหว่างยังไม่ส่งมอบ (ผู้ยืม / ผู้จัดการ) */
export default async function EditLoanPage({ params }: PageProps<"/loans/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ t }, loan, devices] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Loan }>(`/loans/${id}`)
      .then((r) => r.data)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      }),
    apiFetch<{ data: LoanDevice[] }>("/loan-devices").then((r) => r.data),
  ]);
  if (!loan.can_edit) redirect("/loans/mine");
  // อุปกรณ์เดิมของการจองนี้ (ถ้าไม่อยู่ในรายการแล้ว เช่น ย้ายผู้ถือครอง) ยังเลือกคงไว้ได้
  const list = devices.some((d) => d.id === loan.asset.id)
    ? devices
    : [...devices, { id: loan.asset.id, asset_tag: loan.asset.asset_tag, name: loan.asset.name, category: loan.asset.category, brand: null, model: null, custodian: null, on_loan: null }];

  return (
    <div className="space-y-5">
      <PageHeader icon={BoxIcon} title={t("loan.form.editTitle")} subtitle={`${loan.asset.asset_tag} · ${loan.asset.name}`} />
      <LoanForm
        id={loan.id}
        initial={{ asset_id: String(loan.asset.id), purpose: loan.purpose, note: loan.note ?? "", start_on: loan.start_on, start_time: loan.start_time, end_on: loan.end_on, end_time: loan.end_time }}
        devices={list}
        borrower={{ name: loan.user.name, department: loan.department }}
      />
    </div>
  );
}
