import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BellIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type { AppSettings } from "@/lib/types";
import { SettingsForm } from "./settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settingsPage.title") };
}

/** 5.2 ตั้งค่าการแจ้งเตือนล่วงหน้า + อีเมลรับแจ้งเตือน (admin) */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) redirect("/tickets");
  const [{ data }, { t }] = await Promise.all([apiFetch<{ data: AppSettings }>("/settings"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={BellIcon} title={t("settingsPage.title")} subtitle={t("settingsPage.subtitle")} />
      <SettingsForm initial={data} />
    </div>
  );
}
