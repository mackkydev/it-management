import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ItemBadge } from "@/components/shell/menu-badges";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { VpnAccount, VpnLoan } from "@/lib/types";
import { VpnCard } from "./vpn-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vpn.manageTitle") };
}

const TABS = ["requested", "approval", "active", "expiring", "ended"] as const;
const TAB_CLS = (active: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/**
 * จัดการ VPN (loans.manage) — รอมอบบัญชี / รออนุมัติ / ใช้งานอยู่ / ใกล้หมด-หมดอายุ / สิ้นสุด — ตัวเลขที่แท็บ = menu-badges `/loans/vpn?status=…`
 * ผู้จัดการฝ่าย IT ที่ไม่มี loans.manage เห็นเฉพาะแท็บรออนุมัติ (API บังคับ) · ผู้ที่ไม่มีสิทธิ์ (เช่น ผู้ใช้ที่กดแจ้งเตือน "หมดอายุ") → หน้า VPN ของตัวเอง
 */
export default async function ManageVpnPage({ searchParams }: PageProps<"/loans/vpn">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "requested";
  const manage = await apiFetch<{ data: VpnLoan[]; meta: { status: string; can_manage: boolean; approver: boolean; notify_days: number } }>(`/vpn-loans/manage?status=${status}`).catch((e) => {
    if (e instanceof ApiError && e.status === 403) redirect("/loans/vpn/request");
    throw e;
  });
  const canManage = has(user, "loans.manage") && manage.meta.can_manage;
  const [{ t }, accounts] = await Promise.all([getI18n(), canManage ? apiFetch<{ data: VpnAccount[] }>("/vpn-accounts").then((r) => r.data) : Promise.resolve([] as VpnAccount[])]);
  const items = manage.data;
  const tabs = canManage ? TABS : (["approval"] as const);
  const current = manage.meta.status;
  const free = accounts.filter((a) => !a.holder).length;

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vpn.manageTitle")} subtitle={t("vpn.manageSubtitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
          {tabs.map((s) => (
            <Link key={s} href={`/loans/vpn?status=${s}`} aria-current={s === current ? "page" : undefined} className={TAB_CLS(s === current)}>
              {t(`vpn.tabs.${s}`)}
              <ItemBadge href={`/loans/vpn?status=${s}`} />
            </Link>
          ))}
        </nav>
        {canManage && (
          <p className="text-sm text-muted">
            {t("vpn.field.account")}: {free} / {accounts.length}
          </p>
        )}
      </div>
      {canManage && accounts.length === 0 && <p className={`p-4 text-sm text-muted ${card}`}>{t("vpn.noAccounts")}</p>}
      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vpn.empty")}</div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((l) => (
            <VpnCard key={`${l.id}:${l.status}:${l.expires_on}:${l.revoked_at}`} loan={l} accounts={canManage ? accounts : undefined} showUser compact defaultNotifyDays={manage.meta.notify_days} />
          ))}
        </div>
      )}
    </div>
  );
}
