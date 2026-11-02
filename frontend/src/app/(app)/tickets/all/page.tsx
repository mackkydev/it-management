import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { has, getCurrentUser } from "@/lib/auth";
import { TicketListPage } from "../ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.allTitle") };
}

/** ใบแจ้งงานทั้งหมด (ผู้ดูแลระบบ / เจ้าหน้าที่ IT — it_tickets.queue) + ตัวกรอง ข้อความ / ประเภท / สถานะ / เจ้าหน้าที่ IT / ช่วงวันที่แจ้ง */
export default async function AllTicketsPage({ searchParams }: PageProps<"/tickets/all">) {
  const user = await getCurrentUser();
  if (!has(user, "it_tickets.queue")) redirect("/tickets");
  return <TicketListPage scope="all" params={await searchParams} />;
}
