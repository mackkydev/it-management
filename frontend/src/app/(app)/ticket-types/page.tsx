import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { AppSettings } from "@/lib/types";
import { TicketTypesForm } from "./ticket-types-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("ticketTypes.title") };
}

/** ข้อมูลหลัก → ตัวเลือกเรื่อง "อื่นๆ" ในใบแจ้งงาน (admin) — เก็บใน app_settings.ticket_other_types */
export default async function TicketTypesPage() {
  if (!has(await getCurrentUser(), "settings.manage")) redirect("/tickets");
  const [{ data }, { t }] = await Promise.all([apiFetch<{ data: AppSettings }>("/settings"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={ListIcon} title={t("ticketTypes.title")} subtitle={t("ticketTypes.subtitle")} />
      <TicketTypesForm initial={data.ticket_other_types} />
    </div>
  );
}
