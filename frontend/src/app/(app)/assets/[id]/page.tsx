import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { AssetDetail } from "./asset-detail";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.detail.title") };
}

/** รายละเอียดสินทรัพย์ */
export default async function AssetDetailPage({ params }: PageProps<"/assets/[id]">) {
  const { id } = await params;
  return <AssetDetail id={id} />;
}
