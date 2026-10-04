"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { ChipList } from "@/components/chip-list";
import { AlertIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AppSettings } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const { t } = useI18n();
  const [v, setV] = useState<AppSettings>(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      // ส่งเฉพาะค่าของหน้านี้ — ตัวเลือก "อื่นๆ" / สิทธิ์การใช้งาน แก้ที่หน้าของตัวเอง ไม่เขียนทับด้วยค่าเก่า
      const res = await saveSettings({
        contract_notify_days: v.contract_notify_days,
        credential_notify_days: v.credential_notify_days,
        license_notify_days: v.license_notify_days,
        notify_emails: v.notify_emails,
      });
      const firstError = res.errors ? Object.values(res.errors)[0] : undefined;
      setFeedback({ ok: Boolean(res.ok), text: firstError ?? res.message ?? "" });
    });

  const days = (key: "contract_notify_days" | "credential_notify_days" | "license_notify_days", label: string, hint?: string) => (
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {days("contract_notify_days", t("settingsPage.contractDays"), t("settingsPage.contractDaysHint"))}
            {days("credential_notify_days", t("settingsPage.credentialDays"))}
            {days("license_notify_days", t("settingsPage.licenseDays"), t("settingsPage.licenseDaysHint"))}
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
