"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unlockUserLogin } from "@/app/actions/users";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, LockIcon, SpinnerIcon } from "@/components/icons";
import { btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** บัญชีถูกล็อกเพราะ login ผิดหลายครั้ง (นโยบายรหัสผ่าน) — ผู้มีสิทธิ์แก้ไขผู้ใช้ปลดล็อกก่อนครบเวลาได้ (audit) */
export function LoginLockStatus({ userId, until }: { userId: number; until: string }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const unlock = async () => {
    if (!(await confirm(t("users.loginLock.confirm"), { danger: false }))) return;
    start(async () => {
      const res = await unlockUserLogin(userId);
      setError(res.ok ? "" : (res.message ?? ""));
      if (res.ok) router.refresh();
    });
  };

  return (
    <section className={`flex flex-wrap items-center gap-3 p-4 sm:px-6 ${card}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <LockIcon width={16} height={16} className="text-warning-600 dark:text-warning-300" />
        {t("users.loginLock.title")}
      </h2>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("users.loginLock.until", { time: fmt.dateTime(until) })}</span>
      {error && (
        <span role="alert" className="flex items-center gap-1 text-sm text-danger-600 dark:text-danger-300">
          <AlertIcon width={14} height={14} />
          {error}
        </span>
      )}
      <button type="button" onClick={unlock} disabled={pending} className={`${btn.primary} ${btn.sm} ml-auto disabled:cursor-not-allowed`}>
        {pending ? <SpinnerIcon width={13} height={13} /> : <LockIcon width={13} height={13} />}
        {t("users.loginLock.unlock")}
      </button>
    </section>
  );
}
