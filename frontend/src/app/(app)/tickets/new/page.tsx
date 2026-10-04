import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { TicketForm, type TicketFormOptions } from "./ticket-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.create") };
}

export default async function NewTicketPage() {
  const [user, { data: options }] = await Promise.all([
    getCurrentUser(),
    apiFetch<{ data: TicketFormOptions }>("/tickets/form-options"),
  ]);

  return <TicketForm user={user} options={options} />;
}
