import type { Metadata } from "next";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { isReadOnly } from "@/lib/permissions";
import type { OtherPolicy, PolicyDisplay, PolicyGroup, PolicyOverview, PolicyPace, PolicyVersion } from "@/lib/types";
import { PolicyManager } from "./policy-manager";
import { PolicyReader } from "./policy-reader";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.policyManage") };
}

/** เมนูหลัก → นโยบายการใช้งาน: policy.manage = จัดการนโยบายที่ต้องยอมรับ (แยกเรื่อง + ฉบับ) + นโยบายอื่นๆ / ผู้ใช้ทั่วไป = อ่านทุกเรื่องที่แสดงอยู่ + นโยบายอื่นๆ */
export default async function PolicyPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);

  if (has(user, "policy.manage")) {
    const [versions, others] = await Promise.all([
      apiFetch<{ data: PolicyVersion[]; groups: PolicyGroup[]; enabled: boolean; display: PolicyDisplay; pace: PolicyPace }>("/policy/versions"),
      apiFetch<{ data: OtherPolicy[] }>("/policy/others?all=1"),
    ]);
    return (
      <div className="space-y-5">
        <PageHeader icon={ShieldIcon} title={t("nav.policyManage")} subtitle={t("policyPage.subtitleManage")} />
        <PolicyManager versions={versions.data} groups={versions.groups} enabled={versions.enabled} others={others.data} canEdit={!isReadOnly(user)} canOpenSettings={has(user, "settings.manage")} />
      </div>
    );
  }

  const [policy, others] = await Promise.all([apiFetch<PolicyOverview>("/policy"), apiFetch<{ data: OtherPolicy[] }>("/policy/others")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("nav.policyManage")} subtitle={t("policyPage.subtitle")} />
      <PolicyReader userId={user.id} items={policy.active ? policy.data.items : []} others={others.data} />
    </div>
  );
}
