import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GitBranchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { RouteForm } from "../route-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("approvalRoutes.newTitle") };
}

export default async function NewApprovalRoutePage() {
  if (!has(await getCurrentUser(), "approval_routes.manage")) redirect("/tickets");
  const [{ data: branches }, { data: departments }, { t }] = await Promise.all([
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: string[] }>("/approval-routes/departments"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={GitBranchIcon} title={t("approvalRoutes.newTitle")} />
      <RouteForm branches={branches} departments={departments} />
    </div>
  );
}
