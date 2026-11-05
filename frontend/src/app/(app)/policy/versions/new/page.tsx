import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { PolicyVersion } from "@/lib/types";
import { PolicyEditor } from "../policy-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("policyPage.form.newTitle") };
}

/** เพิ่มนโยบายใหม่ — ยังไม่เคยมีเลย = เติมร่างตัวอย่างให้ (มีผลเมื่อกดบันทึก) */
export default async function NewPolicyVersionPage() {
  if (!has(await getCurrentUser(), "policy.manage")) redirect("/policy");
  const [{ t }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: PolicyVersion[] }>("/policy/versions")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("policyPage.form.newTitle")} subtitle={t("policyPage.form.newHint")} />
      <PolicyEditor initial={null} prefillSamples={data.length === 0} />
    </div>
  );
}
