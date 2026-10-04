import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HistoryIcon, KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { ApiError, apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch, Credential } from "@/lib/types";
import { CredentialForm } from "../../credential-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.editTitle") };
}

async function load<T>(path: string) {
  try {
    return await apiFetch<{ data: T }>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function EditCredentialPage({ params }: PageProps<"/vault/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const user = await getCurrentUser();
  if (!has(user, "vault.use")) redirect("/tickets");

  const [{ data: credential }, { data: branches }, { data: logs }, { t, fmt }] = await Promise.all([
    load<Credential>(`/credentials/${id}`),
    apiFetch<{ data: Branch[] }>("/branches"),
    load<{ id: number; action: string; user: { name: string } | null; ip: string | null; created_at: string }[]>(`/credentials/${id}/logs`),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vault.editTitle")} subtitle={credential.title} />
      <CredentialForm credential={credential} branches={branches} />

      {/* ประวัติการเข้าถึง (audit) */}
      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <HistoryIcon width={16} height={16} className="text-accent-500" />
          {t("vault.logs")}
        </h2>
        <ul className="divide-y divide-line-soft text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t(`vault.logActions.${l.action}` as MessageKey)}</span>
                <span className="text-muted"> · {l.user?.name ?? "-"}</span>
              </span>
              <span className="text-xs text-faint">
                {fmt.dateTime(l.created_at)}
                {l.ip && ` · ${l.ip}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
