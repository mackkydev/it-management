import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { has, getCurrentUser } from "@/lib/auth";
import { TicketListPage } from "../../tickets/ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.itTitle") };
}

/** 4.3.1 หน้ารายการแจ้งงานสำหรับ IT: แสดงสถานะ + ปุ่ม/ป้ายงานที่ต้องทำ (รับงาน / อนุมัติผล) */
export default async function ItTicketsPage({ searchParams }: PageProps<"/it/tickets">) {
  const user = await getCurrentUser();
  if (!has(user, "it_tickets.queue")) redirect("/tickets");
  return <TicketListPage scope="it" params={await searchParams} />;
}
