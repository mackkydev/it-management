"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { savePolicyOptions } from "@/app/actions/policy";
import { FileTextIcon, PencilIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PolicyDisplay, SystemPolicy } from "@/lib/types";

const DISPLAYS: PolicyDisplay[] = ["after_login", "login"];

/** นโยบายการใช้งานระบบ: เปิด-ปิด + ให้ยอมรับที่หน้า login หรือหลัง login — เนื้อหาอยู่ที่เมนูนโยบายการใช้งาน */
export function PolicyOptions({ initial }: { initial: SystemPolicy }) {
  const { t, fmt } = useI18n();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [display, setDisplay] = useState<PolicyDisplay>(initial.display);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  const noContent = initial.sections.length === 0;

  const save = () =>
    start(async () => {
      setResult(await savePolicyOptions({ enabled, display }));
    });

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileTextIcon className="text-accent-500" />
            {t("settingsPage.policy.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("settingsPage.policy.optionsHint")}</p>
          <p className="mt-1 text-xs text-faint">
            {initial.version > 0 ? t("settingsPage.policy.version", { version: initial.version, date: initial.updated_at ? fmt.dateTime(initial.updated_at) : "-" }) : t("settingsPage.policy.contentEmpty")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("settingsPage.policy.enabled")}
            disabled={pending || (noContent && !enabled)}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? "bg-accent-500" : "bg-line"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          {t("settingsPage.policy.enabled")}
        </label>
      </div>

      {noContent && <p className={alert.warning}>{t("settingsPage.policy.needContent")}</p>}

      <div>
        <p className="mb-1 text-sm font-medium">{t("settingsPage.policy.display")}</p>
        <div role="radiogroup" aria-label={t("settingsPage.policy.display")} className="inline-flex gap-1 rounded-xl bg-subtle p-1">
          {DISPLAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={display === d}
              disabled={pending}
              onClick={() => setDisplay(d)}
              className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${display === d ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}
            >
              {t(`settingsPage.policy.displays.${d}`)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t(`settingsPage.policy.displayHints.${display}`)}</p>
      </div>

      {result.message && <ResultToast result={result} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/policy" className={`${btn.secondary} ${btn.sm}`}>
          <PencilIcon width={14} height={14} />
          {t("settingsPage.policy.editContent")}
        </Link>
        <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}
