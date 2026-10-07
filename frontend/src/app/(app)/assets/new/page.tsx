import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canManageAssets, getCurrentUser } from "@/lib/auth";
import { CATEGORIES, type Branch, type Location } from "@/lib/types";
import { AssetForm } from "../asset-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.newTitle") };
}

export default async function NewAssetPage({ searchParams }: PageProps<"/assets/new">) {
  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/assets");

  // ?category=SOFTWARE — มาจากปุ่ม "เพิ่ม Software / License ใหม่" ในช่อง Software ของฟอร์มคอมพิวเตอร์
  const { category } = await searchParams;
  const defaultCategory = typeof category === "string" && (CATEGORIES as readonly string[]).includes(category) ? category : undefined;
  const [{ data: locations }, { data: branches }, { t }] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("assets.newTitle")}</h1>
      <AssetForm locations={locations} branches={branches} defaultCategory={defaultCategory} />
    </div>
  );
}
