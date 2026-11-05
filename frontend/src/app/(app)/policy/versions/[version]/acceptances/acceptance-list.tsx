"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircleIcon, ChevronLeftIcon, PrinterIcon } from "@/components/icons";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PolicyAcceptanceList } from "@/lib/types";

type Filter = "accepted" | "pending" | "all";

/** ค่าตั้งต้นเห็นเฉพาะคนที่ยอมรับแล้ว, เลือกดูคนที่ยังไม่ยอมรับได้ */
export function AcceptanceList({ list }: { list: PolicyAcceptanceList }) {
  const { t, fmt } = useI18n();
  const [filter, setFilter] = useState<Filter>("accepted");
  const rows = list.data.filter((r) => (filter === "all" ? true : filter === "accepted" ? r.accepted_at : !r.accepted_at));
  const label = { all: "settingsPage.policy.filterAll", accepted: "settingsPage.policy.filterAccepted", pending: "settingsPage.policy.filterPending" } as const;

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("settingsPage.policy.accepted", { accepted: fmt.number(list.accepted), total: fmt.number(list.total) })}</p>
        <span className="flex flex-wrap gap-2">
          <Link href="/policy" className={`${btn.secondary} ${btn.sm}`}>
            <ChevronLeftIcon width={14} height={14} />
            {t("policyPage.back")}
          </Link>
          <a href={`/policy-print/acceptances/${list.version}`} target="_blank" rel="noreferrer" className={`${btn.primary} ${btn.sm}`}>
            <PrinterIcon width={14} height={14} />
            {t("policyPage.printList")}
          </a>
        </span>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {(["accepted", "pending", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300" : "text-muted hover:bg-subtle"}`}
          >
            {t(label[f])}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
        {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t("settingsPage.policy.noRows")}</li>}
        {rows.map((r) => (
          <li key={r.user.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{r.name_stamp ?? r.user.name}</span>
              <span className="block text-xs text-muted">{[r.user.job_title, r.user.department, r.user.branch].filter(Boolean).join(" · ") || r.user.email || "-"}</span>
            </span>
            {r.accepted_at ? (
              <a href={`/policy-print/${r.user.id}?version=${list.version}`} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center gap-1 text-xs text-success-700 hover:underline dark:text-success-300">
                <CheckCircleIcon width={14} height={14} />
                {t("settingsPage.policy.acceptedAt", { date: fmt.dateTime(r.accepted_at) })}
              </a>
            ) : (
              <span className="text-xs text-warning-700 dark:text-warning-300">{t("settingsPage.policy.pending")}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
