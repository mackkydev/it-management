import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { GitBranchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { ApprovalRoute, Branch } from "@/lib/types";
import { RouteForm } from "../../route-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("approvalRoutes.editTitle") };
}

export default async function EditApprovalRoutePage({ params }: PageProps<"/approval-routes/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  if (!has(await getCurrentUser(), "approval_routes.manage")) redirect("/tickets");

  const routeReq = apiFetch<{ data: ApprovalRoute }>(`/approval-routes/${id}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const [{ data: route }, { data: branches }, { data: departments }, { t }] = await Promise.all([
    routeReq,
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: string[] }>("/approval-routes/departments"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={GitBranchIcon} title={t("approvalRoutes.editTitle")} subtitle={route.name} />
      <RouteForm route={route} branches={branches} departments={departments} />
    </div>
  );
}
