import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { PolicyVersion } from "@/lib/types";
import { PolicyEditor } from "../../policy-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.policyManage") };
}

/** แก้ไขนโยบายฉบับหนึ่ง: ชื่อ, หัวข้อ, ไฟล์แนบ — มีผู้ยอมรับแล้วแก้ได้เฉพาะชื่อ */
export default async function EditPolicyVersionPage({ params }: PageProps<"/policy/versions/[version]/edit">) {
  const { version } = await params;
  if (!/^\d+$/.test(version)) notFound();
  if (!has(await getCurrentUser(), "policy.manage")) redirect("/policy");
  const { t } = await getI18n();
  const data = await apiFetch<{ data: PolicyVersion }>(`/policy/versions/${version}`)
    .then((r) => r.data)
    .catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("policyPage.form.editTitle", { version: data.version })} subtitle={t("settingsPage.policy.contentHint")} />
      <PolicyEditor key={data.version} initial={data} />
    </div>
  );
}
