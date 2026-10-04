import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MapPinIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canDeleteAssets, canManageAssets, getCurrentUser } from "@/lib/auth";
import type { Location } from "@/lib/types";
import { LocationForm } from "../../location-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("locations.editTitle") };
}

async function getLocation(id: string) {
  try {
    return (await apiFetch<{ data: Location }>(`/locations/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function EditLocationPage({ params }: PageProps<"/locations/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/locations");

  const [location, { data }, { t, fmt }] = await Promise.all([
    getLocation(id),
    apiFetch<{ data: Location[] }>("/locations?include_inactive=1"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MapPinIcon}
        title={t("locations.editTitle")}
        subtitle={`${location.code} · ${t("locations.counts", {
          assets: fmt.number(location.assets_count ?? 0),
          children: fmt.number(location.children_count ?? 0),
        })}`}
      />
      {/* ลบได้เฉพาะ admin (สิทธิ์เดียวกับการลบสินทรัพย์) */}
      <LocationForm locations={data} location={location} canDelete={canDeleteAssets(user)} />
    </div>
  );
}
