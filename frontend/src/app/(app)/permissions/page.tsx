import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import en from "@/i18n/en";
import th from "@/i18n/th";
import { getI18n } from "@/i18n/server";
import { NAV } from "@/components/shell/nav";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, getUiConfig, has } from "@/lib/auth";
import type { PermissionCatalog } from "@/lib/types";
import { PermissionsForm } from "./permissions-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("permissions.title") };
}

/** ชื่อตั้งต้นของทุกเมนูทั้งสองภาษา (ใช้เติมช่องตอนแก้ชื่อ / คืนค่าเดิม) */
function defaultNames(): Record<string, { th: string; en: string }> {
  const pick = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
  const both = (key: string) => ({ th: String(pick(th, key) ?? key), en: String(pick(en, key) ?? key) });
  return Object.fromEntries(NAV.flatMap((g) => [[g.id, both(g.label)], ...g.items.map((i) => [i.href, both(i.label)])]));
}

/** ตั้งค่าระบบ → สิทธิ์การใช้งาน (access.manage): การมองเห็นเมนู/ปุ่มตามกลุ่มสิทธิ์ + ลำดับเมนู */
export default async function PermissionsPage() {
  const user = await getCurrentUser();
  if (!has(user, "access.manage")) redirect("/tickets");
  const [config, { t }, catalog] = await Promise.all([getUiConfig(), getI18n(), apiFetch<PermissionCatalog>("/permissions")]);

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("permissions.title")} subtitle={t("permissions.subtitle")} />
      <PermissionsForm initial={config} groups={catalog.groups} defaultNames={defaultNames()} />
    </div>
  );
}
