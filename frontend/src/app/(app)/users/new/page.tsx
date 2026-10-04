import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { ApprovalRoute, Branch, OrgUnit } from "@/lib/types";
import { UserForm } from "../user-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.newTitle") };
}

export default async function NewUserPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);
  if (!has(user, "users.manage")) redirect("/users");
  const [{ data: branches }, { data: routes }, { data: departments }, { data: divisions }] = await Promise.all([
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: ApprovalRoute[] }>("/approval-routes"),
    apiFetch<{ data: OrgUnit[] }>("/departments"),
    apiFetch<{ data: OrgUnit[] }>("/divisions"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("users.newTitle")} />
      <UserForm branches={branches} routes={routes} departments={departments} divisions={divisions} />
    </div>
  );
}
