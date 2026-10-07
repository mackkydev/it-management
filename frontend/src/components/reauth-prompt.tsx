"use client";

import { useState, useTransition, type FormEvent } from "react";
import { confirmIdentity } from "@/app/actions/auth";
import { AlertIcon, CheckIcon, KeyIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
import { btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ReauthChallenge } from "@/lib/types";

/**
 * ช่องยืนยันตัวตนก่อนเปิดดูข้อมูลลับ (รหัสผ่านในคลังบัญชี / License key) — แสดงเมื่อ API ตอบ 428
 * method: password = รหัสผ่าน login ของตัวเอง / pin = PIN กลาง (ตั้งโดยผู้ดูแลระบบหรือผู้มีสิทธิ์)
 * ยืนยันผ่านแล้วเรียก onConfirmed (ให้ผู้เรียกเปิดดูอีกครั้งอัตโนมัติ)
 */
export function ReauthPrompt({ challenge, onConfirmed, onCancel }: { challenge: ReauthChallenge; onConfirmed: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const pin = challenge.method === "pin";

  // PIN กลางยังไม่ได้ตั้ง / คนนี้ถูกล็อกชั่วคราว → แจ้งข้อความอย่างเดียว
  if (pin && (!challenge.pin_set || challenge.pin_locked)) {
    return (
      <div className="flex w-full max-w-xs items-start gap-1.5 text-xs text-danger-600 dark:text-danger-300">
        <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
        <span className="flex-1">{challenge.message}</span>
        <button type="button" onClick={onCancel} aria-label={t("common.close")} className="shrink-0 cursor-pointer text-muted hover:text-ink">
          <XIcon width={13} height={13} />
        </button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value) return setError(t(pin ? "secretGuard.pinRequired" : "secretGuard.passwordRequired"));
    start(async () => {
      const res = await confirmIdentity(value, challenge.method);
      if (res.ok) {
        setValue("");
        onConfirmed();
      } else setError(res.message ?? t("common.saveFailed"));
    });
  };

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <KeyIcon width={13} height={13} className="text-accent-500" />
        {t(pin ? "secretGuard.promptPin" : "secretGuard.prompt")}
      </p>
      <div className="flex items-center gap-1">
        <PasswordInput
          wrapperClassName="min-w-0 flex-1"
          autoFocus
          autoComplete={pin ? "off" : "current-password"}
          value={value}
          maxLength={pin ? 64 : 255}
          onChange={(e) => (setValue(e.target.value), setError(""))}
          placeholder={t(pin ? "secretGuard.pinPlaceholder" : "secretGuard.placeholder")}
          aria-label={t(pin ? "secretGuard.pinPlaceholder" : "secretGuard.placeholder")}
          className={`${input} px-2 py-1 text-xs ${error ? inputError : ""}`}
        />
        <button type="submit" disabled={pending} aria-label={t("secretGuard.confirm")} className={`${btn.primary} ${btn.sm} h-7 shrink-0 px-2`}>
          {pending ? <SpinnerIcon width={13} height={13} /> : <CheckIcon width={13} height={13} />}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} aria-label={t("common.cancel")} className={`${btn.secondary} ${btn.sm} h-7 shrink-0 px-2`}>
          <XIcon width={13} height={13} />
        </button>
      </div>
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}
    </form>
  );
}
