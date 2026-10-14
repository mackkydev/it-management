import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { has, getCurrentUser } from "@/lib/auth";
import { TicketListPage } from "../../tickets/ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.itTitle") };
}

/** คิวงาน IT: ใบงานทั้งหมดของฝ่าย IT (หลังหัวหน้าอนุมัติ) — รับงานแทนเจ้าหน้าที่ที่ถูกเลือกได้ (it_tickets.take_over) */
export default async function ItQueuePage({ searchParams }: PageProps<"/it/queue">) {
  const user = await getCurrentUser();
  if (!has(user, "it_tickets.queue")) redirect("/tickets");
  return <TicketListPage scope="it" params={await searchParams} />;
}
