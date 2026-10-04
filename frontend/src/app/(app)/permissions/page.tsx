import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { isLocalAdmin, getCurrentUser, getUiConfig } from "@/lib/auth";
import { PermissionsForm } from "./permissions-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("permissions.title") };
}

/** ตั้งค่าระบบ → สิทธิ์การใช้งาน (admin): การมองเห็นเมนู/ปุ่มตามกลุ่มผู้ใช้ + ลำดับเมนู */
export default async function PermissionsPage() {
  const [user, config, { t }] = await Promise.all([getCurrentUser(), getUiConfig(), getI18n()]);
  if (!isLocalAdmin(user)) redirect("/tickets");

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("permissions.title")} subtitle={t("permissions.subtitle")} />
      <PermissionsForm initial={config} />
    </div>
  );
}
