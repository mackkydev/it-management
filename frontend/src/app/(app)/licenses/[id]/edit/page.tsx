import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canDeleteAssets, canEditAssets, getCurrentUser } from "@/lib/auth";
import type { Branch, License, Location } from "@/lib/types";
import { LicenseForm } from "../../license-form";
import { licenseToValues } from "../../license-values";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.editTitle") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLicensePage({ params }: PageProps<"/licenses/[id]/edit">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await getCurrentUser();
  if (!canEditAssets(user)) redirect("/licenses");
  const [row, { data: locations }, { data: branches }, { t }, brands] = await Promise.all([
    apiFetch<{ data: License }>(`/licenses/${id}`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      },
    ),
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("licenses.editTitle")}</h1>
        {row.license_no && <p className="font-mono text-sm text-muted">{row.license_no}</p>}
      </div>
      <LicenseForm
        locations={locations}
        branches={branches}
        brands={brands}
        licenseId={row.id}
        initial={licenseToValues(row)}
        canDelete={canDeleteAssets(user)}
        hasLicenseKey={row.license.has_key}
      />
    </div>
  );
}
