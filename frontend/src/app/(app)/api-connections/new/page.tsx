import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GitBranchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { getCurrentUser, isLocalSuperAdmin } from "@/lib/auth";
import { ConnectionForm } from "../connection-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("apiConnections.newTitle") };
}

export default async function NewApiConnectionPage() {
  if (!isLocalSuperAdmin(await getCurrentUser())) redirect("/tickets");
  const { t } = await getI18n();
  return (
    <div className="space-y-5">
      <PageHeader icon={GitBranchIcon} title={t("apiConnections.newTitle")} subtitle={t("apiConnections.subtitle")} />
      <ConnectionForm connection={null} />
    </div>
  );
}
