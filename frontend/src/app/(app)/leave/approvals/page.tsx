import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircleIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { LeaveRequest } from "@/lib/types";
import { LeaveCard } from "../leave-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("leave.approvalsTitle") };
}

const TAB_CLS = (active: boolean) =>
  `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** ใบลาที่รอฉันอนุมัติ / ที่ฉันตัดสินแล้ว */
export default async function LeaveApprovalsPage({ searchParams }: PageProps<"/leave/approvals">) {
  const params = await searchParams;
  const tab = params.status === "decided" ? "decided" : "pending";
  const [{ t }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: LeaveRequest[] }>(`/leave/approvals?status=${tab}`)]);
  return (
    <div className="space-y-5">
      <PageHeader icon={CheckCircleIcon} title={t("leave.approvalsTitle")} subtitle={t("leave.approvalsSubtitle")} />
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
        {(["pending", "decided"] as const).map((s) => (
          <Link key={s} href={`/leave/approvals?status=${s}`} role="tab" aria-selected={tab === s} className={TAB_CLS(tab === s)}>
            {t(`leave.approvalTabs.${s}`)}
          </Link>
        ))}
      </div>
      {data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("leave.emptyApprovals")}</div>
      ) : (
        <ul className="space-y-2.5">
          {data.map((l) => (
            <LeaveCard key={l.id} leave={l} showUser />
          ))}
        </ul>
      )}
    </div>
  );
}
