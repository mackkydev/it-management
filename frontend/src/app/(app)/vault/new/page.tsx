import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { Branch, CredentialAccessOptions } from "@/lib/types";
import { CredentialForm } from "../credential-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.newTitle") };
}

export default async function NewCredentialPage() {
  const user = await getCurrentUser();
  if (!has(user, "vault.create")) redirect("/tickets");
  const [{ data: branches }, { data: categories }, { t }, { data: accessOptions }] = await Promise.all([
    apiFetch<{ data: Branch[] }>("/branches"),
    // หมวดที่เพิ่มเอง = ข้อมูล Drop Down (vault_category)
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vault_category").then((r) => ({ data: { custom: r.data.map((o) => o.name) } })),
    getI18n(),
    apiFetch<{ data: CredentialAccessOptions }>("/credentials/access-options"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vault.newTitle")} />
      <CredentialForm branches={branches} customCategories={categories.custom} accessOptions={accessOptions} canDisableReauth={has(user, "vault.all")} />
    </div>
  );
}
