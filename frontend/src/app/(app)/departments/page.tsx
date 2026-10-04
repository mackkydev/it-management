import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { OrgUnitManager } from "@/components/org-unit-manager";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { OrgUnit } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("orgUnits.departments.title") };
}

/** ข้อมูลหลัก → แผนก (สิทธิ์ org.manage) */
export default async function DepartmentsPage() {
  if (!has(await getCurrentUser(), "org.manage")) redirect("/tickets");
  const [{ t }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: OrgUnit[] }>("/departments?include_inactive=1")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("orgUnits.departments.title")} subtitle={t("orgUnits.departments.subtitle")} />
      <OrgUnitManager table="departments" items={data} />
    </div>
  );
}
