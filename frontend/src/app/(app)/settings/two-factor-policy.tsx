"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { useConfirm } from "@/components/dialog-provider";
import { ShieldIcon, SpinnerIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** บังคับใช้ 2FA ตามกลุ่ม (บัญชี LOCAL ทั้งกลุ่มตามตำแหน่งและกลุ่มที่สร้างเอง) — สวิตช์ต่อกลุ่ม ถามยืนยันก่อนบันทึก, แก้ได้เฉพาะผู้มีสิทธิ์ access.manage */
export function TwoFactorPolicy({ groups, initial }: { groups: { key: string; name_th: string; name_en: string }[]; initial: string[] }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const toggle = async (key: string, name: string) => {
    const enabling = !on.includes(key);
    const asked = enabling ? confirm(t("settingsPage.twoFactor.confirmOn", { group: name }), { danger: false }) : confirm(t("settingsPage.twoFactor.confirmOff", { group: name }));
    if (!(await asked)) return;
    const next = enabling ? [...on, key] : on.filter((k) => k !== key);
    setSaving(key);
    start(async () => {
      const res = await saveSettings({ two_factor_groups: next });
      setResult(res);
      if (res.ok) setOn(next);
    });
  };

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldIcon className="text-accent-500" />
          {t("settingsPage.twoFactor.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("settingsPage.twoFactor.hint")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => {
          const name = locale === "en" ? g.name_en : g.name_th;
          const checked = on.includes(g.key);
          return (
            <div key={g.key} className="flex items-center justify-between gap-3 rounded-xl bg-subtle px-3 py-2.5">
              <span className="min-w-0 text-sm font-medium">{name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={name}
                disabled={pending}
                onClick={() => toggle(g.key, name)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${checked ? "bg-accent-500" : "bg-line"}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
                {pending && saving === g.key && <SpinnerIcon width={12} height={12} className="absolute -left-5 text-accent-400" />}
              </button>
            </div>
          );
        })}
      </div>
      {result.message && <ResultToast result={result} />}
    </section>
  );
}
