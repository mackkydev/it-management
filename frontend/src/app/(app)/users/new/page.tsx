import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { UserForm } from "../user-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.newTitle") };
}

export default async function NewUserPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);
  if (user.role !== "admin") redirect("/users");

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("users.newTitle")} />
      <UserForm branches={(await apiFetch<{ data: Branch[] }>("/branches")).data} />
    </div>
  );
}
