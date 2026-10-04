import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeftIcon, ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { PermissionDef, UserPermissionView } from "@/lib/types";
import { PermissionEditor } from "./permission-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("access.permissionsTitle") };
}

/** แก้บทบาท + สิทธิ์รายคนของผู้ใช้ (Local Admin) */
export default async function UserPermissionsPage({ params }: PageProps<"/api-users/[id]">) {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const [{ t }, view, catalog] = await Promise.all([
    getI18n(),
    apiFetch<{ data: UserPermissionView }>(`/users/${id}/permissions`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      },
    ),
    apiFetch<{ data: PermissionDef[]; role_permissions: Record<string, string[]> }>("/permissions"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldIcon}
        title={view.user.name}
        subtitle={view.user.email ?? t("access.noEmail")}
        actions={
          <Link href="/api-users" className={btn.secondary}>
            <LinkPendingIcon icon={<ChevronLeftIcon />} />
            {t("access.back")}
          </Link>
        }
      />
      <PermissionEditor initial={view} catalog={catalog.data} rolePermissions={catalog.role_permissions} />
    </div>
  );
}
