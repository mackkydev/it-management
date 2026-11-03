import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BuildingIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { Vendor } from "@/lib/types";
import { VendorForm } from "../../vendor-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vendors.editTitle") };
}

export default async function EditVendorPage({ params }: PageProps<"/vendors/[id]/edit">) {
  const [{ id }, user, { t }] = await Promise.all([params, getCurrentUser(), getI18n()]);
  if (!has(user, "vendors.manage")) redirect("/dashboard");
  if (!/^\d+$/.test(id)) notFound();
  const [vendor, types] = await Promise.all([
    apiFetch<{ data: Vendor }>(`/vendors/${id}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/vendor_type"),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader icon={BuildingIcon} title={t("vendors.editTitle")} subtitle={vendor.data.name} />
      <VendorForm vendor={vendor.data} types={types.data.map((o) => o.name)} canDelete />
    </div>
  );
}
