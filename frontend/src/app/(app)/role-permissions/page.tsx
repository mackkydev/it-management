import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has, isSuperAdmin } from "@/lib/auth";
import type { PermissionCatalog } from "@/lib/types";
import { RoleMatrix } from "./role-matrix";
import { BookingScopeForm } from "./booking-scope-form";
import { CalendarScopeForm } from "./calendar-scope-form";
import { ManageScopeForm } from "./manage-scope-form";
import type { BookingKind, BookingScope, CalendarScope, ManageScope } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("rolePermissions.title") };
}

/**
 * ตั้งค่าระบบ → สิทธิ์ตามกลุ่ม: ตาราง ระบบงาน × การกระทำ ของแต่ละกลุ่ม + จัดการกลุ่ม + สวิตช์วันหมดอายุ
 * แก้ทุกกลุ่ม + สวิตช์/ขอบเขต = access.manage, แก้กลุ่มที่ต่ำกว่า = access.groups (catalog.editable_groups), ดูได้ = access.assign
 */
export default async function RolePermissionsPage() {
  const user = await getCurrentUser();
  const canManage = has(user, "access.manage");
  // ขอบเขตต่อกลุ่ม: access.manage = ทุกกลุ่ม, access.groups = เฉพาะกลุ่มที่ต่ำกว่า (catalog.editable_groups)
  const canScope = canManage || has(user, "access.groups");
  if (!canManage && !has(user, "access.assign") && !has(user, "access.groups")) redirect("/tickets");
  const [{ t }, catalog, scopes, bookingScopes, manageScopes] = await Promise.all([
    getI18n(),
    apiFetch<PermissionCatalog>("/permissions"),
    // ขอบเขตปฏิทินต่อกลุ่ม — แก้ได้เฉพาะผู้ดูแลระบบสูงสุด (access.manage)
    canScope
      ? apiFetch<{ data: { calendar: Record<string, CalendarScope>; leave: Record<string, CalendarScope> } }>("/calendar/scope").then((r) => r.data)
      : Promise.resolve(null),
    // ห้องประชุม / รถ ตามสาขา ต่อกลุ่ม
    canScope ? apiFetch<{ data: Record<BookingKind, Record<string, BookingScope>> }>("/booking-scope").then((r) => r.data) : Promise.resolve(null),
    // ขอบเขตการจัดการตามสาขา (ผู้ใช้ / ใบลา / วันหยุด)
    canScope ? apiFetch<{ data: Record<string, ManageScope> }>("/manage-scope").then((r) => r.data) : Promise.resolve(null),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("rolePermissions.title")} subtitle={t("rolePermissions.subtitle")} />
      <RoleMatrix catalog={catalog} canManage={canManage} superAdmin={isSuperAdmin(user)} held={user.permissions ?? []} />
      {/* ขอบเขตปฏิทิน (กิจกรรม/หน้างาน) และขอบเขตการลา ตั้งแยกกัน */}
      {manageScopes && <ManageScopeForm groups={catalog.groups} initial={manageScopes} editable={catalog.editable_groups} />}
      {scopes && <CalendarScopeForm groups={catalog.groups} initial={scopes.calendar} kind="calendar" editable={catalog.editable_groups} />}
      {scopes && <CalendarScopeForm groups={catalog.groups} initial={scopes.leave} kind="leave" editable={catalog.editable_groups} />}
      {bookingScopes && <BookingScopeForm groups={catalog.groups} initial={bookingScopes} editable={catalog.editable_groups} />}
    </div>
  );
}
