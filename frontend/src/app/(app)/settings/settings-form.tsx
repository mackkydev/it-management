"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { AlertIcon, CheckCircleIcon, PlusIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AppSettings } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** รายการแบบ chip: พิมพ์แล้วกด Enter/ปุ่มเพิ่ม, กด × เพื่อลบ */
function ChipList({
  items,
  onChange,
  placeholder,
  addLabel,
  validate,
  emptyText,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  addLabel: string;
  validate: (v: string) => string | null;
  emptyText?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const err = validate(v);
    if (err) return setError(err);
    onChange([...items, v]);
    setDraft("");
    setError("");
  };

  return (
    <div>
      <div className="mb-2 flex min-h-9 flex-wrap gap-1.5">
        {items.length === 0 && emptyText && <span className="text-sm text-muted">{emptyText}</span>}
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 rounded-full bg-accent-100 py-1 pl-3 pr-1 text-sm text-accent-900 dark:bg-accent-400/15 dark:text-accent-100">
            {it}
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== it))}
              aria-label={`× ${it}`}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent-200 dark:hover:bg-accent-400/30"
            >
              <XIcon width={12} height={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => (setDraft(e.target.value), setError(""))}
          onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), add())}
          className={`${input} ${error ? inputError : ""}`}
        />
        <button type="button" onClick={add} className={`${btn.secondary} shrink-0`}>
          <PlusIcon width={14} height={14} className="text-accent-500" />
          {addLabel}
        </button>
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const { t } = useI18n();
  const [v, setV] = useState<AppSettings>(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await saveSettings(v);
      const firstError = res.errors ? Object.values(res.errors)[0] : undefined;
      setFeedback({ ok: Boolean(res.ok), text: firstError ?? res.message ?? "" });
    });

  const days = (key: "contract_notify_days" | "credential_notify_days", label: string, hint?: string) => (
    <div>
      <label htmlFor={key} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={key}
        type="number"
        min={1}
        max={365}
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
        className={`${input} max-w-40`}
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      {feedback?.text && (
        <div role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </div>
      )}

      <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("settingsPage.expirySection")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {days("contract_notify_days", t("settingsPage.contractDays"), t("settingsPage.contractDaysHint"))}
            {days("credential_notify_days", t("settingsPage.credentialDays"))}
          </div>
        </section>

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-1 font-semibold">{t("settingsPage.emailsSection")}</h2>
          <p className="mb-3 text-sm text-muted">{t("settingsPage.emailsHint")}</p>
          <ChipList
            items={v.notify_emails}
            onChange={(notify_emails) => setV({ ...v, notify_emails })}
            placeholder={t("settingsPage.emailPlaceholder")}
            addLabel={t("settingsPage.addEmail")}
            emptyText={t("settingsPage.noEmails")}
            validate={(e) =>
              !EMAIL_RE.test(e)
                ? t("settingsPage.invalidEmail")
                : v.notify_emails.some((x) => x.toLowerCase() === e.toLowerCase())
                  ? t("settingsPage.duplicateEmail")
                  : null
            }
          />
        </section>

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-1 font-semibold">{t("settingsPage.otherTypesSection")}</h2>
          <p className="mb-3 text-sm text-muted">{t("settingsPage.otherTypesHint")}</p>
          <ChipList
            items={v.ticket_other_types}
            onChange={(ticket_other_types) => setV({ ...v, ticket_other_types })}
            placeholder={t("settingsPage.otherTypePlaceholder")}
            addLabel={t("settingsPage.addOtherType")}
            validate={(o) => (v.ticket_other_types.includes(o) ? t("settingsPage.duplicateEmail") : null)}
          />
        </section>
      </fieldset>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
