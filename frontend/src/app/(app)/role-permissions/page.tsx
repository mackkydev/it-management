import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { PermissionDef } from "@/lib/types";
import { RoleMatrix } from "./role-matrix";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("rolePermissions.title") };
}

/** ตั้งค่าระบบ → สิทธิ์ตามบทบาท (Local Admin) */
export default async function RolePermissionsPage() {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const [{ t }, res] = await Promise.all([getI18n(), apiFetch<{ data: PermissionDef[]; role_permissions: Record<string, string[]> }>("/permissions")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("rolePermissions.title")} subtitle={t("rolePermissions.subtitle")} />
      <RoleMatrix catalog={res.data} initial={res.role_permissions} />
    </div>
  );
}
