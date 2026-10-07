"use client";

import { useState, useTransition } from "react";
import { setCentralPin } from "@/app/actions/it-data";
import { AlertIcon, CheckCircleIcon, KeyIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { SecretPinStatus } from "@/lib/types";

const PIN_RE = /^\S{4,32}$/;

/**
 * PIN กลางสำหรับเปิดดูรหัสผ่าน / License key — สถานะ + ฟอร์มตั้ง/เปลี่ยน (ผู้มีสิทธิ์ secrets.pin_manage)
 * ยืนยันด้วยรหัสผ่าน login ของผู้ตั้ง — ระบบไม่แสดงค่า PIN เดิมให้ใครเห็น
 */
export function CentralPinForm({ initial, canManage }: { initial: SecretPinStatus; canManage: boolean }) {
  const { t, fmt } = useI18n();
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ password: "", pin: "", pin_confirmation: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, value: string) => (setV((s) => ({ ...s, [k]: value })), setErrors((e) => ({ ...e, [k]: "" })));

  const save = () => {
    const e: Record<string, string> = {};
    if (!v.password) e.password = t("secretGuard.passwordRequired");
    if (!PIN_RE.test(v.pin)) e.pin = t("secretGuard.pinFormat");
    if (v.pin !== v.pin_confirmation) e.pin_confirmation = t("secretGuard.pinMismatch");
    if (Object.keys(e).length) return setErrors(e);
    start(async () => {
      const res = await setCentralPin(v);
      if (res.ok && res.status) {
        setStatus(res.status);
        setOpen(false);
        setV({ password: "", pin: "", pin_confirmation: "" });
        setFeedback({ ok: true, text: res.message ?? "" });
      } else {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, String(m)])));
        setFeedback({ ok: false, text: res.message ?? "" });
      }
    });
  };

  const field = (k: keyof typeof v, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={`pin-${k}`} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <PasswordInput id={`pin-${k}`} value={v[k]} maxLength={k === "password" ? 255 : 32} autoComplete={autoComplete} onChange={(e) => set(k, e.target.value)} className={`${input} ${errors[k] ? inputError : ""}`} />
      {errors[k] && <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <KeyIcon width={15} height={15} className="text-accent-500" />
          {status.set ? (
            <span>{t("secretGuard.pinStatusSet", { date: status.set_at ? fmt.dateTime(status.set_at) : "-", name: status.set_by ?? "-" })}</span>
          ) : (
            <span className="font-medium text-warning-700 dark:text-warning-300">{t("secretGuard.pinStatusNotSet")}</span>
          )}
        </p>
        {canManage && !open && (
          <button type="button" onClick={() => (setOpen(true), setFeedback(null))} className={`${btn.soft} ${btn.sm}`}>
            <KeyIcon width={13} height={13} />
            {t(status.set ? "secretGuard.pinChange" : "secretGuard.pinSet")}
          </button>
        )}
      </div>
      {!canManage && <p className="text-xs text-muted">{t("secretGuard.pinManageNote")}</p>}

      {feedback?.text && (
        <p role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </p>
      )}

      {canManage && open && (
        <fieldset disabled={pending} className="space-y-3 rounded-xl p-4 ring-1 ring-line disabled:opacity-60">
          <div className="grid gap-3 sm:grid-cols-3">
            {field("password", t("secretGuard.pinLoginPassword"), "current-password")}
            {field("pin", t("secretGuard.pinNew"), "new-password")}
            {field("pin_confirmation", t("secretGuard.pinConfirm"), "new-password")}
          </div>
          <p className="text-xs text-muted">{t("secretGuard.pinHint")}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => (setOpen(false), setErrors({}))} className={`${btn.secondary} ${btn.sm}`}>
              <XIcon width={13} height={13} />
              {t("common.cancel")}
            </button>
            <button type="button" onClick={save} className={`${btn.primary} ${btn.sm}`}>
              {pending ? <SpinnerIcon width={13} height={13} /> : <SaveIcon width={13} height={13} />}
              {t("common.save")}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
