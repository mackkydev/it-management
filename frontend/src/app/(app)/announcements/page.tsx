import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BellIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Announcement } from "@/lib/types";
import { AnnouncementsManager } from "./announcements-manager";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("announcements.title") };
}

/** ตั้งค่าระบบ → ประกาศหน้า login (admin / ฝ่าย IT) */
export default async function AnnouncementsPage() {
  if (!has(await getCurrentUser(), "announcements.manage")) redirect("/tickets");
  const [{ data }, { t }] = await Promise.all([apiFetch<{ data: Announcement[] }>("/announcements"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={BellIcon} title={t("announcements.title")} subtitle={t("announcements.subtitle")} />
      <AnnouncementsManager items={data} />
    </div>
  );
}
