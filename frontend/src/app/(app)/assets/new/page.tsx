import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canManageAssets, getCurrentUser } from "@/lib/auth";
import type { Branch, Location } from "@/lib/types";
import { AssetForm } from "../asset-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.newTitle") };
}

export default async function NewAssetPage() {
  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/assets");

  const [{ data: locations }, { data: branches }, { t }] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("assets.newTitle")}</h1>
      <AssetForm locations={locations} branches={branches} />
    </div>
  );
}
