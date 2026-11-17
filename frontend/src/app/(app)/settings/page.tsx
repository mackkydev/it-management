import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellIcon,
  ClipboardIcon,
  DatabaseIcon,
  FileTextIcon,
  ImageIcon,
  KeyIcon,
  LockIcon,
  PenIcon,
  SendIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { card } from "@/components/ui";
import { getBranding, getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser, getUiConfig } from "@/lib/auth";
import type { AppSettings, FixedAssetSyncRun, FixedAssetSyncSettings, Paginated, PermissionCatalog, SystemPolicy } from "@/lib/types";
import { FixedAssetSync } from "./fixed-asset-sync";
import { LogoCard } from "./logo-card";
import { SecurityForm } from "./security-form";
import { SettingsForm } from "./settings-form";
import { PasswordPolicyForm } from "./password-policy-form";
import { TwoFactorPolicy } from "./two-factor-policy";
import { SignaturePolicy } from "./signature-policy";
import { PolicyOptions } from "./policy-options";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settingsPage.title") };
}

/** เมนูย่อยของหน้าตั้งค่า = การ์ดเดิมทีละกลุ่ม; `access` = ต้องมี access.manage (2FA / นโยบายรหัสผ่าน) */
const TABS = [
  { key: "brand", icon: ImageIcon },
  { key: "expiry", icon: BellIcon },
  { key: "tickets", icon: ClipboardIcon },
  { key: "emails", icon: SendIcon },
  { key: "secrets", icon: LockIcon },
  { key: "two_factor", icon: ShieldIcon, access: true },
  { key: "password", icon: KeyIcon, access: true },
  { key: "policy", icon: FileTextIcon },
  { key: "signature", icon: PenIcon },
  { key: "syteline", icon: DatabaseIcon },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_CLS = (active: boolean) =>
  `flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:whitespace-normal ${active ? "bg-accent-100 text-accent-900 dark:bg-accent-400/15 dark:text-accent-100" : "text-muted hover:bg-subtle hover:text-ink"}`;

/**
 * 5.2 การตั้งค่าระบบ — เมนูย่อยซ้าย (`?tab=`) เนื้อหาขวา (จอเล็ก = เมนูเลื่อนแนวนอนด้านบน) แบบเดียวกับหน้าข้อมูล Drop Down
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await getCurrentUser();
  if (!has(user, "settings.manage")) redirect("/tickets");
  const canAccess = has(user, "access.manage");
  const tabs = TABS.filter((x) => !("access" in x) || canAccess);
  const params = await searchParams;
  const tab: TabKey = tabs.find((x) => x.key === params.tab)?.key ?? tabs[0].key;

  const [{ data }, { t, defaults }] = await Promise.all([apiFetch<{ data: AppSettings }>("/settings"), getI18n()]);

  let body: React.ReactNode;
  switch (tab) {
    case "brand": {
      const [brand, ui] = await Promise.all([getBranding(), getUiConfig()]);
      body = <LogoCard version={ui.logo_version} brand={brand} defaults={defaults} />;
      break;
    }
    case "expiry":
    case "tickets":
    case "emails":
      body = <SettingsForm key={tab} initial={data} section={tab} />;
      break;
    case "secrets":
      body = (
        <SecurityForm
          initial={data.secret_guard}
          pinStatus={data.secret_pin_status}
          canManagePin={has(user, "secrets.pin_manage")}
          userOptions={data.secret_notify_options}
          effectiveRecipients={data.secret_notify_effective}
        />
      );
      break;
    case "two_factor":
    case "password": {
      // บังคับ 2FA ตามกลุ่ม / นโยบายรหัสผ่าน (access.manage)
      const { groups } = await apiFetch<PermissionCatalog>("/permissions");
      body =
        tab === "two_factor" ? (
          <TwoFactorPolicy groups={groups} initial={data.two_factor_groups ?? []} />
        ) : (
          <PasswordPolicyForm initial={data.password_policy} groups={groups} />
        );
      break;
    }
    case "policy": {
      // นโยบายการใช้งานระบบที่ต้องยอมรับก่อนใช้งาน (settings.manage)
      const policy = await apiFetch<{ data: SystemPolicy }>("/policy");
      body = <PolicyOptions initial={policy.data} />;
      break;
    }
    case "signature":
      body = <SignaturePolicy initial={Boolean(data.require_signature)} />;
      break;
    case "syteline": {
      // Fixed Assets จาก STEC SyteLine — ตั้งค่า (settings.manage) + ซิงค์/ประวัติ (fixed_assets.sync)
      // ประวัติการซิงค์หน้าละ 10 รอบ (?page=)
      const runPage = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
      const [fa, runs] = await Promise.all([
        apiFetch<{ data: FixedAssetSyncSettings }>("/fixed-assets/settings"),
        apiFetch<Paginated<FixedAssetSyncRun>>(`/fixed-assets/sync-runs?page=${runPage}`),
      ]);
      body = (
        <FixedAssetSync
          key={JSON.stringify(fa.data)}
          initial={fa.data}
          runs={runs.data}
          canSync={has(user, "fixed_assets.sync")}
          pager={<Pagination meta={runs.meta} href={(n: number) => `/settings?tab=syteline&page=${n}`} />}
        />
      );
      break;
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={SettingsIcon} title={t("settingsPage.title")} subtitle={t("settingsPage.subtitle")} />
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("settingsPage.title")}
          className={`flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible ${card}`}
        >
          {tabs.map(({ key, icon: Icon }) => (
            <Link key={key} role="tab" aria-selected={tab === key} href={`/settings?tab=${key}`} scroll={false} className={TAB_CLS(tab === key)}>
              <Icon width={16} height={16} className={`shrink-0 ${tab === key ? "text-accent-500" : ""}`} />
              {t(`settingsPage.nav.${key}`)}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{body}</div>
      </div>
    </div>
  );
}
