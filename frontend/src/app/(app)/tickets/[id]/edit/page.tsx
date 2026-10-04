import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { TicketDetail } from "@/lib/types";
import { TicketForm, type TicketFormOptions } from "../../new/ticket-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.edit.title") };
}

/** ผู้แจ้งแก้ไขใบแจ้งงาน — ได้เฉพาะก่อนหัวหน้าอนุมัติ (API ส่ง action "edit" มาเมื่อแก้ได้) */
export default async function EditTicketPage({ params }: PageProps<"/tickets/[id]/edit">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [user, ticket, { data: options }] = await Promise.all([
    getCurrentUser(),
    apiFetch<{ data: TicketDetail }>(`/tickets/${id}`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
        throw e;
      },
    ),
    apiFetch<{ data: TicketFormOptions }>("/tickets/form-options"),
  ]);
  if (!ticket.actions.includes("edit")) redirect(`/tickets/${id}`);

  return <TicketForm user={user} options={options} plan={null} editing={ticket} />;
}
