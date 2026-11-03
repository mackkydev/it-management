import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has, isSuperAdmin } from "@/lib/auth";
import type { ApprovalRoute, Branch, OrgUnit, PermissionCatalog } from "@/lib/types";
import { SignatureStatus } from "../[id]/edit/signature-status";
import { TwoFactorStatus } from "../[id]/edit/two-factor-status";
import { UserForm } from "../user-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.newTitle") };
}

export default async function NewUserPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);
  if (!has(user, "users.create")) redirect("/users");
  const canAssign = has(user, "access.assign");
  const [{ data: branches }, { data: routes }, { data: departments }, { data: divisions }, catalog] = await Promise.all([
    apiFetch<{ data: Branch[] }>("/branches"),
    apiFetch<{ data: ApprovalRoute[] }>("/approval-routes"),
    apiFetch<{ data: OrgUnit[] }>("/departments"),
    apiFetch<{ data: OrgUnit[] }>("/divisions"),
    canAssign ? apiFetch<PermissionCatalog>("/permissions") : null,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("users.newTitle")} />
      <UserForm roleNames={Object.fromEntries((catalog?.groups ?? []).map((g) => [g.key, { th: g.name_th, en: g.name_en }]))} groupOptions={catalog?.groups.filter((g) => !g.is_system) ?? []} branches={branches} routes={routes} departments={departments} divisions={divisions} canAssign={has(user, "access.assign")} superAdmin={isSuperAdmin(user)}
        statusCards={
          // ผู้ใช้ใหม่ยังไม่มีลายเซ็น / 2FA — แสดงสถานะให้แถวเหมือนหน้าแก้ไข (ปุ่มลบ/รีเซ็ตขึ้นเมื่อมีข้อมูลเท่านั้น จึงไม่ใช้ userId)
          <>
            <SignatureStatus userId={0} hasSignature={false} />
            {has(user, "access.manage") && <TwoFactorStatus userId={0} enabled={false} />}
          </>
        }
      />
    </div>
  );
}
