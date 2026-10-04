"use client";

import { useState, useTransition } from "react";
import { createInstallation, searchDevices, type InstallPayload } from "@/app/actions/license-installations";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, PlusIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { SuggestInput } from "@/components/suggest-input";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Branch, LicenseSummary, UserOption } from "@/lib/types";
import { CustodianPicker } from "../assets/custodian-picker";

type Device = { id: string; asset_tag: string; name: string };
const deviceLabel = (d: Device) => `${d.asset_tag} — ${d.name}`;

const EMPTY = (licenseId: string): InstallPayload => ({
  license_id: licenseId,
  device_asset_id: "",
  device_name: "",
  user_id: null,
  branch_id: "",
  installed_at: localToday(),
  notes: "",
});

/** บันทึกการติดตั้ง license — เครื่องเลือกจากทะเบียนสินทรัพย์ หรือพิมพ์ชื่อเครื่องเอง */
export function InstallForm({ licenses, branches, defaultLicense }: { licenses: LicenseSummary[]; branches: Branch[]; defaultLicense: string }) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<InstallPayload>(EMPTY(defaultLicense));
  const [manual, setManual] = useState(false);
  const [deviceText, setDeviceText] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [owner, setOwner] = useState<UserOption | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const chosen = licenses.find((l) => l.id === v.license_id);
  const full = chosen?.available === 0;
  const set = <K extends keyof InstallPayload>(k: K, value: InstallPayload[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
    setFeedback(null);
  };

  /** ค้นเครื่อง: เก็บผลไว้จับคู่ข้อความที่เลือกกลับเป็น id */
  const loadDevices = async (q: string) => {
    const found = await searchDevices(q);
    setDevices(found);
    return found.map(deviceLabel);
  };
  const onDeviceText = (text: string) => {
    setDeviceText(text);
    const match = devices.find((d) => deviceLabel(d) === text);
    set("device_asset_id", match?.id ?? "");
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.license_id) e.license_id = t("installations.validate.license");
    else if (full) e.license_id = t("installations.validate.full");
    if (manual ? !v.device_name.trim() : !v.device_asset_id) e.device_name = t("installations.validate.device");
    if (!v.installed_at) e.installed_at = t("installations.validate.date");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    start(async () => {
      const res = await createInstallation(manual ? { ...v, device_asset_id: "" } : v);
      if (res.ok) {
        setFeedback({ ok: true, text: res.message ?? "" });
        setV(EMPTY(v.license_id));
        setDeviceText("");
        setOwner(null);
      } else {
        const errs = Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k === "device_asset_id" ? "device_name" : k, m ?? ""]));
        setErrors(errs);
        setFeedback({ ok: false, text: res.message ?? "" });
      }
    });
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className={btn.primary}>
          <PlusIcon />
          {t("installations.add")}
        </button>
        {feedback?.ok && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-success-600 dark:text-success-300">
            <CheckCircleIcon width={15} height={15} />
            {feedback.text}
          </span>
        )}
      </div>
    );
  }

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("installations.formTitle")}</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink">
          <XIcon width={16} height={16} />
        </button>
      </div>
      {feedback && (
        <p role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </p>
      )}
      <fieldset disabled={pending} className="grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="license_id" className="mb-1 block text-sm font-medium">
            {t("installations.license")} <span className="text-red-500">*</span>
          </label>
          <select id="license_id" value={v.license_id} onChange={(e) => set("license_id", e.target.value)} className={cls("license_id")}>
            <option value="">{t("installations.chooseLicense")}</option>
            {licenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.asset_tag}) —{" "}
                {l.seats === null ? t("installations.unlimited") : t("installations.availableOf", { available: fmt.number(l.available ?? 0), seats: fmt.number(l.seats) })}
              </option>
            ))}
          </select>
          {errors.license_id ? err("license_id") : full && <p className="mt-1 text-xs font-medium text-red-500">{t("installations.validate.full")}</p>}
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={manual ? "device_name" : "device"} className="text-sm font-medium">
              {t("installations.device")} <span className="text-red-500">*</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => {
                  setManual(e.target.checked);
                  set("device_asset_id", "");
                  setDeviceText("");
                }}
                className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
              />
              {t("installations.manualDevice")}
            </label>
          </div>
          {manual ? (
            <input id="device_name" maxLength={255} placeholder={t("installations.deviceNamePlaceholder")} value={v.device_name} onChange={(e) => set("device_name", e.target.value)} className={cls("device_name")} />
          ) : (
            <SuggestInput id="device" value={deviceText} onChange={onDeviceText} load={loadDevices} placeholder={t("installations.devicePlaceholder")} className={cls("device_name")} />
          )}
          {err("device_name") ?? (
            <p className="mt-1 text-xs text-muted">{manual ? t("installations.manualHint") : v.device_asset_id ? t("installations.deviceChosen") : t("installations.deviceHint")}</p>
          )}
        </div>

        <div>
          <label htmlFor="owner" className="mb-1 block text-sm font-medium">
            {t("installations.user")}
          </label>
          <CustodianPicker
            id="owner"
            value={owner}
            onChange={(u) => {
              setOwner(u);
              set("user_id", u?.id ?? null);
            }}
            className={cls("user_id")}
          />
          {err("user_id")}
        </div>
        <div>
          <label htmlFor="branch_id" className="mb-1 block text-sm font-medium">
            {t("installations.branch")}
          </label>
          <select id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
            <option value="">{t("common.none")}</option>
            {branches.filter((b) => b.is_active).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {err("branch_id")}
        </div>
        <div>
          <label htmlFor="installed_at" className="mb-1 block text-sm font-medium">
            {t("installations.installedAt")} <span className="text-red-500">*</span>
          </label>
          <DateInput id="installed_at" value={v.installed_at} max={localToday()} onChange={(d) => set("installed_at", d)} className={cls("installed_at")} />
          {err("installed_at")}
        </div>
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            {t("installations.notes")}
          </label>
          <input id="notes" maxLength={2000} value={v.notes} onChange={(e) => set("notes", e.target.value)} className={cls("notes")} />
          {err("notes")}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={submit} disabled={pending || full} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("installations.save")}
        </button>
      </div>
    </section>
  );
}
