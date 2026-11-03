import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { canViewLicenses, getCurrentUser } from "@/lib/auth";
import { LicenseDetail } from "../license-detail";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.detailTitle") };
}

export default async function LicenseDetailPage({ params }: PageProps<"/licenses/[id]">) {
  if (!canViewLicenses(await getCurrentUser())) redirect("/dashboard");
  const { id } = await params;
  return <LicenseDetail id={id} />;
}
