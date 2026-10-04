import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { TicketListPage } from "../ticket-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.approvalsTitle") };
}

export default async function ApprovalTicketsPage({ searchParams }: PageProps<"/tickets/approvals">) {
  return <TicketListPage scope="approvals" params={await searchParams} />;
}
