import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { getCurrentUser, has } from "@/lib/auth";
import { TicketListPage } from "./ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.mineTitle") };
}

/** ใบที่ฉันแจ้ง — ผู้ดูแลระบบ / เจ้าหน้าที่ IT เปิดเมนู "ใบแจ้งงาน" แล้วเริ่มที่ใบแจ้งงานทั้งหมด (แท็บ "ที่ฉันแจ้ง" = ?mine=1) */
export default async function MyTicketsPage({ searchParams }: PageProps<"/tickets">) {
  const params = await searchParams;
  if (params.mine !== "1" && has(await getCurrentUser(), "it_tickets.queue")) redirect("/tickets/all");
  return <TicketListPage scope="mine" params={params} />;
}
