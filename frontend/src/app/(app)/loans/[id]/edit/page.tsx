import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BoxIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { Loan } from "@/lib/types";
import { LoanForm } from "../../loan-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("loan.form.editTitle") };
}

/** แก้ไขคำขอยืม — ได้ระหว่างยังไม่ได้รับเครื่อง (ผู้ยืม / ผู้จัดการ) — เครื่องเจ้าหน้าที่ IT เลือกตอนเตรียมเครื่อง */
export default async function EditLoanPage({ params }: PageProps<"/loans/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ t }, loan] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Loan }>(`/loans/${id}`)
      .then((r) => r.data)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      }),
  ]);
  if (!loan.can_edit) redirect("/loans/mine");

  return (
    <div className="space-y-5">
      <PageHeader icon={BoxIcon} title={t("loan.form.editTitle")} subtitle={loan.asset ? `${loan.asset.asset_tag} · ${loan.asset.name}` : t("loan.board.noDevice")} />
      <div className={`p-5 ${card}`}>
        <LoanForm
          id={loan.id}
          initial={{ asset_id: "", purpose: loan.purpose, note: loan.note ?? "", start_on: loan.start_on, start_time: loan.start_time, end_on: loan.end_on, end_time: loan.end_time }}
          borrower={{ name: loan.user.name, department: loan.department }}
        />
      </div>
    </div>
  );
}
