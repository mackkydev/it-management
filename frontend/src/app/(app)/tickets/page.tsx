import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { TicketListPage } from "./ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.mineTitle") };
}

export default async function MyTicketsPage({ searchParams }: PageProps<"/tickets">) {
  return <TicketListPage scope="mine" params={await searchParams} />;
}
