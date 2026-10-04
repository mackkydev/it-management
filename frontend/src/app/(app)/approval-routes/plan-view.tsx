"use client";

import { ChevronRightIcon } from "@/components/icons";
import { tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ApprovalPlan } from "@/lib/types";

/** แสดงแผนอนุมัติแบบสั้น: ขั้น 1 (ผู้อนุมัติ) → ขั้น 2 … หรือ "หัวหน้าตามสายบังคับบัญชา" (ระบบเดิม) */
export function PlanView({ plan, showSource = false }: { plan: ApprovalPlan; showSource?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {showSource && (
        <p className="text-sm">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${plan.source === "legacy" ? tone.idle.badge : tone.info.badge}`}>
            {t(`approvalRoutes.sources.${plan.source}`)}
          </span>
          {plan.route && <span className="ml-2 font-medium">{plan.route.name}</span>}
        </p>
      )}
      {plan.source === "legacy" ? (
        <p className="text-sm text-muted">
          {plan.legacy_approver ? t("approvalRoutes.legacyApprover", { name: plan.legacy_approver.name }) : t("approvalRoutes.legacyAdmin")}
        </p>
      ) : (
        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
          {plan.steps.map((s, i) => (
            <li key={s.step_no} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRightIcon width={14} height={14} className="text-faint" aria-hidden="true" />}
              <span className={`rounded-lg px-2.5 py-1 ring-1 ring-line ${s.skipped ? "text-faint line-through" : "bg-surface"}`}>
                <span className="font-medium">{s.name}</span>
                {!s.skipped && <span className="text-muted"> · {s.approvers.map((a) => a.name).join(", ")}</span>}
                {s.skipped && <span className="ml-1 text-xs no-underline">({t("approvalRoutes.skipped")})</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
