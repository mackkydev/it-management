import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileTextIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { PolicyAcceptance, SystemPolicy } from "@/lib/types";
import { PolicyEditor } from "./policy-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.policyManage") };
}

/** ข้อมูลหลัก → นโยบายการใช้งาน (settings.manage) */
export default async function PolicyManagePage() {
  if (!has(await getCurrentUser(), "settings.manage")) redirect("/dashboard");
  const [{ t }, policy, acceptances] = await Promise.all([
    getI18n(),
    apiFetch<{ data: SystemPolicy }>("/policy"),
    apiFetch<{ data: PolicyAcceptance[]; accepted: number; total: number }>("/policy/acceptances"),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={FileTextIcon} title={t("nav.policyManage")} subtitle={t("settingsPage.policy.contentHint")} />
      <PolicyEditor initial={policy.data} acceptances={acceptances} />
    </div>
  );
}
