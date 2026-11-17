"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { deletePolicyVersion, duplicatePolicyVersion, hidePolicyGroup, savePolicyOrder, setDefaultPolicyVersion } from "@/app/actions/policy";
import { DocumentLink } from "@/components/document-viewer";
import { useConfirm } from "@/components/dialog-provider";
import { ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, ChevronDownIcon, CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, PrinterIcon, SpinnerIcon, TrashIcon, UsersIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { PolicyContent } from "@/components/policy-content";
import { ResultToast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OtherPolicy, PolicyGroup, PolicySection, PolicyVersion } from "@/lib/types";
import { OtherPoliciesManager } from "./other-policies-manager";
import { TAB_CLS } from "./policy-tabs";

type Result = { ok?: boolean; message?: string; errors?: Partial<Record<string, string>> };

/** เรื่องหนึ่ง + ทุกฉบับของเรื่องนั้น (ใหม่ → เก่า) */
interface GroupView extends PolicyGroup {
  versions: PolicyVersion[];
  current: PolicyVersion | null;
  title: string;
}

/** ฉบับที่ประกาศใช้ก่อนหน้าฉบับนี้ในเรื่องเดียวกัน — ไว้ทำสีส่วนที่เปลี่ยนตอนดูตัวอย่าง */
const previousOf = (g: GroupView, v: PolicyVersion): PolicySection[] | null => g.versions.find((x) => x.version < v.version && x.published_at)?.sections ?? null;

/** หน้าผู้จัดการ: แท็บรายการนโยบายที่ต้องยอมรับ (แยกเป็นเรื่อง กดขยายดูแต่ละฉบับ + ลำดับที่ให้ยอมรับ) / นโยบายอื่นๆ — canEdit = ไม่ใช่ผู้ตรวจสอบแบบอ่านอย่างเดียว */
export function PolicyManager({
  versions,
  groups,
  enabled,
  others,
  canEdit,
  canOpenSettings,
}: {
  versions: PolicyVersion[];
  groups: PolicyGroup[];
  enabled: boolean;
  others: OtherPolicy[];
  canEdit: boolean;
  canOpenSettings: boolean;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"versions" | "others">("versions");
  const [preview, setPreview] = useState<{ version: PolicyVersion; previous: PolicySection[] | null } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(groups.length === 1 ? [groups[0].id] : []));
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const views = useMemo<GroupView[]>(
    () =>
      groups.map((g) => {
        const list = versions.filter((v) => v.group_id === g.id).sort((a, b) => b.version - a.version);
        const current = list.find((v) => v.version === g.current_version) ?? null;
        return { ...g, versions: list, current, title: (current ?? list[0])?.title ?? "" };
      }),
    [groups, versions],
  );
  // ลำดับที่ผู้ใช้เห็น = เฉพาะเรื่องที่แสดงอยู่
  const shownOrder = views.filter((g) => g.current).map((g) => g.id);

  /** แสดงข้อผิดพลาดจาก API (เช่น ลบไม่ได้) เป็น toast — ข้อความอยู่ใน errors ถ้าเป็น validation */
  const run = (key: string, action: () => Promise<Result>) => {
    setBusy(key);
    start(async () => {
      const res = await action();
      setBusy(null);
      setResult(res.ok ? res : { ok: false, message: Object.values(res.errors ?? {})[0] ?? res.message });
    });
  };

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (index: number, d: -1 | 1) => {
    const ids = views.map((g) => g.id);
    [ids[index], ids[index + d]] = [ids[index + d], ids[index]];
    run(`order-${views[index].id}`, () => savePolicyOrder(ids));
  };

  const setDefault = async (v: PolicyVersion) => {
    if (!(await confirm(t("policyPage.setDefaultConfirm", { version: v.version }), { danger: false }))) return;
    run(`default-${v.version}`, () => setDefaultPolicyVersion(v.version));
  };

  const hide = async (g: GroupView) => {
    if (!(await confirm(t("policyPage.hideConfirm", { title: g.title }), { danger: false }))) return;
    run(`hide-${g.id}`, () => hidePolicyGroup(g.id));
  };

  const remove = async (v: PolicyVersion) => {
    if (!(await confirm(t("policyPage.deleteConfirm", { version: v.version, title: v.title }), { danger: true }))) return;
    run(`delete-${v.version}`, () => deletePolicyVersion(v.version));
  };

  const deleteBlocked = (v: PolicyVersion) => (v.is_default ? t("policyPage.cantDeleteDefault") : v.locked ? t("policyPage.cantDeleteAccepted") : null);

  const versionRow = (g: GroupView, v: PolicyVersion) => {
    const blocked = deleteBlocked(v);
    return (
      <li key={v.version} className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-3 overflow-hidden rounded-xl bg-subtle p-3 pl-4 ring-1 ring-line">
        <span className={`absolute inset-y-0 left-0 w-1 ${v.is_default ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
        <div className="min-w-64 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium tabular-nums ring-1 ring-line">{t("policyDoc.version", { version: v.version })}</span>
            <h3 className="min-w-0 font-medium">{v.title || t("policyAccept.title")}</h3>
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
            <button type="button" onClick={() => setPreview({ version: v, previous: previousOf(g, v) })} aria-haspopup="dialog" aria-label={t("policyPage.preview")} className={`${btn.secondary} ${btn.icon}`}>
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
  };

  return (
    <div className="space-y-5">
      {result.message && <ResultToast result={result} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
          {(["versions", "others"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={TAB_CLS(tab === k)}>
              {t(`policyPage.tabs.${k}`)}
              <span className="rounded-full bg-line/70 px-1.5 text-xs tabular-nums text-muted">{(k === "versions" ? views : others).length}</span>
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
                  <Link href="/settings?tab=policy" className="font-medium underline hover:no-underline">
                    {t("policyPage.openSettings")}
                  </Link>
                </>
              )}
            </p>
          )}
          {views.length > 1 && <p className="text-xs text-muted">{t("policyPage.orderHint")}</p>}
          {views.length === 0 ? (
            <div className={`p-10 text-center text-muted ${card}`}>{t("policyPage.empty")}</div>
          ) : (
            <ul className="space-y-2.5">
              {views.map((g, index) => {
                const open = expanded.has(g.id);
                const position = shownOrder.indexOf(g.id);
                return (
                  <li key={g.id} className={`relative overflow-hidden ${card}`}>
                    <span className={`absolute inset-y-0 left-0 w-1 ${g.current ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4 pl-5">
                      <button type="button" onClick={() => toggle(g.id)} aria-expanded={open} aria-controls={`policy-group-${g.id}`} className="flex min-w-64 flex-1 cursor-pointer items-center gap-3 text-left">
                        <ChevronDownIcon width={18} height={18} className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                        {position >= 0 && (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-semibold tabular-nums text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">{position + 1}</span>
                        )}
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 font-semibold">{g.title || t("policyAccept.title")}</span>
                            {g.current ? (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.success.badge}`}>
                                {t("policyPage.groupShown", { version: g.current.version })}
                                <CheckCircleIcon width={13} height={13} aria-hidden="true" />
                              </span>
                            ) : (
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("policyPage.groupHiddenBadge")}</span>
                            )}
                          </span>
                          <span className="block text-xs text-muted">
                            {[
                              t("policyPage.versionCount", { count: fmt.number(g.versions.length) }),
                              g.current ? t("policyPage.acceptedCount", { count: fmt.number(g.current.accepted) }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </button>
                      {canEdit && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Tooltip label={t("policyPage.moveUp")}>
                            <button type="button" onClick={() => move(index, -1)} disabled={pending || index === 0} aria-label={t("policyPage.moveUp")} className={`${btn.secondary} ${btn.icon} disabled:cursor-not-allowed disabled:opacity-40`}>
                              {busy === `order-${g.id}` ? <SpinnerIcon width={15} height={15} /> : <ArrowUpIcon width={15} height={15} />}
                            </button>
                          </Tooltip>
                          <Tooltip label={t("policyPage.moveDown")}>
                            <button type="button" onClick={() => move(index, 1)} disabled={pending || index === views.length - 1} aria-label={t("policyPage.moveDown")} className={`${btn.secondary} ${btn.icon} disabled:cursor-not-allowed disabled:opacity-40`}>
                              <ArrowDownIcon width={15} height={15} />
                            </button>
                          </Tooltip>
                          {g.current && (
                            <Tooltip label={t("policyPage.hide")}>
                              <button type="button" onClick={() => hide(g)} disabled={pending} aria-label={t("policyPage.hide")} className={`${btn.secondary} ${btn.icon} disabled:cursor-not-allowed`}>
                                {busy === `hide-${g.id}` ? <SpinnerIcon width={15} height={15} /> : <EyeOffIcon width={15} height={15} />}
                              </button>
                            </Tooltip>
                          )}
                        </span>
                      )}
                    </div>
                    {open && (
                      <ul id={`policy-group-${g.id}`} className="space-y-2 border-t border-line p-3 sm:pl-12">
                        {g.versions.map((v) => versionRow(g, v))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === "others" && <OtherPoliciesManager items={others} canEdit={canEdit} />}

      {preview && (
        <ModalShell id="policy-preview" size="policy" title={preview.version.title || t("policyAccept.title")} subtitle={t("policyDoc.version", { version: preview.version.version })} onClose={() => setPreview(null)}>
          <PolicyContent sections={preview.version.sections} files={preview.version.files} previous={preview.previous} />
        </ModalShell>
      )}
    </div>
  );
}
