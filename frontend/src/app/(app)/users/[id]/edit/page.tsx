import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has, isSuperAdmin } from "@/lib/auth";
import { isReadOnly } from "@/lib/permissions";
import type { ApprovalRoute, Branch, LoginActivity, ManagedUser, OrgUnit, PermissionCatalog } from "@/lib/types";
import { UserForm } from "../../user-form";
import { SignatureStatus } from "./signature-status";
import { LoginLockStatus } from "./login-lock-status";
import { TwoFactorStatus } from "./two-factor-status";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.editTitle") };
}

async function getUser(id: string) {
  try {
    return await apiFetch<{ data: ManagedUser; meta: { can_delete: boolean; two_factor_required: boolean; login_activity?: LoginActivity } }>(`/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function EditUserPage({ params }: PageProps<"/users/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const me = await getCurrentUser();
  if (!has(me, "users.update")) redirect("/users");

  const [{ data: user, meta }, { t }, { data: branches }, { data: routes }, { data: departments }, { data: divisions }, catalog] = await Promise.all([
    getUser(id),
    getI18n(),
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: ApprovalRoute[] }>("/approval-routes"),
    apiFetch<{ data: OrgUnit[] }>("/departments"),
    apiFetch<{ data: OrgUnit[] }>("/divisions"),
    has(me, "access.assign") ? apiFetch<PermissionCatalog>("/permissions") : null,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UsersIcon}
        title={t("users.editTitle")}
        subtitle={user.email}
        actions={
          has(me, "access.assign") && (
            <Link href={`/users/${user.id}/permissions`} className={btn.secondary}>
              <LinkPendingIcon icon={<ShieldIcon className="text-accent-500" />} />
              {t("access.openPermissions")}
            </Link>
          )
        }
      />
      {meta.login_activity && <LoginLockStatus userId={user.id} until={user.login_locked_until ?? null} activity={meta.login_activity} canUnlock={has(me, "users.unlock") && !isReadOnly(me)} />}
      <UserForm
        user={user}
        isSelf={user.id === me.id}
        canDelete={meta.can_delete && has(me, "users.delete")}
        branches={branches}
        routes={routes}
        departments={departments}
        divisions={divisions}
        canAssign={has(me, "access.assign")}
        superAdmin={isSuperAdmin(me)}
        roleNames={Object.fromEntries((catalog?.groups ?? []).map((g) => [g.key, { th: g.name_th, en: g.name_en }]))}
        statusCards={
          <>
            <SignatureStatus userId={user.id} hasSignature={Boolean(user.has_signature)} />
            {has(me, "access.manage") && user.type === "LOCAL" && <TwoFactorStatus userId={user.id} enabled={Boolean(user.two_factor_enabled)} required={meta.two_factor_required} />}
          </>
        }
      />
    </div>
  );
}
