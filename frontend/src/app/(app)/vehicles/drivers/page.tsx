import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { branchChoices } from "@/lib/booking-scope";
import type { VehicleDriver } from "@/lib/types";
import { DriverManager } from "./driver-manager";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.drivers.title") };
}

/** คนขับรถ (vehicle.manage หรือ vehicle.dispatch) — ผู้จัดคิวเลือกคนขับตอนอนุมัติการจองที่ขอคนขับ */
export default async function VehicleDriversPage() {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.manage") && !has(user, "vehicle.dispatch")) redirect("/vehicles");
  const [{ t }, drivers, choices, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: VehicleDriver[] }>("/vehicle-drivers?include_inactive=1").then((r) => r.data),
    branchChoices("vehicle"),
    getAccess(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("vehicle.drivers.title")} subtitle={t("vehicle.drivers.subtitle")} />
      <DriverManager drivers={drivers} choices={choices} canCreate={can("btn:drivers:create")} />
    </div>
  );
}
