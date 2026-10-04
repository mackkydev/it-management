"use client";

import { useState, useTransition } from "react";
import { resolveApprovalPlan } from "@/app/actions/approval-routes";
import { SearchIcon, SpinnerIcon } from "@/components/icons";
import { card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ApprovalPlan, UserOption } from "@/lib/types";
import { CustodianPicker } from "../assets/custodian-picker";
import { PlanView } from "./plan-view";

/** ทดสอบสายอนุมัติ: เลือกผู้ใช้ → แสดงสายที่จะใช้และเหตุผล */
export function PlanTester() {
  const { t } = useI18n();
  const [user, setUser] = useState<UserOption | null>(null);
  const [plan, setPlan] = useState<ApprovalPlan | null>(null);
  const [pending, start] = useTransition();

  const pick = (u: UserOption | null) => {
    setUser(u);
    setPlan(null);
    if (u) start(async () => setPlan(await resolveApprovalPlan(u.id)));
  };

  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <SearchIcon width={16} height={16} className="text-accent-500" />
        {t("approvalRoutes.tester.title")}
      </h2>
      <p className="mb-3 mt-1 text-sm text-muted">{t("approvalRoutes.tester.hint")}</p>
      <div className="max-w-md">
        <CustodianPicker id="plan-tester-user" value={user} onChange={pick} className={input} />
      </div>
      {pending && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-accent-600 dark:text-accent-300">
          <SpinnerIcon width={14} height={14} />
          {t("common.loading")}
        </p>
      )}
      {plan && (
        <div className="mt-4">
          <PlanView plan={plan} showSource />
        </div>
      )}
    </section>
  );
}
