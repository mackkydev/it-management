import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, getUiConfig, has } from "@/lib/auth";
import type { PermissionCatalog } from "@/lib/types";
import { PermissionsForm } from "./permissions-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("permissions.title") };
}

/** ตั้งค่าระบบ → สิทธิ์การใช้งาน (access.manage): การมองเห็นเมนู/ปุ่มตามกลุ่มสิทธิ์ + ลำดับเมนู */
export default async function PermissionsPage() {
  const user = await getCurrentUser();
  if (!has(user, "access.manage")) redirect("/tickets");
  const [config, { t }, catalog] = await Promise.all([getUiConfig(), getI18n(), apiFetch<PermissionCatalog>("/permissions")]);

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("permissions.title")} subtitle={t("permissions.subtitle")} />
      <PermissionsForm initial={config} groups={catalog.groups} />
    </div>
  );
}
