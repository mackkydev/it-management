"use client";

import { useState } from "react";
import { PolicyAcceptForm } from "@/app/policy-accept/policy-accept-form";
import { CheckCircleIcon, HistoryIcon, PrinterIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { PolicyContent, PolicyFiles } from "@/components/policy-content";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OtherPolicy, PolicyPrevious, SystemPolicy } from "@/lib/types";
import { TAB_CLS } from "./policy-tabs";

/** หน้าของผู้ใช้: แท็บนโยบายล่าสุด (อ่านอย่างเดียว + ดูฉบับก่อนหน้า 1 ฉบับ) / นโยบายอื่นๆ (ชื่อรายการ + เปิดเอกสารแนบ) */
export function PolicyReader({ userId, policy, acceptedAt, previous, others }: { userId: number; policy: SystemPolicy | null; acceptedAt: string | null; previous: PolicyPrevious | null; others: OtherPolicy[] }) {
  const { t, fmt } = useI18n();
  const [tab, setTab] = useState<"latest" | "others">("latest");
  const [showPrevious, setShowPrevious] = useState(false);

  return (
    <div className="space-y-5">
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
        {(["latest", "others"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={TAB_CLS(tab === k)}>
            {t(`policyPage.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === "latest" &&
        (policy ? (
          <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{policy.title || t("policyAccept.title")}</h2>
                <p className="mt-1 text-sm text-muted">{t("policyAccept.version", { version: policy.version, date: policy.updated_at ? fmt.dateTime(policy.updated_at) : "-" })}</p>
              </div>
              <span className="flex flex-wrap gap-2">
                {previous && (
                  <button type="button" onClick={() => setShowPrevious(true)} aria-haspopup="dialog" className={`${btn.secondary} ${btn.sm}`}>
                    <HistoryIcon width={14} height={14} />
                    {t("policyPage.previous", { version: previous.version })}
                  </button>
                )}
                {acceptedAt && (
                  <a href={`/policy-print/${userId}?version=${policy.version}`} target="_blank" rel="noreferrer" className={`${btn.secondary} ${btn.sm}`}>
                    <PrinterIcon width={14} height={14} />
                    {t("policyAccept.myDocument")}
                  </a>
                )}
              </span>
            </div>
            {acceptedAt && (
              <p role="status" className={alert.success}>
                <CheckCircleIcon className="shrink-0" />
                {t("policyAccept.acceptedOn", { date: fmt.dateTime(acceptedAt) })}
              </p>
            )}
            {policy.files.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">{t("login_policy.files")}</h3>
                <PolicyFiles files={policy.files} />
              </div>
            )}
            <PolicyAcceptForm sections={policy.sections} version={policy.version} accepted />
          </section>
        ) : (
          <div className={`p-10 text-center text-muted ${card}`}>{t("policyPage.noPolicy")}</div>
        ))}

      {tab === "others" &&
        (others.length === 0 ? (
          <div className={`p-10 text-center text-muted ${card}`}>{t("policyPage.others.emptyUser")}</div>
        ) : (
          <ul className="space-y-2.5">
            {others.map((o) => (
              <li key={o.id} className={`space-y-2 p-4 ${card}`}>
                <h2 className="font-medium">{o.title}</h2>
                {o.description && <p className="whitespace-pre-line text-sm text-muted">{o.description}</p>}
                {o.files.length > 0 ? <PolicyFiles files={o.files} /> : <p className="text-xs text-faint">{t("policyPage.others.noFiles")}</p>}
              </li>
            ))}
          </ul>
        ))}

      {showPrevious && previous && (
        <ModalShell id="policy-previous" size="policy" title={previous.title || t("policyAccept.title")} subtitle={t("policyDoc.version", { version: previous.version })} onClose={() => setShowPrevious(false)}>
          <PolicyContent sections={previous.sections} files={previous.files} />
        </ModalShell>
      )}
    </div>
  );
}
