"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { KeyIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PasswordPolicy } from "@/lib/types";

type Field = "lockout_attempts" | "lockout_minutes" | "expiry_days" | "expiry_warn_days" | "inactive_lock_days";
const LIMITS: Record<Field, [number, number]> = { lockout_attempts: [1, 50], lockout_minutes: [1, 1440], expiry_days: [1, 730], expiry_warn_days: [0, 60], inactive_lock_days: [1, 3650] };
/** ไม่ถูกล็อกเพราะไม่เข้าระบบเสมอ — ไม่งั้นถ้าไม่มีใครเข้าระบบนานเกินกำหนด จะไม่เหลือคนปลดล็อก */
const NEVER_LOCKED = "super_admin";

/**
 * นโยบายรหัสผ่าน (บัญชีในระบบ — ผู้ใช้จาก API เปลี่ยนรหัสที่ระบบต้นทาง) แก้ได้เฉพาะ access.manage:
 * ล็อกบัญชีเมื่อเข้าสู่ระบบผิดติดกัน (รหัสผ่าน / รหัส 2FA), บังคับเปลี่ยนรหัสผ่านทุก N วัน — ปิด = ส่ง 0
 * บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก (ผู้ดูแลสร้างผู้ใช้ / รีเซ็ตรหัสผ่าน)
 * และล็อกผู้ใช้ที่ไม่เข้าระบบตามจำนวนวัน เปิดเป็นรายกลุ่ม
 */
export function PasswordPolicyForm({ initial, groups }: { initial: PasswordPolicy; groups: { key: string; name_th: string; name_en: string }[] }) {
  const { t, fmt, locale } = useI18n();
  const [inactive, setInactive] = useState((initial.inactive_lock_days ?? 0) > 0);
  const [inactiveGroups, setInactiveGroups] = useState<string[]>(Object.keys(initial.inactive_lock_groups ?? {}));
  const [lockout, setLockout] = useState(initial.lockout_attempts > 0);
  const [expiry, setExpiry] = useState(initial.expiry_days > 0);
  const [firstChange, setFirstChange] = useState(Boolean(initial.force_first_change));
  // ค่าในช่อง (ปิดอยู่ = ค่าแนะนำไว้ให้เมื่อเปิด)
  const [v, setV] = useState<Record<Field, string>>({
    lockout_attempts: String(initial.lockout_attempts || 10),
    lockout_minutes: String(initial.lockout_minutes),
    expiry_days: String(initial.expiry_days || 90),
    expiry_warn_days: String(initial.expiry_warn_days),
    inactive_lock_days: String(initial.inactive_lock_days || 90),
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const set = (k: Field, value: string) => {
    setV((x) => ({ ...x, [k]: value }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = () => {
    const active: Field[] = [...(lockout ? (["lockout_attempts", "lockout_minutes"] as const) : []), ...(expiry ? (["expiry_days", "expiry_warn_days"] as const) : []), ...(inactive ? (["inactive_lock_days"] as const) : [])];
    const bad: Partial<Record<Field, string>> = {};
    for (const k of active) {
      const n = Number(v[k]);
      const [min, max] = LIMITS[k];
      if (v[k].trim() === "" || !Number.isInteger(n) || n < min || n > max) bad[k] = t("settingsPage.passwordPolicy.range", { min, max });
    }
    setErrors(bad);
    if (Object.keys(bad).length) return;
    const policy: Partial<PasswordPolicy> = {
      lockout_attempts: lockout ? Number(v.lockout_attempts) : 0,
      expiry_days: expiry ? Number(v.expiry_days) : 0,
      force_first_change: firstChange,
      inactive_lock_days: inactive ? Number(v.inactive_lock_days) : 0,
      inactive_lock_groups: inactiveGroups,
      ...(lockout ? { lockout_minutes: Number(v.lockout_minutes) } : {}),
      ...(expiry ? { expiry_warn_days: Number(v.expiry_warn_days) } : {}),
    };
    start(async () => {
      const res = await saveSettings({ password_policy: policy as PasswordPolicy });
      setResult(res);
    });
  };

  const number = (k: Field, label: string, hint?: string) => (
    <div>
      <label htmlFor={`pp-${k}`} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={`pp-${k}`}
        type="number"
        inputMode="numeric"
        min={LIMITS[k][0]}
        max={LIMITS[k][1]}
        value={v[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={Boolean(errors[k])}
        className={`${input} max-w-36 ${errors[k] ? inputError : ""}`}
      />
      {errors[k] ? <p className="mt-1 text-xs text-red-500">{errors[k]}</p> : hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );

  const toggle = (id: string, checked: boolean, onChange: (x: boolean) => void, title: string, hint: string) => (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${checked ? "bg-accent-500" : "bg-line"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <KeyIcon className="text-accent-500" />
          {t("settingsPage.passwordPolicy.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("settingsPage.passwordPolicy.hint")}</p>
      </div>

      {/* 2 คอลัมน์เรียงลงมาอิสระ — เปิดกล่องไหนแล้วสูงขึ้น ไม่เกิดช่องโหว่ข้าง ๆ */}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="space-y-3">
        <div className="rounded-xl p-4 ring-1 ring-line">
          {toggle("pp-lockout", lockout, setLockout, t("settingsPage.passwordPolicy.lockoutTitle"), t("settingsPage.passwordPolicy.lockoutHint"))}
          {lockout && (
            <div className="mt-3 grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
              {number("lockout_attempts", t("settingsPage.passwordPolicy.attempts"))}
              {number("lockout_minutes", t("settingsPage.passwordPolicy.minutes"), t("settingsPage.passwordPolicy.minutesHint"))}
            </div>
          )}
        </div>

        <div className="rounded-xl p-4 ring-1 ring-line">
          {toggle("pp-first", firstChange, setFirstChange, t("settingsPage.passwordPolicy.firstChangeTitle"), t("settingsPage.passwordPolicy.firstChangeHint"))}
        </div>
        </div>

        <div className="space-y-3">
        <div className="rounded-xl p-4 ring-1 ring-line">
          {toggle("pp-expiry", expiry, setExpiry, t("settingsPage.passwordPolicy.expiryTitle"), t("settingsPage.passwordPolicy.expiryHint"))}
          {expiry && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                {number("expiry_days", t("settingsPage.passwordPolicy.expiryDays"), t("settingsPage.passwordPolicy.expiryDaysHint"))}
                {number("expiry_warn_days", t("settingsPage.passwordPolicy.warnDays"), t("settingsPage.passwordPolicy.warnDaysHint"))}
              </div>
              <p className="text-xs text-muted">
                {/* จุดเริ่มนับของผู้ที่ยังไม่เคยเปลี่ยนรหัสผ่าน — API ตั้งตอนเปิด (บันทึกแล้วหน้าโหลดค่าใหม่) */}
                {initial.since ? t("settingsPage.passwordPolicy.since", { date: fmt.date(initial.since) }) : t("settingsPage.passwordPolicy.sinceNew")}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl p-4 ring-1 ring-line">
          {toggle("pp-inactive", inactive, setInactive, t("settingsPage.passwordPolicy.inactiveTitle"), t("settingsPage.passwordPolicy.inactiveHint"))}
          {inactive && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              {number("inactive_lock_days", t("settingsPage.passwordPolicy.inactiveDays"))}
              <div>
                <p className="mb-1.5 text-xs font-medium">{t("settingsPage.passwordPolicy.inactiveGroups")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {groups.map((g) => {
                    const name = locale === "en" ? g.name_en : g.name_th;
                    const exempt = g.key === NEVER_LOCKED;
                    const checked = !exempt && inactiveGroups.includes(g.key);
                    return (
                      <div key={g.key} className="flex items-center justify-between gap-3 rounded-xl bg-subtle px-3 py-2.5">
                        <span className="min-w-0 text-sm font-medium">
                          {name}
                          {exempt && <span className="ml-1.5 text-xs font-normal text-muted">{t("settingsPage.passwordPolicy.inactiveExempt")}</span>}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={name}
                          disabled={exempt}
                          onClick={() => setInactiveGroups((x) => (checked ? x.filter((k) => k !== g.key) : [...x, g.key]))}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-accent-500" : "bg-line"}`}
                        >
                          <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {result.message && <ResultToast result={result} />}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}
