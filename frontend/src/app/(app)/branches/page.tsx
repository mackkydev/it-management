import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuildingIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { BranchManager } from "./branch-manager";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("branches.title") };
}

/** 5.1 จัดการสาขา (admin) */
export default async function BranchesPage() {
  const user = await getCurrentUser();
  if (!has(user, "branches.manage")) redirect("/tickets");
  const [{ data }, { t }] = await Promise.all([apiFetch<{ data: Branch[] }>("/branches?include_inactive=1"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={BuildingIcon} title={t("branches.title")} subtitle={t("branches.subtitle")} />
      <BranchManager branches={data} />
    </div>
  );
}
