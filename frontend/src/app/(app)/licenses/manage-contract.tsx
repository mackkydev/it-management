"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelLicense, renewLicense } from "@/app/actions/licenses";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, FileTextIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { addToIsoDate } from "@/lib/date";
import type { AssetLicense } from "@/lib/types";

/** วันหมดอายุใหม่ตั้งต้น: รายปี = +1 ปี, กำหนดเอง = ระยะเท่าสัญญาเดิม (คำนวณจากวันเริ่ม-สิ้นสุดเดิม — ไม่ลงตัว = +1 ปี) */
function nextExpiry(l: AssetLicense): string {
  if (!l.expires_at) return "";
  if (l.billing === "custom" && l.start_date) {
    const years = Math.round((Date.parse(l.expires_at) - Date.parse(l.start_date)) / (365.25 * 86_400_000));
    if (years > 1) return addToIsoDate(l.expires_at, { years });
  }
  return addToIsoDate(l.expires_at, { years: 1 });
}

/**
 * ปุ่ม "จัดการสัญญา" (ข้างปุ่มแก้ไข ในหน้าซอฟต์แวร์ License) — popup: ต่อสัญญาแล้ว (วันหมดอายุใหม่) / ยกเลิกสัญญา (เหตุผล) / ปิด
 * กำลังจะหมดอายุ = ปุ่มเน้นสีเตือน; ทำอย่างใดอย่างหนึ่งแล้วหายจากแท็บ "กำลังจะหมดอายุ" และตัวเลขเมนู
 */
export function ManageContractButton({ licenseId, license }: { licenseId: string; license: AssetLicense }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"renew" | "cancel" | null>(null);
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setMode(null);
    setExpires(nextExpiry(license));
    setReason("");
    setError("");
    setOpen(true);
  };
  const done = () => {
    setOpen(false);
    router.refresh();
  };
  const renew = () => {
    if (!expires) return setError(t("licenses.contract.expiresRequired"));
    start(async () => {
      const res = await renewLicense(licenseId, expires);
      if (res.ok) return done();
      setError((res.errors as Record<string, string> | undefined)?.expires_at ?? res.message ?? t("common.saveFailed"));
    });
  };
  const cancel = async () => {
    if (!(await confirm(t("licenses.contract.confirmCancel")))) return;
    start(async () => {
      const res = await cancelLicense(licenseId, reason.trim());
      if (res.ok) return done();
      setError((res.errors as Record<string, string> | undefined)?.reason ?? res.message ?? t("common.saveFailed"));
    });
  };

  const choice = (active: boolean) =>
    `flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1 transition-colors ${
      active ? "bg-accent-50 text-accent-800 ring-accent-300 dark:bg-accent-400/10 dark:text-accent-200 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"
    }`;

  return (
    <>
      {/* จุดแดงแจ้งเตือน (กะพริบ) ที่มุมปุ่ม — อยู่จนกว่าจะต่อสัญญาหรือยกเลิกสัญญา (license.expiring) */}
      <button type="button" onClick={show} className={license.expiring ? `${btn.soft} relative ring-2 ring-warning-300 dark:ring-warning-400/40` : btn.soft}>
        <FileTextIcon />
        {t("licenses.contract.button")}
        {license.expiring && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-danger-500 ring-2 ring-surface" />
          </span>
        )}
        {license.expiring && <span className="sr-only">{t("licenses.contract.pending")}</span>}
      </button>
      {open && (
        <ModalShell
          id="contract-title"
          title={t("licenses.contract.title")}
          subtitle={
            license.expires_at
              ? t("licenses.contract.current", { start: fmt.date(license.start_date), end: fmt.date(license.expires_at) })
              : t("assets.license.noExpiry")
          }
          onClose={() => setOpen(false)}
          busy={pending}
        >
          <fieldset disabled={pending} className="space-y-4">
            {license.cancelled_at && (
              <p className={alert.info}>{t("licenses.contract.cancelledOn", { date: fmt.date(license.cancelled_at), reason: license.cancel_reason ?? "-" })}</p>
            )}
            {error && <p className={alert.error}>{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => (setMode("renew"), setError(""))} className={choice(mode === "renew")}>
                <CheckCircleIcon className="text-success-500" />
                {t("licenses.contract.renew")}
              </button>
              <button type="button" onClick={() => (setMode("cancel"), setError(""))} className={choice(mode === "cancel")}>
                <AlertIcon className="text-danger-500" />
                {t("licenses.contract.cancel")}
              </button>
            </div>
            {mode === "renew" && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="contract-expires" className="mb-1 block text-sm font-medium">
                    {t("licenses.contract.newExpiry")} <span className="text-red-500">*</span>
                  </label>
                  <DateInput
                    id="contract-expires"
                    value={expires}
                    min={license.expires_at ?? undefined}
                    onChange={(d) => (setExpires(d), setError(""))}
                    className={`${input} ${error ? inputError : ""}`}
                  />
                  <p className="mt-1 text-xs text-muted">{t("licenses.contract.renewHint")}</p>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={renew} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
                    {pending ? <SpinnerIcon /> : <CheckCircleIcon />}
                    {t("licenses.contract.saveRenew")}
                  </button>
                </div>
              </div>
            )}
            {mode === "cancel" && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="contract-reason" className="mb-1 block text-sm font-medium">
                    {t("licenses.contract.reason")}
                  </label>
                  <textarea
                    id="contract-reason"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => (setReason(e.target.value), setError(""))}
                    className={input}
                  />
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={cancel} className={`${btn.danger} disabled:cursor-not-allowed disabled:opacity-60`}>
                    {pending ? <SpinnerIcon /> : <AlertIcon />}
                    {t("licenses.contract.saveCancel")}
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end border-t border-line pt-3">
              <button type="button" onClick={() => setOpen(false)} className={`${btn.secondary} disabled:cursor-not-allowed`}>
                <XIcon className="text-faint" />
                {t("common.close")}
              </button>
            </div>
          </fieldset>
        </ModalShell>
      )}
    </>
  );
}
