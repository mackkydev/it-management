import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuildingIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { VendorForm } from "../vendor-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vendors.add") };
}

export default async function NewVendorPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);
  if (!has(user, "vendors.manage")) redirect("/dashboard");
  const { data } = await apiFetch<{ data: { name: string }[] }>("/dropdown-options/vendor_type");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader icon={BuildingIcon} title={t("vendors.add")} subtitle={t("vendors.subtitle")} />
      <VendorForm types={data.map((o) => o.name)} />
    </div>
  );
}
