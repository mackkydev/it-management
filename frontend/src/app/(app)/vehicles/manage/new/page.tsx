import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CarIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { branchChoices } from "@/lib/booking-scope";
import { getCurrentUser, has } from "@/lib/auth";
import { VehicleForm } from "../vehicle-form";

const vehicleOptions = (list: string) => apiFetch<{ data: { name: string }[] }>(`/dropdown-options/${list}`).then((r) => r.data.map((o) => o.name));

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.manage.newTitle") };
}

export default async function NewVehiclePage() {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.manage")) redirect("/vehicles");
  const [{ t }, branches, types, fuels] = await Promise.all([getI18n(), branchChoices("vehicle"), vehicleOptions("vehicle_type"), vehicleOptions("vehicle_fuel")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={CarIcon} title={t("vehicle.manage.newTitle")} subtitle={t("vehicle.manage.subtitle")} />
      <VehicleForm vehicle={null} choices={branches} types={types} fuels={fuels} />
    </div>
  );
}
