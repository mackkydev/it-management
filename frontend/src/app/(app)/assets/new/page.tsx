import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { assetCategoryNames } from "@/lib/asset-categories";
import { canCreateAssets, getCurrentUser } from "@/lib/auth";
import { CATEGORIES, isSoftwareType, type Branch, type Location } from "@/lib/types";
import { AssetForm } from "../asset-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.newTitle") };
}

export default async function NewAssetPage({ searchParams }: PageProps<"/assets/new">) {
  const params = await searchParams;
  // ซอฟต์แวร์ License เพิ่มที่ /licenses/new (เมนู ซอฟต์แวร์ License)
  if (params.category === "SOFTWARE") redirect(isSoftwareType(params.type) ? `/licenses/new?type=${params.type}` : "/licenses/new");
  return <NewAssetView params={params} />;
}

/** ฟอร์มเพิ่มสินทรัพย์ */
async function NewAssetView({ params }: { params: Record<string, string | string[] | undefined> }) {
  const user = await getCurrentUser();
  if (!canCreateAssets(user)) redirect("/assets");

  // ?asset_no=&name= — จากแท็บ "สินทรัพย์ที่ต้องเพิ่ม" (เลขทรัพย์สิน + ชื่อเครื่องในใบแจ้งซ่อม)
  const { asset_no, name, category } = params;
  const prefill = {
    ...(typeof asset_no === "string" && asset_no.trim() ? { cpu_tag: asset_no.trim().slice(0, 100), source_asset_no: asset_no.trim().slice(0, 100) } : {}),
    ...(typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 255) } : {}),
  };
  const defaultCategory = typeof category === "string" && (CATEGORIES as readonly string[]).includes(category) ? category : undefined;
  const [{ data: locations }, { data: branches }, { t }, computerTypes, brands, computerSpecs, categories, departments] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_type").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_spec").then((r) => r.data.map((o) => o.name)),
    assetCategoryNames(),
    apiFetch<{ data: { name: string }[] }>("/departments").then((r) => r.data.map((o) => o.name)),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("assets.newTitle")}</h1>
      <AssetForm
        locations={locations}
        branches={branches}
        computerTypes={computerTypes}
        computerSpecs={computerSpecs}
        brands={brands}
        categories={categories}
        departments={departments}
        defaultCategory={defaultCategory}
        prefill={prefill}
      />
    </div>
  );
}
