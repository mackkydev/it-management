import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuildingIcon } from "@/components/icons";
import { OrgUnitManager } from "@/components/org-unit-manager";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { OrgUnit } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("orgUnits.title") };
}

/**
 * ข้อมูลหลัก → ฝ่ายและแผนก (สิทธิ์ org.manage) — แท็บเดียว: ฝ่ายกับแผนกใช้ชื่อเดียวกัน (Unit Code ของ SyteLine)
 * รายการ = แผนก; เพิ่ม/แก้/ลบ ส่ง mirror_division ให้ฝ่ายชื่อเดียวกันเปลี่ยนตาม — /divisions, /departments, ?tab= เดิมพามาที่นี่
 */
export default async function OrgUnitsPage() {
  if (!has(await getCurrentUser(), "org.manage")) redirect("/tickets");
  const [{ t }, units] = await Promise.all([getI18n(), apiFetch<{ data: OrgUnit[] }>("/departments?include_inactive=1").then((r) => r.data)]);
  return (
    <div className="space-y-5">
      <PageHeader icon={BuildingIcon} title={t("orgUnits.title")} subtitle={t("orgUnits.units.subtitle")} />
      <OrgUnitManager table="departments" items={units} mirrorDivision />
    </div>
  );
}
