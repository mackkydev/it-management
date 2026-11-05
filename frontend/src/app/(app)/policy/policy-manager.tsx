"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deletePolicyVersion, duplicatePolicyVersion, setDefaultPolicyVersion } from "@/app/actions/policy";
import { DocumentLink } from "@/components/document-viewer";
import { useConfirm } from "@/components/dialog-provider";
import { CheckCircleIcon, CopyIcon, EyeIcon, PencilIcon, PlusIcon, PrinterIcon, SpinnerIcon, TrashIcon, UsersIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { PolicyContent } from "@/components/policy-content";
import { ResultToast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OtherPolicy, PolicyVersion } from "@/lib/types";
import { OtherPoliciesManager } from "./other-policies-manager";
import { TAB_CLS } from "./policy-tabs";

/** หน้าผู้จัดการ: แท็บรายการนโยบาย (แต่ละฉบับ) / นโยบายอื่นๆ — canEdit = ไม่ใช่ผู้ตรวจสอบแบบอ่านอย่างเดียว */
export function PolicyManager({ versions, enabled, others, canEdit, canOpenSettings }: { versions: PolicyVersion[]; enabled: boolean; others: OtherPolicy[]; canEdit: boolean; canOpenSettings: boolean }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"versions" | "others">("versions");
  const [preview, setPreview] = useState<PolicyVersion | null>(null);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** แสดงข้อผิดพลาดจาก API (เช่น ลบไม่ได้) เป็น toast — ข้อความอยู่ใน errors ถ้าเป็น validation */
  const run = (key: string, action: () => Promise<{ ok?: boolean; message?: string; errors?: Partial<Record<string, string>> }>) => {
    setBusy(key);
    start(async () => {
      const res = await action();
      setBusy(null);
      setResult(res.ok ? res : { ok: false, message: Object.values(res.errors ?? {})[0] ?? res.message });
    });
  };

  const setDefault = async (v: PolicyVersion) => {
    if (!(await confirm(t("policyPage.setDefaultConfirm", { version: v.version }), { danger: false }))) return;
    run(`default-${v.version}`, () => setDefaultPolicyVersion(v.version));
  };

  const remove = async (v: PolicyVersion) => {
    if (!(await confirm(t("policyPage.deleteConfirm", { version: v.version, title: v.title }), { danger: true }))) return;
    run(`delete-${v.version}`, () => deletePolicyVersion(v.version));
  };

  const deleteBlocked = (v: PolicyVersion) => (v.is_default ? t("policyPage.cantDeleteDefault") : v.locked ? t("policyPage.cantDeleteAccepted") : null);

  return (
    <div className="space-y-5">
      {result.message && <ResultToast result={result} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
          {(["versions", "others"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={TAB_CLS(tab === k)}>
              {t(`policyPage.tabs.${k}`)}
              <span className="rounded-full bg-line/70 px-1.5 text-xs tabular-nums text-muted">{(k === "versions" ? versions : others).length}</span>
            </button>
          ))}
        </div>
        {tab === "versions" && (
          <span className="flex flex-wrap gap-2">
            <DocumentLink href="/policy-print/blank" kind="page" title={t("settingsPage.policy.printDoc")} className={btn.secondary}>
              <PrinterIcon />
              {t("settingsPage.policy.printDoc")}
            </DocumentLink>
            {canEdit && (
              <Link href="/policy/versions/new" className={btn.primary}>
                <PlusIcon />
                {t("policyPage.add")}
              </Link>
            )}
          </span>
        )}
      </div>

      {tab === "versions" && (
        <>
          {!enabled && versions.length > 0 && (
            <p className={alert.warning}>
              {t("policyPage.disabledHint")}
              {canOpenSettings && (
                <>
                  {" "}
                  <Link href="/settings" className="font-medium underline hover:no-underline">
                    {t("policyPage.openSettings")}
                  </Link>
                </>
              )}
            </p>
          )}
          {versions.length === 0 ? (
            <div className={`p-10 text-center text-muted ${card}`}>{t("policyPage.empty")}</div>
          ) : (
            <ul className="space-y-2.5">
              {versions.map((v) => {
                const blocked = deleteBlocked(v);
                return (
                  <li key={v.version} className={`relative flex flex-wrap items-center justify-between gap-x-4 gap-y-3 overflow-hidden p-4 pl-5 ${card}`}>
                    <span className={`absolute inset-y-0 left-0 w-1 ${v.is_default ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
                    <div className="min-w-64 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs font-medium tabular-nums">{t("policyDoc.version", { version: v.version })}</span>
                        <h2 className="min-w-0 font-semibold">{v.title || t("policyAccept.title")}</h2>
                        {v.is_default ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.success.badge}`}>
                            {t("policyPage.default")}
                            <CheckCircleIcon width={13} height={13} aria-hidden="true" />
                          </span>
                        ) : (
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${v.published_at ? tone.info.badge : tone.idle.badge}`}>{t(v.published_at ? "policyPage.published" : "policyPage.draft")}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        {[
                          t("policyPage.acceptedCount", { count: fmt.number(v.accepted) }),
                          t("policyPage.sectionCount", { count: fmt.number(v.sections.length) }),
                          t("policyPage.fileCount", { count: fmt.number(v.files.length) }),
                          v.updated_at ? t("policyPage.updated", { date: fmt.dateTime(v.updated_at) }) : null,
                          v.created_by,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {canEdit && !v.is_default && (
                        <Tooltip label={t("policyPage.setDefault")}>
                          <button type="button" onClick={() => setDefault(v)} disabled={pending} aria-label={t("policyPage.setDefault")} className={`${btn.soft} ${btn.icon} disabled:cursor-not-allowed`}>
                            {busy === `default-${v.version}` ? <SpinnerIcon width={15} height={15} /> : <CheckCircleIcon width={15} height={15} />}
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label={t("policyPage.preview")}>
                        <button type="button" onClick={() => setPreview(v)} aria-haspopup="dialog" aria-label={t("policyPage.preview")} className={`${btn.secondary} ${btn.icon}`}>
                          <EyeIcon width={15} height={15} />
                        </button>
                      </Tooltip>
                      {canEdit && (
                        <>
                          <Tooltip label={t("common.edit")}>
                            <Link href={`/policy/versions/${v.version}/edit`} aria-label={t("common.edit")} className={`${btn.secondary} ${btn.icon}`}>
                              <PencilIcon width={15} height={15} />
                            </Link>
                          </Tooltip>
                          <Tooltip label={t("policyPage.duplicate")}>
                            <button type="button" onClick={() => run(`duplicate-${v.version}`, () => duplicatePolicyVersion(v.version))} disabled={pending} aria-label={t("policyPage.duplicate")} className={`${btn.secondary} ${btn.icon} disabled:cursor-not-allowed`}>
                              {busy === `duplicate-${v.version}` ? <SpinnerIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
                            </button>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip label={t("policyPage.acceptances")}>
                        <Link href={`/policy/versions/${v.version}/acceptances`} aria-label={t("policyPage.acceptances")} className={`${btn.secondary} ${btn.icon}`}>
                          <UsersIcon width={15} height={15} />
                        </Link>
                      </Tooltip>
                      <Tooltip label={t("policyPage.printList")}>
                        <DocumentLink href={`/policy-print/acceptances/${v.version}`} kind="page" title={t("policyPage.printList")} aria-label={t("policyPage.printList")} className={`${btn.secondary} ${btn.icon}`}>
                          <PrinterIcon width={15} height={15} />
                        </DocumentLink>
                      </Tooltip>
                      {canEdit && (
                        <Tooltip label={blocked ?? t("common.delete")}>
                          <button type="button" onClick={() => remove(v)} disabled={pending || Boolean(blocked)} aria-label={t("common.delete")} className={`${btn.danger} ${btn.icon} disabled:cursor-not-allowed disabled:opacity-50`}>
                            {busy === `delete-${v.version}` ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === "others" && <OtherPoliciesManager items={others} canEdit={canEdit} />}

      {preview && (
        <ModalShell id="policy-preview" size="policy" title={preview.title || t("policyAccept.title")} subtitle={t("policyDoc.version", { version: preview.version })} onClose={() => setPreview(null)}>
          <PolicyContent sections={preview.sections} files={preview.files} />
        </ModalShell>
      )}
    </div>
  );
}
