import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canCreateAssets, getCurrentUser } from "@/lib/auth";
import { isSoftwareType, type Branch, type Location } from "@/lib/types";
import { LicenseForm } from "../license-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.add") };
}

/** เพิ่ม License (?type= office / os / antivirus / other, ?name= ชื่อเริ่มต้น) */
export default async function NewLicensePage({ searchParams }: PageProps<"/licenses/new">) {
  const user = await getCurrentUser();
  if (!canCreateAssets(user)) redirect("/licenses");
  const { type, name } = await searchParams;
  const [{ data: locations }, { data: branches }, { t }, brands] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("licenses.add")}</h1>
      <LicenseForm
        locations={locations}
        branches={branches}
        brands={brands}
        defaultType={isSoftwareType(type) ? type : undefined}
        defaultName={typeof name === "string" ? name.trim().slice(0, 255) : undefined}
      />
    </div>
  );
}
