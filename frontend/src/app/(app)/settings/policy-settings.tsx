"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { savePolicy } from "@/app/actions/policy";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, ExternalLinkIcon, FileTextIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PolicyAcceptance, PolicySection, SystemPolicy } from "@/lib/types";

type Filter = "all" | "accepted" | "pending";

/**
 * นโยบายการใช้งานระบบที่ผู้ใช้ต้องยอมรับก่อนใช้งาน (app_settings.system_policy — settings.manage)
 * แก้หัวข้อ/เนื้อหา, เปิด-ปิด, ให้ทุกคนยอมรับใหม่ (ฉบับใหม่) + รายชื่อผู้ใช้พร้อมวันที่ยอมรับฉบับปัจจุบัน
 */
export function PolicySettings({ initial, acceptances }: { initial: SystemPolicy; acceptances: { data: PolicyAcceptance[]; accepted: number; total: number } }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [sections, setSections] = useState<PolicySection[]>(initial.sections);
  const [reaccept, setReaccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [showList, setShowList] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, start] = useTransition();

  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  const patch = (i: number, v: Partial<PolicySection>) => setSections((s) => s.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSections((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const save = async () => {
    const e: Record<string, string> = {};
    sections.forEach((s, i) => {
      if (!s.title.trim()) e[`sections.${i}.title`] = t("settingsPage.policy.validate.title");
      if (!s.body.trim()) e[`sections.${i}.body`] = t("settingsPage.policy.validate.body");
    });
    if (enabled && !sections.length) e.sections = t("settingsPage.policy.validate.sections");
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    if (reaccept && !(await confirm(t("settingsPage.policy.reacceptConfirm"), { danger: false }))) return;
    start(async () => {
      const res = await savePolicy({ enabled, reaccept, sections });
      setResult(res);
      if (res.errors) setErrors(Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k, v ?? ""])));
      if (res.ok) setReaccept(false);
    });
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const rows = acceptances.data.filter((r) => (filter === "all" ? true : filter === "accepted" ? r.accepted_at : !r.accepted_at));

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileTextIcon className="text-accent-500" />
            {t("settingsPage.policy.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("settingsPage.policy.hint")}</p>
          <p className="mt-1 text-xs text-faint">
            {initial.version > 0 ? t("settingsPage.policy.version", { version: initial.version, date: initial.updated_at ? fmt.dateTime(initial.updated_at) : "-" }) : t("settingsPage.policy.notSaved")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("settingsPage.policy.enabled")}
            disabled={pending}
            onClick={() => {
              setEnabled((v) => !v);
              clearErr("sections");
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? "bg-accent-500" : "bg-line"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          {t("settingsPage.policy.enabled")}
        </label>
      </div>

      {/* หัวข้อนโยบาย */}
      <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-medium">{t("settingsPage.policy.sections")}</legend>
        {sections.length === 0 && <p className="text-sm text-muted">{t("settingsPage.policy.empty")}</p>}
        {sections.map((s, i) => (
          <div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-line">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">{t("settingsPage.policy.sectionTitle", { n: i + 1 })}</span>
              <span className="flex-1" />
              <Tooltip label={t("settingsPage.policy.moveUp")} side="top">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("settingsPage.policy.moveUp")} className={`${btn.secondary} ${btn.sm} h-8 px-2`}>
                  <ArrowUpIcon width={14} height={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("settingsPage.policy.moveDown")} side="top">
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === sections.length - 1}
                  aria-label={t("settingsPage.policy.moveDown")}
                  className={`${btn.secondary} ${btn.sm} h-8 px-2`}
                >
                  <ArrowDownIcon width={14} height={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("settingsPage.policy.remove")} side="top">
                <button
                  type="button"
                  onClick={() => setSections((x) => x.filter((_, j) => j !== i))}
                  aria-label={t("settingsPage.policy.remove")}
                  className={`${btn.danger} ${btn.sm} h-8 px-2`}
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </Tooltip>
            </div>
            <div>
              <input
                value={s.title}
                maxLength={200}
                onChange={(e) => {
                  patch(i, { title: e.target.value });
                  clearErr(`sections.${i}.title`);
                }}
                aria-label={t("settingsPage.policy.sectionTitle", { n: i + 1 })}
                className={`${input} font-medium ${errors[`sections.${i}.title`] ? inputError : ""}`}
              />
              {err(`sections.${i}.title`)}
            </div>
            <div>
              <textarea
                value={s.body}
                rows={5}
                maxLength={20000}
                onChange={(e) => {
                  patch(i, { body: e.target.value });
                  clearErr(`sections.${i}.body`);
                }}
                aria-label={t("settingsPage.policy.sectionBody")}
                placeholder={t("settingsPage.policy.sectionBody")}
                className={`${input} ${errors[`sections.${i}.body`] ? inputError : ""}`}
              />
              {err(`sections.${i}.body`)}
            </div>
          </div>
        ))}
        {err("sections")}
        <button
          type="button"
          onClick={() => {
            setSections((x) => [...x, { title: "", body: "" }]);
            clearErr("sections");
          }}
          className={`${btn.secondary} ${btn.sm}`}
        >
          <PlusIcon width={14} height={14} />
          {t("settingsPage.policy.add")}
        </button>
      </fieldset>

      {initial.version > 0 && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={reaccept} onChange={(e) => setReaccept(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          {t("settingsPage.policy.reaccept")}
        </label>
      )}

      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
          {result.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {initial.version > 0 && initial.enabled && (
          <Link href="/policy-accept" className={`${btn.secondary} ${btn.sm}`}>
            <ExternalLinkIcon width={14} height={14} />
            {t("settingsPage.policy.preview")}
          </Link>
        )}
        <button type="button" onClick={save} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
          {t("settingsPage.policy.save")}
        </button>
      </div>

      {/* รายชื่อผู้ใช้ + วันที่ยอมรับฉบับปัจจุบัน */}
      {initial.version > 0 && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("settingsPage.policy.accepted", { accepted: acceptances.accepted, total: acceptances.total })}</p>
            <button type="button" onClick={() => setShowList((v) => !v)} aria-expanded={showList} className={`${btn.secondary} ${btn.sm}`}>
              {t(showList ? "settingsPage.policy.hideList" : "settingsPage.policy.showList")}
            </button>
          </div>
          {showList && (
            <>
              <div className="flex flex-wrap gap-1" role="tablist">
                {(["all", "accepted", "pending"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300" : "text-muted hover:bg-subtle"}`}
                  >
                    {t(f === "all" ? "settingsPage.policy.filterAll" : f === "accepted" ? "settingsPage.policy.filterAccepted" : "settingsPage.policy.filterPending")}
                  </button>
                ))}
              </div>
              <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
                {rows.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">{t("settingsPage.policy.noRows")}</li>}
                {rows.map((r) => (
                  <li key={r.user.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{r.user.name}</span>
                      <span className="block text-xs text-muted">{[r.user.email, r.user.branch].filter(Boolean).join(" · ") || "-"}</span>
                    </span>
                    {r.accepted_at ? (
                      <span className="flex items-center gap-1 text-xs text-success-700 dark:text-success-300">
                        <CheckCircleIcon width={14} height={14} />
                        {t("settingsPage.policy.acceptedAt", { date: fmt.dateTime(r.accepted_at) })}
                      </span>
                    ) : (
                      <span className="text-xs text-warning-700 dark:text-warning-300">{t("settingsPage.policy.pending")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
