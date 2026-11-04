"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { ChipList } from "@/components/chip-list";
import { SaveIcon, SpinnerIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { btn, card, input } from "@/components/ui";
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
        ticket_auto_close_days: v.ticket_auto_close_days ?? 7,
        ticket_flow: v.ticket_flow ?? "approval_first",
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
      {feedback?.text && <ResultToast result={feedback} />}

      <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("settingsPage.expirySection")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {days("contract_notify_days", t("settingsPage.contractDays"), t("settingsPage.contractDaysHint"))}
            {days("credential_notify_days", t("settingsPage.credentialDays"))}
            {days("license_notify_days", t("settingsPage.licenseDays"), t("settingsPage.licenseDaysHint"))}
          </div>
        </section>

        {/* ใบแจ้งงาน: ผู้แจ้งไม่กดรับงานเกิน N วัน → ระบบปิดงานอัตโนมัติ (0 = ไม่ปิดอัตโนมัติ) */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("settingsPage.ticketSection")}</h2>
          {/* ขั้นตอนใบแจ้งงาน: หัวหน้าอนุมัติก่อน (แบบเดิม) / ส่งถึงฝ่าย IT ทันที (IT ขอให้หัวหน้าอนุมัติเมื่อจำเป็น) */}
          <fieldset className="mb-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">{t("settingsPage.ticketFlow")}</legend>
            {(["it_first", "approval_first"] as const).map((f) => (
              <label key={f} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="ticket_flow"
                  value={f}
                  checked={(v.ticket_flow ?? "approval_first") === f}
                  onChange={() => setV({ ...v, ticket_flow: f })}
                  className="mt-0.5 cursor-pointer accent-[var(--accent-500)]"
                />
                <span>
                  {t(`settingsPage.ticketFlows.${f}`)}
                  <span className="block text-xs text-muted">{t(`settingsPage.ticketFlowHints.${f}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="ticket_auto_close_days" className="mb-1 block text-sm font-medium">
            {t("settingsPage.autoCloseDays")}
          </label>
          <input
            id="ticket_auto_close_days"
            type="number"
            min={0}
            max={90}
            value={v.ticket_auto_close_days ?? 7}
            onChange={(e) => setV({ ...v, ticket_auto_close_days: Number(e.target.value) })}
            className={`${input} max-w-40`}
          />
          <p className="mt-1 text-xs text-muted">{t("settingsPage.autoCloseDaysHint")}</p>
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
            grid
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
