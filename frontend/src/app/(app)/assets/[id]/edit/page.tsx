import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { AssetEdit } from "./asset-edit";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.editTitle") };
}

export default async function EditAssetPage({ params }: PageProps<"/assets/[id]/edit">) {
  const { id } = await params;
  return <AssetEdit id={id}  />;
}
