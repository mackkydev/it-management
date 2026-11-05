"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unlockUserLogin } from "@/app/actions/users";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, LockIcon, SpinnerIcon } from "@/components/icons";
import { btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { LoginActivity } from "@/lib/types";

/**
 * ประวัติการเข้าสู่ระบบ: เข้าล่าสุด / รหัสผิดกี่ครั้ง / ล็อกล่าสุด + ปลดล็อก (users.unlock — ตั้งต้น admin ขึ้นไป, audit)
 * ล็อกจาก 2 สาเหตุ: login ผิดหลายครั้ง (until) / ไม่เข้าระบบนาน (activity.inactive_locked)
 */
export function LoginLockStatus({ userId, until, activity, canUnlock }: { userId: number; until: string | null; activity: LoginActivity; canUnlock: boolean }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const locked = Boolean(until) || activity.inactive_locked;

  const unlock = async () => {
    if (!(await confirm(t("users.loginLock.confirm"), { danger: false }))) return;
    start(async () => {
      const res = await unlockUserLogin(userId);
      setError(res.ok ? "" : (res.message ?? ""));
      if (res.ok) router.refresh();
    });
  };

  const when = (v: string | null) => (v ? fmt.dateTime(v) : t("users.loginLock.never"));
  const stat = (label: string, value: string, note?: string | null) => (
    <div className="rounded-xl bg-subtle px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted">{note}</dd>}
    </div>
  );
  const lockNote =
    activity.last_lock_reason === "inactive"
      ? t("users.loginLock.reasons.inactive")
      : activity.last_lock_reason === "password"
        ? t("users.loginLock.reasons.password", { count: fmt.number(activity.last_lock_attempts ?? 0) })
        : null;

  return (
    <section className={`space-y-3 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <LockIcon width={16} height={16} className={locked ? "text-warning-600 dark:text-warning-300" : "text-accent-500"} />
          {t(locked ? "users.loginLock.title" : "users.loginLock.activityTitle")}
        </h2>
        {until && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("users.loginLock.until", { time: fmt.dateTime(until) })}</span>}
        {activity.inactive_locked && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("users.loginLock.inactiveBadge")}</span>}
        {error && (
          <span role="alert" className="flex items-center gap-1 text-sm text-danger-600 dark:text-danger-300">
            <AlertIcon width={14} height={14} />
            {error}
          </span>
        )}
        {canUnlock && (locked || activity.failures > 0) && (
          <button type="button" onClick={unlock} disabled={pending} className={`${btn.primary} ${btn.sm} ml-auto disabled:cursor-not-allowed`}>
            {pending ? <SpinnerIcon width={13} height={13} /> : <LockIcon width={13} height={13} />}
            {t("users.loginLock.unlock")}
          </button>
        )}
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stat(t("users.loginLock.lastLogin"), when(activity.last_login_at))}
        {stat(t("users.loginLock.failures"), t("users.loginLock.failuresCount", { count: fmt.number(activity.failures) }))}
        {stat(t("users.loginLock.lastFailed"), when(activity.last_failed_at))}
        {stat(t("users.loginLock.lastLocked"), when(activity.last_locked_at), lockNote)}
      </dl>
    </section>
  );
}
