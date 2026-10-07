"use client";

import { useState, useTransition, type ReactNode } from "react";
import { saveSettings } from "@/app/actions/it-data";
import { ChipList } from "@/components/chip-list";
import { AlertIcon, CheckCircleIcon, SaveIcon, ShieldIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { SecretGuard, SecretPinStatus } from "@/lib/types";
import { CentralPinForm } from "@/components/central-pin-form";

/** IPv4 / IPv6 หรือช่วง (CIDR) — API ตรวจซ้ำ */
const IP_RE = /^([0-9]{1,3}(\.[0-9]{1,3}){3}(\/([0-9]|[12][0-9]|3[0-2]))?|[0-9a-f:]+:[0-9a-f:.]*(\/[0-9]{1,3})?)$/i;

/** สวิตช์เปิด/ปิด */
function Toggle({ id, checked, onChange, title, hint, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl p-4 ring-1 ring-line">
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
          {/* ปุ่มกลม: ชิดซ้าย 2px (ปิด) → เลื่อน 20px (เปิด) — กว้างรวม 44px ไม่ล้นขอบ */}
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>
      {checked && children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
    </div>
  );
}

/**
 * ความปลอดภัยตอนเปิดดูรหัสผ่าน (คลังบัญชี) / License key — เปิด-ปิดแยกกันได้
 * ประวัติการเปิดดูถูกบันทึกทุกครั้งเสมอ (ปิดไม่ได้)
 */
export function SecurityForm({ initial, pinStatus, canManagePin }: { initial: SecretGuard; pinStatus: SecretPinStatus; canManagePin: boolean }) {
  const { t } = useI18n();
  const [v, setV] = useState<SecretGuard>(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof SecretGuard>(k: K, value: SecretGuard[K]) => (setV((s) => ({ ...s, [k]: value })), setFeedback(null));

  const save = () => {
    if (v.ip_restrict && v.allowed_ips.length === 0) return setFeedback({ ok: false, text: t("secretGuard.ipRequired") });
    start(async () => {
      const res = await saveSettings({ secret_guard: v });
      const firstError = res.errors ? Object.values(res.errors)[0] : undefined;
      setFeedback({ ok: Boolean(res.ok), text: firstError ?? res.message ?? "" });
    });
  };

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldIcon width={17} height={17} className="text-accent-500" />
          {t("secretGuard.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("secretGuard.subtitle")}</p>
      </div>

      {feedback?.text && (
        <div role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </div>
      )}

      <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
        <Toggle id="sg-reauth" checked={v.reauth} onChange={(x) => set("reauth", x)} title={t("secretGuard.reauthTitle")} hint={t("secretGuard.reauthHint")}>
          {/* ยืนยันด้วยอะไร: รหัสผ่าน login ของแต่ละคน / PIN กลางอันเดียว */}
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-medium">{t("secretGuard.methodTitle")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["password", "pin"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer gap-2 rounded-xl p-3 ring-1 transition-colors ${
                    v.reauth_method === m ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"
                  }`}
                >
                  <input type="radio" name="sg-method" value={m} checked={v.reauth_method === m} onChange={() => set("reauth_method", m)} className="mt-1 accent-[var(--accent-500)]" />
                  <span>
                    <span className="block text-sm font-medium">{t(m === "pin" ? "secretGuard.methodPin" : "secretGuard.methodPassword")}</span>
                    <span className="block text-xs text-muted">{t(m === "pin" ? "secretGuard.methodPinHint" : "secretGuard.methodPasswordHint")}</span>
                  </span>
                </label>
              ))}
            </div>
            {v.reauth_method === "pin" && (
              <div className="mt-3 rounded-xl bg-subtle/60 p-3">
                <CentralPinForm initial={pinStatus} canManage={canManagePin} />
              </div>
            )}
          </fieldset>
          <label htmlFor="sg-minutes" className="mb-1 block text-xs font-medium">
            {t("secretGuard.reauthMinutes")}
          </label>
          <input
            id="sg-minutes"
            type="number"
            min={1}
            max={60}
            value={v.reauth_minutes}
            onChange={(e) => set("reauth_minutes", Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
            className={`${input} max-w-32`}
          />
        </Toggle>

        <Toggle id="sg-ip" checked={v.ip_restrict} onChange={(x) => set("ip_restrict", x)} title={t("secretGuard.ipTitle")} hint={t("secretGuard.ipHint")}>
          <ChipList
            items={v.allowed_ips}
            onChange={(ips) => set("allowed_ips", ips)}
            placeholder={t("secretGuard.ipPlaceholder")}
            addLabel={t("secretGuard.ipAdd")}
            emptyText={t("secretGuard.ipEmpty")}
            validate={(ip) => (!IP_RE.test(ip.trim()) ? t("secretGuard.ipInvalid") : v.allowed_ips.includes(ip.trim()) ? t("secretGuard.ipDuplicate") : null)}
          />
          <p className="mt-2 text-xs text-warning-700 dark:text-warning-300">{t("secretGuard.ipProxyNote")}</p>
        </Toggle>

        <Toggle id="sg-notify" checked={v.notify_heads} onChange={(x) => set("notify_heads", x)} title={t("secretGuard.notifyTitle")} hint={t("secretGuard.notifyHint")} />

        <p className="text-xs text-muted">{t("secretGuard.logNote")}</p>
      </fieldset>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}
