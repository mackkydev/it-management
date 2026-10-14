"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { startLoginTwoFactorSetup, verifyLoginTwoFactor, type TwoFactorState } from "@/app/actions/auth";
import { AlertIcon, CheckIcon, CopyIcon, LoginIcon, ShieldIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** QR (SVG จาก API ที่สร้างด้วย lib qrcode) แสดงเป็นรูป data: — ไม่ต้องใส่ HTML ลงหน้าเว็บตรงๆ */
export const qrDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** รายการ recovery codes + ปุ่มคัดลอก (แสดงครั้งเดียวหลังเปิด 2FA) */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className={alert.warning}>
        <AlertIcon className="shrink-0" />
        {t("auth.twoFactor.recoveryHint")}
      </p>
      <ul className="grid grid-cols-2 gap-1.5 rounded-xl bg-subtle p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button type="button" onClick={() => (navigator.clipboard?.writeText(codes.join("\n")), setCopied(true))} className={`${btn.secondary} ${btn.sm}`}>
        {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
        {copied ? t("auth.twoFactor.copied") : t("auth.twoFactor.copyCodes")}
      </button>
    </div>
  );
}

/**
 * login ขั้นที่ 2 — verify: กรอกรหัส 6 หลักจากแอป (หรือ recovery code)
 * setup: ผู้ดูแลระบบที่ระบบบังคับ 2FA — สแกน QR ด้วยแอป แล้วกรอกรหัสแรก → ได้ recovery codes → เข้าระบบ
 */
export function TwoFactorStep({ mode }: { mode: "verify" | "setup" }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(verifyLoginTwoFactor, {});
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<{ secret?: string; qr_svg?: string; error?: string } | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    if (mode === "setup") startLoad(async () => setSetup(await startLoginTwoFactorSetup()));
  }, [mode]);

  if (state.recoveryCodes) {
    return (
      <div className="mt-8 space-y-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldIcon className="text-success-400" />
          {t("auth.twoFactor.enabledTitle")}
        </h2>
        <RecoveryCodes codes={state.recoveryCodes} />
        <Link href="/" className={`${btn.primary} w-full py-2.5`}>
          <LoginIcon />
          {t("auth.twoFactor.continue")}
        </Link>
      </div>
    );
  }

  const error = state.error ?? setup?.error;
  return (
    <form action={action} className="mt-8 space-y-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldIcon className="text-accent-300" />
          {mode === "setup" ? t("auth.twoFactor.setupTitle") : t("auth.twoFactor.verifyTitle")}
        </h2>
        <p className="login-muted mt-1 text-sm">{mode === "setup" ? t("auth.twoFactor.setupHint") : useRecovery ? t("auth.twoFactor.recoveryInputHint") : t("auth.twoFactor.verifyHint")}</p>
      </div>
      {mode === "setup" && (
        <div className="flex flex-col items-center gap-2">
          {loading || !setup ? (
            <SpinnerIcon className="text-accent-300" />
          ) : (
            setup.qr_svg && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- QR เป็น SVG ที่สร้างตอนนั้น (data:) */}
                <img src={qrDataUrl(setup.qr_svg)} alt={t("auth.twoFactor.qrAlt")} className="h-44 w-44 rounded-xl bg-white p-2" />
                <p className="login-muted text-center text-xs">{t("auth.twoFactor.manualKey")}</p>
                <code className="select-all break-all rounded-lg bg-subtle px-2 py-1 text-center font-mono text-xs">{setup.secret}</code>
              </>
            )
          )}
        </div>
      )}
      {useRecovery ? (
        <div>
          <label htmlFor="recovery_code" className="mb-1.5 block text-sm font-medium">
            {t("auth.twoFactor.recoveryCode")}
          </label>
          <input id="recovery_code" name="recovery_code" autoComplete="off" autoCapitalize="characters" required className={`${input} py-2.5 font-mono`} />
        </div>
      ) : (
        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
            {t("auth.twoFactor.code")}
          </label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className={`${input} py-2.5 text-center font-mono text-lg tracking-[0.4em]`} />
        </div>
      )}
      {error && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || (mode === "setup" && !setup?.qr_svg)} aria-busy={pending} className={`${btn.primary} w-full py-2.5`}>
        {pending ? <SpinnerIcon /> : <LoginIcon />}
        {t("auth.twoFactor.submit")}
      </button>
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {mode === "verify" && (
          <button type="button" onClick={() => setUseRecovery((v) => !v)} className="cursor-pointer font-medium text-accent-300 hover:underline">
            {useRecovery ? t("auth.twoFactor.useApp") : t("auth.twoFactor.useRecovery")}
          </button>
        )}
        <Link href="/login" className="login-muted ml-auto cursor-pointer hover:underline">
          {t("auth.twoFactor.back")}
        </Link>
      </div>
    </form>
  );
}
