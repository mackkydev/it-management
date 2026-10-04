import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPinIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canManageAssets, getCurrentUser } from "@/lib/auth";
import type { Location } from "@/lib/types";
import { LocationForm } from "../location-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("locations.newTitle") };
}

export default async function NewLocationPage() {
  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/locations");

  const [{ data }, { t }] = await Promise.all([apiFetch<{ data: Location[] }>("/locations?include_inactive=1"), getI18n()]);

  return (
    <div className="space-y-5">
      <PageHeader icon={MapPinIcon} title={t("locations.newTitle")} />
      <LocationForm locations={data} />
    </div>
  );
}
