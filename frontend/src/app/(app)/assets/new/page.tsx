import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canCreateAssets, getCurrentUser } from "@/lib/auth";
import { CATEGORIES, isSoftwareType, type Branch, type Location } from "@/lib/types";
import { AssetForm } from "../asset-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.newTitle") };
}

export default async function NewAssetPage({ searchParams }: PageProps<"/assets/new">) {
  const user = await getCurrentUser();
  if (!canCreateAssets(user)) redirect("/assets");

  // ?category=SOFTWARE — มาจากปุ่ม "เพิ่ม Software / License ใหม่" ในช่อง Software ของฟอร์มคอมพิวเตอร์
  // &type=os|office|antivirus|other — ประเภท License (มาจากช่อง OS / Office / Anti Virus ของฟอร์มคอมพิวเตอร์)
  // ?asset_no=&name= — จากแท็บ "สินทรัพย์ที่ต้องเพิ่ม" (เลขทรัพย์สิน + ชื่อเครื่องในใบแจ้งซ่อม)
  const { category, type, asset_no, name } = await searchParams;
  const prefill = {
    ...(typeof asset_no === "string" && asset_no.trim() ? { cpu_tag: asset_no.trim().slice(0, 100) } : {}),
    ...(typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 255) } : {}),
  };
  const defaultCategory = typeof category === "string" && (CATEGORIES as readonly string[]).includes(category) ? category : undefined;
  const defaultSoftwareType = isSoftwareType(type) ? type : undefined;
  const [{ data: locations }, { data: branches }, { t }, computerTypes, brands, computerSpecs] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_type").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_spec").then((r) => r.data.map((o) => o.name)),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{defaultCategory === "SOFTWARE" ? t("licenses.add") : t("assets.newTitle")}</h1>
      <AssetForm
        locations={locations}
        branches={branches}
        computerTypes={computerTypes}
        computerSpecs={computerSpecs}
        brands={brands}
        defaultCategory={defaultCategory}
        defaultSoftwareType={defaultSoftwareType}
        prefill={prefill}
      />
    </div>
  );
}
