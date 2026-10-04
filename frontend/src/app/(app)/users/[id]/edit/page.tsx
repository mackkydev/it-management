import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { Branch, ManagedUser } from "@/lib/types";
import { UserForm } from "../../user-form";

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
  if (me.role !== "admin") redirect("/users");

  const [{ data: user, meta }, { t }, { data: branches }] = await Promise.all([
    getUser(id),
    getI18n(),
    apiFetch<{ data: Branch[] }>("/branches"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("users.editTitle")} subtitle={user.email} />
      <UserForm user={user} isSelf={user.id === me.id} canDelete={meta.can_delete} branches={branches} />
    </div>
  );
}
