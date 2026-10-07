import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BellIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser, getUiConfig } from "@/lib/auth";
import type { AppSettings } from "@/lib/types";
import { LogoCard } from "./logo-card";
import { SecurityForm } from "./security-form";
import { SettingsForm } from "./settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settingsPage.title") };
}

/** 5.2 ตั้งค่าการแจ้งเตือนล่วงหน้า + อีเมลรับแจ้งเตือน (admin) */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!has(user, "settings.manage")) redirect("/tickets");
  const [{ data }, { t }, ui] = await Promise.all([apiFetch<{ data: AppSettings }>("/settings"), getI18n(), getUiConfig()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={BellIcon} title={t("settingsPage.title")} subtitle={t("settingsPage.subtitle")} />
      <LogoCard version={ui.logo_version} />
      <SettingsForm initial={data} />
      <SecurityForm initial={data.secret_guard} pinStatus={data.secret_pin_status} canManagePin={has(user, "secrets.pin_manage")} />
    </div>
  );
}
