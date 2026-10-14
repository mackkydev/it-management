"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetUserTwoFactor } from "@/app/actions/users";
import { useConfirm } from "@/components/dialog-provider";
import { CheckCircleIcon, ResetIcon, ShieldIcon, SpinnerIcon } from "@/components/icons";
import { btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ผู้ดูแลระบบสูงสุด: สถานะ 2FA ของผู้ใช้ + รีเซ็ตเมื่อผู้ใช้ทำโทรศัพท์หาย (ตัด session ทั้งหมดของผู้ใช้นั้น + audit) */
export function TwoFactorStatus({ userId, enabled }: { userId: number; enabled: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const reset = async () => {
    if (!(await confirm(t("users.twoFactor.confirmReset")))) return;
    start(async () => {
      const res = await resetUserTwoFactor(userId);
      setMessage(res.message ?? "");
      if (res.ok) router.refresh();
    });
  };

  return (
    <section className={`flex flex-wrap items-center gap-3 p-4 sm:px-6 ${card}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldIcon width={16} height={16} className="text-accent-500" />
        {t("users.twoFactor.title")}
      </h2>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${enabled ? tone.success.badge : tone.idle.badge}`}>{enabled ? t("profile.twoFactor.on") : t("profile.twoFactor.off")}</span>
      {message && (
        <span className="flex items-center gap-1 text-sm text-muted">
          <CheckCircleIcon width={14} height={14} />
          {message}
        </span>
      )}
      {enabled && (
        <button type="button" onClick={reset} disabled={pending} className={`${btn.danger} ${btn.sm} ml-auto disabled:cursor-not-allowed`}>
          {pending ? <SpinnerIcon width={13} height={13} /> : <ResetIcon width={13} height={13} />}
          {t("users.twoFactor.reset")}
        </button>
      )}
    </section>
  );
}
