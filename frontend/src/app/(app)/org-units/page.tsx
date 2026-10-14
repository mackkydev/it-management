import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BuildingIcon } from "@/components/icons";
import { OrgUnitManager } from "@/components/org-unit-manager";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { OrgUnit } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("orgUnits.title") };
}

const TABS = ["divisions", "departments"] as const;
const TAB_CLS = (active: boolean) =>
  `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** ข้อมูลหลัก → ฝ่ายและแผนก (แท็บ ฝ่าย / แผนก — สิทธิ์ org.manage) — /divisions และ /departments พามาที่แท็บนั้น */
export default async function OrgUnitsPage({ searchParams }: PageProps<"/org-units">) {
  if (!has(await getCurrentUser(), "org.manage")) redirect("/tickets");
  const params = await searchParams;
  const tab = TABS.find((x) => x === params.tab) ?? "divisions";
  // ทั้งสองแท็บใช้ข้อมูลของอีกฝั่งด้วย (ฝ่ายเลือกแผนกในฝ่าย / แผนกเลือกฝ่ายที่สังกัด)
  const [{ t }, divisions, departments] = await Promise.all([
    getI18n(),
    apiFetch<{ data: OrgUnit[] }>("/divisions?include_inactive=1").then((r) => r.data),
    apiFetch<{ data: OrgUnit[] }>("/departments?include_inactive=1").then((r) => r.data),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader icon={BuildingIcon} title={t("orgUnits.title")} subtitle={t("orgUnits.subtitle")} />
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
        {TABS.map((k) => (
          <Link key={k} role="tab" aria-selected={tab === k} href={`/org-units?tab=${k}`} className={TAB_CLS(tab === k)}>
            {t(`orgUnits.${k}.title`)} <span className="text-xs text-faint">{(k === "divisions" ? divisions : departments).length}</span>
          </Link>
        ))}
      </div>
      {tab === "divisions" ? (
        <OrgUnitManager key="divisions" table="divisions" items={divisions} departments={departments} />
      ) : (
        <OrgUnitManager key="departments" table="departments" items={departments} divisions={divisions} />
      )}
    </div>
  );
}
