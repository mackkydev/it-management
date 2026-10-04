import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has, isLocalAdmin } from "@/lib/auth";
import type { ApprovalRoute, Branch, ManagedUser, OrgUnit } from "@/lib/types";
import { UserForm } from "../../user-form";
import { SignatureStatus } from "./signature-status";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.editTitle") };
}

async function getUser(id: string) {
  try {
    return await apiFetch<{ data: ManagedUser; meta: { can_delete: boolean } }>(`/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function EditUserPage({ params }: PageProps<"/users/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const me = await getCurrentUser();
  if (!has(me, "users.manage")) redirect("/users");

  const [{ data: user, meta }, { t }, { data: branches }, { data: routes }, { data: departments }, { data: divisions }] = await Promise.all([
    getUser(id),
    getI18n(),
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: ApprovalRoute[] }>("/approval-routes"),
    apiFetch<{ data: OrgUnit[] }>("/departments"),
    apiFetch<{ data: OrgUnit[] }>("/divisions"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("users.editTitle")} subtitle={user.email} />
      {isLocalAdmin(me) && <SignatureStatus userId={user.id} hasSignature={Boolean(user.has_signature)} />}
      <UserForm user={user} isSelf={user.id === me.id} canDelete={meta.can_delete} branches={branches} routes={routes} departments={departments} divisions={divisions} />
    </div>
  );
}
