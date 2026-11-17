"use client";

import { useState } from "react";
import { DocumentLink } from "@/components/document-viewer";
import { CheckCircleIcon, HistoryIcon, PrinterIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { PolicyAttachments, PolicyContent, PolicyFileIcons, PolicySectionAccordion } from "@/components/policy-content";
import { alert, btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { sectionChanges } from "@/lib/text-diff";
import type { OtherPolicy, PolicyItem, PolicyPrevious } from "@/lib/types";
import { TAB_CLS } from "./policy-tabs";

/** นโยบายเรื่องหนึ่งที่แสดงอยู่: หัวข้อกดเปิดอ่าน (หัวข้อที่เปลี่ยนจากฉบับก่อนหน้า = NEW + สีแดง) + เอกสารแนบท้ายประกาศ */
function PolicyCard({ item, userId, onPrevious }: { item: PolicyItem; userId: number; onPrevious: (p: PolicyPrevious) => void }) {
  const { t, fmt } = useI18n();
  const changes = sectionChanges(item.sections, item.previous?.sections);
  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{item.title || t("policyAccept.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("policyAccept.version", { version: item.version, date: item.updated_at ? fmt.dateTime(item.updated_at) : "-" })}</p>
        </div>
        <span className="flex flex-wrap gap-2">
          {item.previous && (
            <button type="button" onClick={() => onPrevious(item.previous!)} aria-haspopup="dialog" className={`${btn.secondary} ${btn.sm}`}>
              <HistoryIcon width={14} height={14} />
              {t("policyPage.previous", { version: item.previous.version })}
            </button>
          )}
          {item.accepted_at && (
            <DocumentLink href={`/policy-print/${userId}?version=${item.version}`} kind="page" title={t("policyAccept.myDocument")} className={`${btn.secondary} ${btn.sm}`}>
              <PrinterIcon width={14} height={14} />
              {t("policyAccept.myDocument")}
            </DocumentLink>
          )}
        </span>
      </div>
      {item.accepted_at ? (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t("policyAccept.acceptedOn", { date: fmt.dateTime(item.accepted_at) })}
        </p>
      ) : (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("policyPage.notAcceptedYet")}</span>
      )}
      {changes.some((c) => c.status !== "same") && <p className="text-xs text-muted">{t("policyPage.changedHint")}</p>}
      <PolicySectionAccordion sections={item.sections} changes={changes} idPrefix={`policy-${item.version}`} />
      <PolicyAttachments files={item.files} />
    </section>
  );
}

/** หน้าของผู้ใช้: แท็บนโยบายที่ต้องยอมรับ (ทุกเรื่องที่แสดงอยู่ตามลำดับ + ดูฉบับก่อนหน้า) / นโยบายอื่นๆ (หัวข้อ + รายละเอียด + เอกสารแนบ) */
export function PolicyReader({ userId, items, others }: { userId: number; items: PolicyItem[]; others: OtherPolicy[] }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"latest" | "others">("latest");
  const [previous, setPrevious] = useState<PolicyPrevious | null>(null);

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
        (items.length ? (
          <div className="space-y-4">
            {items.map((item) => (
              <PolicyCard key={item.version} item={item} userId={userId} onPrevious={setPrevious} />
            ))}
          </div>
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
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 font-medium">{o.title}</h2>
                  <PolicyFileIcons files={o.files} />
                </div>
                {o.description && <p className="whitespace-pre-line text-sm text-muted">{o.description}</p>}
                {o.sections.length > 0 && <PolicySectionAccordion sections={o.sections} idPrefix={`other-${o.id}`} />}
                {o.sections.length > 0 && <PolicyAttachments files={o.files} />}
              </li>
            ))}
          </ul>
        ))}

      {previous && (
        <ModalShell id="policy-previous" size="policy" title={previous.title || t("policyAccept.title")} subtitle={t("policyDoc.version", { version: previous.version })} onClose={() => setPrevious(null)}>
          <PolicyContent sections={previous.sections} files={previous.files} />
        </ModalShell>
      )}
    </div>
  );
}
