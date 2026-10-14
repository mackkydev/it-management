"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmTwoFactor, disableTwoFactor, regenerateRecoveryCodes, startTwoFactor, type TwoFactorStatus } from "@/app/actions/profile";
import { RecoveryCodes, qrDataUrl } from "@/app/login/two-factor-step";
import { CheckCircleIcon, ShieldIcon, SpinnerIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
import { btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";

type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

/**
 * การยืนยันตัวตน 2 ขั้น (2FA) ของฉัน — เปิด: รหัสผ่าน → สแกน QR + กรอกรหัสแรก → recovery codes (แสดงครั้งเดียว)
 * ปิด: รหัสผ่าน + รหัสจากแอป (ระบบบังคับผู้ดูแลระบบ = ปิดไม่ได้), สร้าง recovery codes ชุดใหม่: รหัสจากแอป
 */
export function TwoFactorCard({ status }: { status: TwoFactorStatus }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<{ field?: "password" | "code"; message: string } | null>(null);
  const [setup, setSetup] = useState<{ secret?: string; qr_svg?: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const reset = (next: Step = "idle") => {
    setStep(next);
    setPassword("");
    setCode("");
    setError(null);
  };
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; field?: "password" | "code"; secret?: string; qr_svg?: string; recovery_codes?: string[] }>, onOk: (r: { secret?: string; qr_svg?: string; recovery_codes?: string[] }) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError({ field: r.field, message: r.error ?? t("common.saveFailed") });
      setError(null);
      onOk(r);
    });

  const field = (id: "password" | "code") =>
    id === "password" ? (
      <div>
        <label htmlFor="tfa-password" className="mb-1 block text-sm font-medium">{t("profile.currentPassword")}</label>
        <PasswordInput id="tfa-password" value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} autoComplete="current-password" className={`${input} ${error?.field === "password" ? inputError : ""}`} />
        {error?.field === "password" && <p className="mt-1 text-xs font-medium text-red-500">{error.message}</p>}
      </div>
    ) : (
      <div>
        <label htmlFor="tfa-code" className="mb-1 block text-sm font-medium">{t("auth.twoFactor.code")}</label>
        <input id="tfa-code" value={code} onChange={(e) => (setCode(e.target.value), setError(null))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} className={`${input} font-mono tracking-[0.3em] ${error?.field !== "password" && error ? inputError : ""}`} />
        {error && error.field !== "password" && <p className="mt-1 text-xs font-medium text-red-500">{error.message}</p>}
      </div>
    );
  const actions = (submitLabel: string, onSubmit: () => void, disabled = false) => (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => reset()} disabled={pending} className={`${btn.secondary} ${btn.sm}`}>
        {t("common.cancel")}
      </button>
      <button type="button" onClick={onSubmit} disabled={pending || disabled} className={`${btn.primary} ${btn.sm}`}>
        {pending && <SpinnerIcon width={14} height={14} />}
        {submitLabel}
      </button>
    </div>
  );

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldIcon className="text-accent-500" />
            {t("profile.twoFactor.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("profile.twoFactor.hint")}</p>
        </div>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.enabled ? tone.success.badge : tone.idle.badge}`}>
          {status.enabled ? t("profile.twoFactor.on") : t("profile.twoFactor.off")}
        </span>
      </div>

      {step === "idle" && (
        <>
          {status.enabled ? (
            <p className="text-sm text-muted">
              {t("profile.twoFactor.enabledSince", { date: status.confirmed_at ? fmt.dateTime(status.confirmed_at) : "-" })} · {t("profile.twoFactor.codesLeft", { n: status.recovery_codes_left })}
            </p>
          ) : status.required ? (
            <p className="text-sm font-medium text-warning-700 dark:text-warning-300">{t("profile.twoFactor.requiredHint")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {status.enabled ? (
              <>
                <button type="button" onClick={() => reset("regenerate")} className={`${btn.secondary} ${btn.sm}`}>
                  {t("profile.twoFactor.regenerate")}
                </button>
                {!status.required && (
                  <button type="button" onClick={() => reset("disable")} className={`${btn.danger} ${btn.sm}`}>
                    {t("profile.twoFactor.disable")}
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => reset("password")} className={`${btn.primary} ${btn.sm}`}>
                {t("profile.twoFactor.enable")}
              </button>
            )}
          </div>
        </>
      )}

      {step === "password" && (
        <div className="space-y-3">
          {field("password")}
          {actions(t("profile.twoFactor.next"), () => run(() => startTwoFactor(password), (r) => (setSetup(r), setStep("scan"), setPassword(""))), !password)}
        </div>
      )}

      {step === "scan" && setup?.qr_svg && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("auth.twoFactor.setupHint")}</p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR เป็น SVG ที่สร้างตอนนั้น (data:) */}
            <img src={qrDataUrl(setup.qr_svg)} alt={t("auth.twoFactor.qrAlt")} className="h-40 w-40 rounded-xl bg-white p-2 ring-1 ring-line" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs text-muted">{t("auth.twoFactor.manualKey")}</p>
              <code className="block select-all break-all rounded-lg bg-subtle px-2 py-1 font-mono text-xs">{setup.secret}</code>
            </div>
          </div>
          {field("code")}
          {actions(t("profile.twoFactor.confirm"), () => run(() => confirmTwoFactor(code), (r) => (setCodes(r.recovery_codes ?? []), setStep("codes"), setCode(""))), !code)}
        </div>
      )}

      {step === "codes" && (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-success-700 dark:text-success-300">
            <CheckCircleIcon width={16} height={16} />
            {t("auth.twoFactor.enabledTitle")}
          </p>
          <RecoveryCodes codes={codes} />
          <div className="flex justify-end">
            <button type="button" onClick={() => (reset(), router.refresh())} className={`${btn.primary} ${btn.sm}`}>
              {t("profile.twoFactor.done")}
            </button>
          </div>
        </div>
      )}

      {step === "regenerate" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("profile.twoFactor.regenerateHint")}</p>
          {field("code")}
          {actions(t("profile.twoFactor.regenerate"), () => run(() => regenerateRecoveryCodes(code), (r) => (setCodes(r.recovery_codes ?? []), setStep("codes"), setCode(""))), !code)}
        </div>
      )}

      {step === "disable" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("profile.twoFactor.disableHint")}</p>
          {field("password")}
          {field("code")}
          {actions(t("profile.twoFactor.disable"), () => run(() => disableTwoFactor(password, code), () => (reset(), router.refresh())), !password || !code)}
        </div>
      )}
    </section>
  );
}
