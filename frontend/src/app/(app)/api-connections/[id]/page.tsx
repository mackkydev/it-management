import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { GitBranchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { ApiConnection } from "@/lib/types";
import { ConnectionForm } from "../connection-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("apiConnections.editTitle") };
}

export default async function EditApiConnectionPage({ params }: PageProps<"/api-connections/[id]">) {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [{ t }, connection] = await Promise.all([
    getI18n(),
    apiFetch<{ data: ApiConnection }>(`/api-connections/${id}`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      },
    ),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={GitBranchIcon} title={t("apiConnections.editTitle")} subtitle={connection.name} />
      <ConnectionForm connection={connection} />
    </div>
  );
}
