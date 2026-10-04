import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canAccessItData, getCurrentUser } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { CredentialForm } from "../credential-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.newTitle") };
}

export default async function NewCredentialPage() {
  const user = await getCurrentUser();
  if (!canAccessItData(user)) redirect("/tickets");
  const [{ data: branches }, { t }] = await Promise.all([apiFetch<{ data: Branch[] }>("/branches"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vault.newTitle")} />
      <CredentialForm branches={branches} />
    </div>
  );
}
