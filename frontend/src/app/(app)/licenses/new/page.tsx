import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { alert } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canCreateAssets, getCurrentUser } from "@/lib/auth";
import { isSoftwareType, type Branch, type License, type LicenseRecordValues, type Location } from "@/lib/types";
import { LicenseForm } from "../license-form";
import { licenseToValues } from "../license-values";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.add") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** คัดลอกจาก License เดิม: เว้นค่าที่ต้องไม่ซ้ำ/เป็นของแต่ละใบ (เลขที่ทรัพย์สิน, S/N, key) */
function duplicateValues(row: License): LicenseRecordValues {
  const v = licenseToValues(row);
  return { ...v, license_no: "", serial_number: "", status: "active", license: { ...v.license, license_key: "", clear_license_key: false } };
}

/** เพิ่ม License (?type= office / os / antivirus / other, ?name= ชื่อเริ่มต้น, ?from= {uuid} คัดลอกจาก License เดิม) */
export default async function NewLicensePage({ searchParams }: PageProps<"/licenses/new">) {
  const user = await getCurrentUser();
  if (!canCreateAssets(user)) redirect("/licenses");
  const { type, name, from } = await searchParams;
  const fromId = typeof from === "string" && UUID_RE.test(from) ? from : null;
  const [{ data: locations }, { data: branches }, { t }, brands, source] = await Promise.all([
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
    // ไม่พบ License ต้นฉบับ = เพิ่มแบบว่างตามปกติ
    fromId
      ? apiFetch<{ data: License }>(`/licenses/${fromId}`).then(
          (r) => r.data,
          (e) => {
            if (e instanceof ApiError && e.status === 404) return null;
            throw e;
          },
        )
      : null,
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{source ? t("licenses.group.duplicateTitle") : t("licenses.add")}</h1>
      {source && <p className={`${alert.info} text-sm text-accent-800 dark:text-accent-200`}>{t("licenses.group.duplicateHint", { name: source.name })}</p>}
      <LicenseForm
        key={source?.id ?? "new"}
        locations={locations}
        branches={branches}
        brands={brands}
        initial={source ? duplicateValues(source) : undefined}
        defaultType={isSoftwareType(type) ? type : undefined}
        defaultName={typeof name === "string" ? name.trim().slice(0, 255) : undefined}
      />
    </div>
  );
}
