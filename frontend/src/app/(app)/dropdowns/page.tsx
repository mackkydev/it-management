import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListIcon, LockIcon } from "@/components/icons";
import { OrgUnitManager } from "@/components/org-unit-manager";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { assetCategoryLabel, CREDENTIAL_CATEGORIES, type OrgUnit } from "@/lib/types";
import { TicketTypesForm } from "../ticket-types/ticket-types-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("dropdowns.title") };
}

/** แท็บ → สิทธิ์ที่ใช้จัดการ */
const TABS = [
  { key: "contract_categories", perm: "contracts.categories" },
  { key: "vault_category", perm: "dropdowns.manage" },
  { key: "asset_category", perm: "dropdowns.manage" },
  { key: "computer_type", perm: "dropdowns.manage" },
  { key: "computer_spec", perm: "dropdowns.manage" },
  { key: "brand", perm: "dropdowns.manage" },
  { key: "ticket_types", perm: "dropdowns.manage" },
  { key: "meeting_purpose", perm: "meeting.rooms" },
  { key: "meeting_equipment", perm: "meeting.rooms" },
  { key: "zoom_account", perm: "zoom.manage" },
  { key: "vendor_type", perm: "vendors.manage" },
  { key: "vehicle_purpose", perm: "vehicle.manage" },
  { key: "vehicle_extra", perm: "vehicle.manage" },
  { key: "vehicle_type", perm: "vehicle.manage" },
  { key: "vehicle_fuel", perm: "vehicle.manage" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_CLS = (active: boolean) =>
  `block cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:whitespace-normal ${active ? "bg-accent-100 text-accent-900 dark:bg-accent-400/15 dark:text-accent-100" : "text-muted hover:bg-subtle hover:text-ink"}`;

/**
 * ข้อมูลหลัก → ข้อมูล Drop Down: หมวดหมู่สัญญา / หมวดหมู่คลังบัญชี / Computer Type / ยี่ห้อ / ตัวเลือกเรื่อง "อื่นๆ" / ประเภทการใช้งาน + อุปกรณ์ห้องประชุม
 * หัวข้ออยู่ซ้าย ตัวจัดการ + ข้อมูลอยู่ขวา (จอเล็ก = หัวข้อเลื่อนแนวนอนด้านบน) — เห็นเฉพาะแท็บที่มีสิทธิ์ — /contract-categories และ /ticket-types พามาที่แท็บนั้น
 */
export default async function DropdownsPage({ searchParams }: PageProps<"/dropdowns">) {
  const user = await getCurrentUser();
  const tabs = TABS.filter((x) => has(user, x.perm));
  if (!tabs.length) redirect("/tickets");
  const params = await searchParams;
  const tab: TabKey = tabs.find((x) => x.key === params.tab)?.key ?? tabs[0].key;
  const { t } = await getI18n();

  let body: React.ReactNode;
  if (tab === "ticket_types") {
    const { data } = await apiFetch<{ data: string[] }>("/ticket-other-types");
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t("ticketTypes.subtitle")}</p>
        <TicketTypesForm initial={data} />
      </div>
    );
  } else {
    const path = tab === "contract_categories" ? "/contract-categories" : `/dropdown-options/${tab}`;
    const { data } = await apiFetch<{ data: OrgUnit[] }>(`${path}?include_inactive=1`);
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t(`orgUnits.${tab}.subtitle`)}</p>
        {(tab === "vault_category" || tab === "contract_categories") && (
          // หมวดตั้งต้น (คลังบัญชี / หมวดหมู่สัญญา ชุดเดียวกัน) — แปลตามภาษา แก้/ลบไม่ได้
          <div className={`flex flex-wrap items-center gap-1.5 p-3 text-sm ${card}`}>
            <span className="mr-1 flex items-center gap-1 text-muted">
              <LockIcon width={12} height={12} />
              {t("dropdowns.builtinVault")}
            </span>
            {CREDENTIAL_CATEGORIES.map((c) => (
              <span key={c} className="rounded-full bg-subtle px-2.5 py-0.5 text-xs">
                {t(`vault.categories.${c}`)}
              </span>
            ))}
          </div>
        )}
        {tab === "asset_category" && (
          // คอมพิวเตอร์เป็นรหัสตายตัว — ฟอร์มอิงรหัสนี้ แก้/ลบไม่ได้ (Software / License อยู่เมนูซอฟต์แวร์ License)
          <div className={`flex flex-wrap items-center gap-1.5 p-3 text-sm ${card}`}>
            <span className="mr-1 flex items-center gap-1 text-muted">
              <LockIcon width={12} height={12} />
              {t("dropdowns.builtinVault")}
            </span>
            <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs">{assetCategoryLabel(t, "COMPUTER")}</span>
          </div>
        )}
        <OrgUnitManager key={tab} table={tab} items={data.filter((o) => !o.key)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={ListIcon} title={t("dropdowns.title")} subtitle={t("dropdowns.subtitle")} />
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav role="tablist" aria-orientation="vertical" aria-label={t("dropdowns.title")} className={`flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible ${card}`}>
          {tabs.map((x) => (
            <Link key={x.key} role="tab" aria-selected={tab === x.key} href={`/dropdowns?tab=${x.key}`} scroll={false} className={TAB_CLS(tab === x.key)}>
              {t(`dropdowns.tabs.${x.key}`)}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{body}</div>
      </div>
    </div>
  );
}
