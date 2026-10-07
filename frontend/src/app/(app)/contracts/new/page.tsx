import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileTextIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { ContractForm } from "../contract-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("contracts.newTitle") };
}

export default async function NewContractPage() {
  const user = await getCurrentUser();
  if (!has(user, "contracts.create")) redirect("/tickets");
  const [{ data: branches }, { default_notify_days }, { t }] = await Promise.all([
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ default_notify_days: number }>("/contracts?status=expired"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={FileTextIcon} title={t("contracts.newTitle")} />
      <ContractForm branches={branches} defaultNotifyDays={default_notify_days} />
    </div>
  );
}
