import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeftIcon, ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has, isSuperAdmin } from "@/lib/auth";
import type { PermissionCatalog, UserPermissionView } from "@/lib/types";
import { PermissionEditor } from "./permission-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("access.permissionsTitle") };
}

/** สิทธิ์การใช้งานของผู้ใช้ (LOCAL / API): ตำแหน่ง + กลุ่มที่มอบเพิ่ม + สิทธิ์รายข้อ — ผู้มีสิทธิ์ access.assign (API ตรวจกติกาการมอบซ้ำ) */
export default async function UserPermissionsPage({ params, searchParams }: PageProps<"/users/[id]/permissions">) {
  const me = await getCurrentUser();
  if (!has(me, "access.assign")) redirect("/tickets");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const from = (await searchParams).from === "api-users" ? "/api-users" : "/users";

  const [{ t }, view, catalog] = await Promise.all([
    getI18n(),
    apiFetch<{ data: UserPermissionView }>(`/users/${id}/permissions`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      },
    ),
    apiFetch<PermissionCatalog>("/permissions"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldIcon}
        title={view.user.name}
        subtitle={view.user.email ?? t("access.noEmail")}
        actions={
          <Link href={from} className={btn.secondary}>
            <LinkPendingIcon icon={<ChevronLeftIcon />} />
            {t("access.back")}
          </Link>
        }
      />
      <PermissionEditor initial={view} catalog={catalog} superAdmin={isSuperAdmin(me)} />
    </div>
  );
}
