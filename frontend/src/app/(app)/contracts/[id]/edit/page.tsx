import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileTextIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch, Contract } from "@/lib/types";
import { ContractForm } from "../../contract-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("contracts.editTitle") };
}

export default async function EditContractPage({ params }: PageProps<"/contracts/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const user = await getCurrentUser();
  if (!has(user, "contracts.update")) redirect("/tickets");

  const contractReq = apiFetch<{ data: Contract }>(`/contracts/${id}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const [{ data: contract }, { data: branches }, { default_notify_days }, { t }] = await Promise.all([
    contractReq,
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ default_notify_days: number }>("/contracts?status=expired"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={FileTextIcon} title={t("contracts.editTitle")} subtitle={`${contract.title} · ${contract.vendor_name}`} />
      <ContractForm contract={contract} branches={branches} defaultNotifyDays={default_notify_days} canDelete={has(user, "contracts.delete")} />
    </div>
  );
}
