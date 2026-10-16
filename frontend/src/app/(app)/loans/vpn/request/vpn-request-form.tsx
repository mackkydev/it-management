"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestVpn } from "@/app/actions/vpn";
import { DateInput } from "@/components/date-input";
import { AlertIcon, SendIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";

type Field = "purpose" | "requested_until";

/** ขอใช้ VPN — วัตถุประสงค์ + วันที่ต้องการใช้ถึง (ไม่บังคับ) → ฝ่าย IT มอบบัญชีและกำหนดวันหมดอายุ */
export function VpnRequestForm({ requester }: { requester: { name: string; department: string | null } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState({ purpose: "", requested_until: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const set = (k: Field, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = () => {
    if (!v.purpose.trim()) return setErrors({ purpose: t("vpn.form.validate.purpose") });
    setMessage("");
    start(async () => {
      const res = await requestVpn(v);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors ? "" : (res.message ?? ""));
        return;
      }
      router.push("/loans/mine?vpn=requested");
    });
  };

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={pending} className={`grid grid-cols-1 gap-4 p-5 disabled:opacity-60 sm:grid-cols-2 ${card}`}>
        <p className="text-sm text-muted sm:col-span-2">
          {t("vpn.field.user")}: <span className="font-medium text-ink">{requester.name}</span>
          {requester.department ? ` · ${requester.department}` : ""}
        </p>
        <div className="sm:col-span-2">
          <label htmlFor="purpose" className="mb-1 block text-sm font-medium">
            {t("vpn.field.purpose")} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="purpose"
            rows={3}
            maxLength={2000}
            value={v.purpose}
            placeholder={t("vpn.form.purposeHint")}
            onChange={(e) => set("purpose", e.target.value)}
            className={`${input} ${errors.purpose ? inputError : ""}`}
          />
          {errors.purpose && <p className="mt-1 text-xs font-medium text-red-500">{errors.purpose}</p>}
        </div>
        <div>
          <label htmlFor="requested_until" className="mb-1 block text-sm font-medium">
            {t("vpn.field.requestedUntil")}
          </label>
          <DateInput
            id="requested_until"
            value={v.requested_until}
            min={localToday()}
            onChange={(d) => set("requested_until", d)}
            className={`${input} ${errors.requested_until ? inputError : ""}`}
          />
          {errors.requested_until ? (
            <p className="mt-1 text-xs font-medium text-red-500">{errors.requested_until}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">{t("vpn.form.untilHint")}</p>
          )}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SendIcon width={16} height={16} />}
          {t("vpn.form.submit")}
        </button>
      </div>
    </form>
  );
}
