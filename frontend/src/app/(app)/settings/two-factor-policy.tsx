"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, ShieldIcon, SpinnerIcon } from "@/components/icons";
import { alert, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** บังคับผู้ดูแลระบบ (super_admin / admin บัญชี LOCAL) ใช้ 2FA — แก้ได้เฉพาะผู้มีสิทธิ์ access.manage */
export function TwoFactorPolicy({ initial }: { initial: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [on, setOn] = useState(initial);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const toggle = async () => {
    const next = !on;
    if (next && !(await confirm(t("settingsPage.twoFactor.confirmOn"), { danger: false }))) return;
    start(async () => {
      const res = await saveSettings({ two_factor_required: next });
      setResult(res);
      if (res.ok) setOn(next);
    });
  };

  return (
    <section className={`space-y-3 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldIcon className="text-accent-500" />
            {t("settingsPage.twoFactor.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("settingsPage.twoFactor.hint")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("settingsPage.twoFactor.title")}
          disabled={pending}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-accent-500" : "bg-line"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
          {pending && <SpinnerIcon width={12} height={12} className="absolute -right-5 text-accent-400" />}
        </button>
      </div>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
          {result.message}
        </p>
      )}
    </section>
  );
}
