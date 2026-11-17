"use client";

import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PolicySection } from "@/lib/types";

/**
 * แก้หัวข้อ + รายละเอียดของนโยบาย (เพิ่ม / เลื่อนขึ้นลง / ลบ) — ใช้ทั้งนโยบายที่ต้องยอมรับและนโยบายอื่นๆ
 * errors ใช้ key แบบ API: sections.{i}.title / sections.{i}.body / sections, locked = ดูอย่างเดียว (ไม่มีปุ่มเพิ่ม), disabled = ระหว่างบันทึก, actions = ปุ่มเพิ่มเติมต่อท้ายปุ่มเพิ่มหัวข้อ
 */
export function PolicySectionsEditor({
  sections,
  onChange,
  errors,
  onClearError,
  locked = false,
  disabled = false,
  actions,
}: {
  sections: PolicySection[];
  onChange: (next: PolicySection[] | ((prev: PolicySection[]) => PolicySection[])) => void;
  errors: Record<string, string>;
  onClearError: (key: string) => void;
  locked?: boolean;
  /** ระหว่างบันทึก */
  disabled?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const patch = (i: number, v: Partial<PolicySection>) => onChange((s) => s.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const move = (i: number, d: -1 | 1) =>
    onChange((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);

  return (
    <fieldset disabled={locked || disabled} className="space-y-3 disabled:opacity-60">
      <legend className="mb-2 text-sm font-medium">{t("settingsPage.policy.sections")}</legend>
      {sections.length === 0 && <p className="text-sm text-muted">{t("settingsPage.policy.empty")}</p>}
      {sections.map((s, i) => (
        <div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-line">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted">{t("settingsPage.policy.sectionTitle", { n: i + 1 })}</span>
            <span className="flex-1" />
            <Tooltip label={t("settingsPage.policy.moveUp")}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("settingsPage.policy.moveUp")} className={`${btn.secondary} ${btn.sm} h-8 px-2`}>
                <ArrowUpIcon width={14} height={14} />
              </button>
            </Tooltip>
            <Tooltip label={t("settingsPage.policy.moveDown")}>
              <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label={t("settingsPage.policy.moveDown")} className={`${btn.secondary} ${btn.sm} h-8 px-2`}>
                <ArrowDownIcon width={14} height={14} />
              </button>
            </Tooltip>
            <Tooltip label={t("settingsPage.policy.remove")}>
              <button type="button" onClick={() => onChange((x) => x.filter((_, j) => j !== i))} aria-label={t("settingsPage.policy.remove")} className={`${btn.danger} ${btn.sm} h-8 px-2`}>
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
                onClearError(`sections.${i}.title`);
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
                onClearError(`sections.${i}.body`);
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
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onChange((x) => [...x, { title: "", body: "" }]);
              onClearError("sections");
            }}
            className={`${btn.secondary} ${btn.sm}`}
          >
            <PlusIcon width={14} height={14} />
            {t("settingsPage.policy.add")}
          </button>
          {actions}
        </div>
      )}
    </fieldset>
  );
}

/** ตรวจหัวข้อก่อนส่ง (ข้อความเดียวกับ API) — คืน errors ตาม key ของ API */
export function sectionErrors(sections: PolicySection[], t: (key: "settingsPage.policy.validate.title" | "settingsPage.policy.validate.body") => string): Record<string, string> {
  const e: Record<string, string> = {};
  sections.forEach((s, i) => {
    if (!s.title.trim()) e[`sections.${i}.title`] = t("settingsPage.policy.validate.title");
    if (!s.body.trim()) e[`sections.${i}.body`] = t("settingsPage.policy.validate.body");
  });
  return e;
}
