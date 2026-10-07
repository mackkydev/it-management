import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has, isSuperAdmin } from "@/lib/auth";
import type { PermissionCatalog } from "@/lib/types";
import { RoleMatrix } from "./role-matrix";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("rolePermissions.title") };
}

/** ตั้งค่าระบบ → สิทธิ์ตามกลุ่ม: ตาราง ระบบงาน × การกระทำ ของแต่ละกลุ่ม + จัดการกลุ่ม + สวิตช์วันหมดอายุ (แก้ได้ = access.manage, ดูได้ = access.assign) */
export default async function RolePermissionsPage() {
  const user = await getCurrentUser();
  const canManage = has(user, "access.manage");
  if (!canManage && !has(user, "access.assign")) redirect("/tickets");
  const [{ t }, catalog] = await Promise.all([getI18n(), apiFetch<PermissionCatalog>("/permissions")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("rolePermissions.title")} subtitle={t("rolePermissions.subtitle")} />
      <RoleMatrix catalog={catalog} canManage={canManage} superAdmin={isSuperAdmin(user)} />
    </div>
  );
}
