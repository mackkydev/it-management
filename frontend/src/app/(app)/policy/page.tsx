import type { Metadata } from "next";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { isReadOnly } from "@/lib/permissions";
import type { OtherPolicy, PolicyDisplay, PolicyPrevious, PolicyVersion, SystemPolicy } from "@/lib/types";
import { PolicyManager } from "./policy-manager";
import { PolicyReader } from "./policy-reader";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.policyManage") };
}

/** เมนูหลัก → นโยบายการใช้งาน: policy.manage = จัดการรายการฉบับ + นโยบายอื่นๆ / ผู้ใช้ทั่วไป = อ่านฉบับล่าสุด + นโยบายอื่นๆ */
export default async function PolicyPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);

  if (has(user, "policy.manage")) {
    const [versions, others] = await Promise.all([
      apiFetch<{ data: PolicyVersion[]; enabled: boolean; display: PolicyDisplay }>("/policy/versions"),
      apiFetch<{ data: OtherPolicy[] }>("/policy/others?all=1"),
    ]);
    return (
      <div className="space-y-5">
        <PageHeader icon={ShieldIcon} title={t("nav.policyManage")} subtitle={t("policyPage.subtitleManage")} />
        <PolicyManager versions={versions.data} enabled={versions.enabled} others={others.data} canEdit={!isReadOnly(user)} canOpenSettings={has(user, "settings.manage")} />
      </div>
    );
  }

  const [policy, previous, others] = await Promise.all([
    apiFetch<{ data: SystemPolicy; active: boolean; accepted_at: string | null }>("/policy"),
    apiFetch<{ data: PolicyPrevious | null }>("/policy/previous"),
    apiFetch<{ data: OtherPolicy[] }>("/policy/others"),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("nav.policyManage")} subtitle={t("policyPage.subtitle")} />
      <PolicyReader userId={user.id} policy={policy.active ? policy.data : null} acceptedAt={policy.accepted_at} previous={previous.data} others={others.data} />
    </div>
  );
}
