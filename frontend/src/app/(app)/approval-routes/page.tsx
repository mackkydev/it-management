import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckCircleIcon, ChevronRightIcon, GitBranchIcon, PencilIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { Bone } from "@/components/skeletons";
import { alert, btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser } from "@/lib/auth";
import type { ApprovalRoute } from "@/lib/types";
import { PlanTester } from "./plan-tester";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("approvalRoutes.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** ตั้งค่าระบบ → สายอนุมัติใบแจ้งงาน (admin) */
export default async function ApprovalRoutesPage({ searchParams }: PageProps<"/approval-routes">) {
  if (!has(await getCurrentUser(), "approval_routes.manage")) redirect("/tickets");
  const [{ t }, params] = await Promise.all([getI18n(), searchParams]);
  const saved = SAVED.find((s) => s === params.saved);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={GitBranchIcon}
        title={t("approvalRoutes.title")}
        subtitle={t("approvalRoutes.subtitle")}
        actions={
          <Link href="/approval-routes/new" className={btn.primary}>
            <LinkPendingIcon icon={<PlusIcon />} />
            {t("approvalRoutes.add")}
          </Link>
        }
      />
      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`approvalRoutes.saved.${saved}`)}
        </div>
      )}
      <div className={`p-4 text-sm text-muted sm:px-6 ${card}`}>
        <p className="font-medium text-ink">{t("approvalRoutes.howTitle")}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>{t("approvalRoutes.how1")}</li>
          <li>{t("approvalRoutes.how2")}</li>
          <li>{t("approvalRoutes.how3")}</li>
        </ol>
      </div>
      <PlanTester />
      <Suspense fallback={<Bone className="h-48 w-full rounded-2xl" />}>
        <RouteList />
      </Suspense>
    </div>
  );
}

async function RouteList() {
  const [{ data: routes }, { t }] = await Promise.all([apiFetch<{ data: ApprovalRoute[] }>("/approval-routes"), getI18n()]);

  if (routes.length === 0) {
    return <div className={`p-10 text-center text-muted ${card}`}>{t("approvalRoutes.empty")}</div>;
  }

  return (
    <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {routes.map((r) => (
        <li key={r.id} className={`flex flex-col gap-3 p-4 sm:p-5 ${card} ${r.is_active ? "" : "opacity-70"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{r.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                {r.branch?.name ?? t("approvalRoutes.allBranches")} · {r.department ?? t("approvalRoutes.allDepartments")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.is_active ? tone.success.badge : tone.idle.badge}`}>
                {r.is_active ? t("approvalRoutes.active") : t("approvalRoutes.inactive")}
              </span>
              <Link href={`/approval-routes/${r.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                {t("common.edit")}
              </Link>
            </div>
          </div>
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            {r.steps.map((s, i) => (
              <li key={s.step_no} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRightIcon width={14} height={14} className="text-faint" aria-hidden="true" />}
                <span className="rounded-lg bg-subtle px-2.5 py-1">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted"> · {s.approvers.map((a) => a.name).join(", ")}</span>
                </span>
              </li>
            ))}
          </ol>
          {r.users_count > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <UsersIcon width={13} height={13} />
              {t("approvalRoutes.usersCount", { count: String(r.users_count) })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
