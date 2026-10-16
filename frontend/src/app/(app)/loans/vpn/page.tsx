import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { VpnAccount, VpnLoan } from "@/lib/types";
import { VpnCard } from "./vpn-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vpn.manageTitle") };
}

const TABS = ["requested", "active", "expiring", "ended"] as const;
const TAB_CLS = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/**
 * จัดการ VPN (loans.manage) — รอมอบบัญชี / ใช้งานอยู่ / ใกล้หมด-หมดอายุ / สิ้นสุด
 * ผู้ที่ไม่มีสิทธิ์ (เช่น ผู้ใช้ที่กดแจ้งเตือน "หมดอายุ") → การยืมของฉัน
 */
export default async function ManageVpnPage({ searchParams }: PageProps<"/loans/vpn">) {
  const user = await getCurrentUser();
  if (!has(user, "loans.manage")) redirect("/loans/mine");
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "requested";
  const [{ t }, items, accounts] = await Promise.all([
    getI18n(),
    apiFetch<{ data: VpnLoan[] }>(`/vpn-loans/manage?status=${status}`).then((r) => r.data),
    apiFetch<{ data: VpnAccount[] }>("/vpn-accounts").then((r) => r.data),
  ]);
  const free = accounts.filter((a) => !a.holder).length;

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vpn.manageTitle")} subtitle={t("vpn.manageSubtitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
          {TABS.map((s) => (
            <Link key={s} href={`/loans/vpn?status=${s}`} aria-current={s === status ? "page" : undefined} className={TAB_CLS(s === status)}>
              {t(`vpn.tabs.${s}`)}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted">
          {t("vpn.field.account")}: {free} / {accounts.length}
        </p>
      </div>
      {accounts.length === 0 && <p className={`p-4 text-sm text-muted ${card}`}>{t("vpn.noAccounts")}</p>}
      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vpn.empty")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((l) => (
            <VpnCard key={`${l.id}:${l.status}:${l.expires_on}`} loan={l} accounts={accounts} showUser />
          ))}
        </div>
      )}
    </div>
  );
}
