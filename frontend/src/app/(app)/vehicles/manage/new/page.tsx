import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CarIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { VehicleForm } from "../vehicle-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.manage.newTitle") };
}

export default async function NewVehiclePage() {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.manage")) redirect("/vehicles");
  const [{ t }, branches] = await Promise.all([getI18n(), apiFetch<{ data: Branch[] }>("/branches").then((r) => r.data)]);
  return (
    <div className="space-y-5">
      <PageHeader icon={CarIcon} title={t("vehicle.manage.newTitle")} subtitle={t("vehicle.manage.subtitle")} />
      <VehicleForm vehicle={null} branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
