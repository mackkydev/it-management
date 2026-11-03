"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { suggestAssetValues } from "@/app/actions/assets";
import { createLicense, deleteLicense, updateLicense, type LicenseSaveResult } from "@/app/actions/licenses";
import { quickAddOption } from "@/app/actions/dropdowns";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { OptionPicker } from "@/components/option-picker";
import { PasswordInput } from "@/components/password-input";
import { SuggestInput } from "@/components/suggest-input";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TFunction } from "@/i18n/types";
import { addToIsoDate, LICENSE_MAX_YEARS, licenseExpiryAfter, licenseYears, localToday } from "@/lib/date";
import {
  LICENSE_BILLINGS,
  LICENSE_STATUSES,
  SOFTWARE_TYPES,
  type Branch,
  type LicenseFieldErrors,
  type LicenseFormValues,
  type LicenseRecordValues,
  type Location,
  type SoftwareType,
} from "@/lib/types";
import { LocationPicker } from "../assets/location-picker";

const EMPTY: LicenseRecordValues = {
  license_no: "",
  name: "",
  brand: "",
  model: "",
  serial_number: "",
  status: "active",
  location_id: "",
  branch_id: "",
  purchase_date: "",
  purchase_cost: "",
  notes: "",
  license: {
    billing: "yearly",
    start_date: "",
    expires_at: "",
    seats: "",
    vendor: "",
    license_key: "",
    clear_license_key: false,
    notify_days_before: "",
    duration_years: "",
    software_type: "other",
  },
};

/** วันหมดอายุของ license รายปี: วันเริ่ม + 1 ปี − 1 วัน */
const yearlyExpiry = (start: string) => (start ? addToIsoDate(start, { years: 1, days: -1 }) : "");

/** ตรวจเบื้องต้นฝั่ง client ให้ผู้ใช้เห็นทันที — API ตรวจซ้ำทุกครั้ง */
function validate(v: LicenseRecordValues, t: TFunction): LicenseFieldErrors {
  const e: LicenseFieldErrors = {};
  const l = v.license;
  if (!l.start_date) e["license.start_date"] = t("assets.license.validate.startDate");
  if (l.billing !== "perpetual") {
    if (!l.expires_at) e["license.expires_at"] = t("assets.license.validate.expiresAt");
    else if (l.start_date && l.expires_at < l.start_date) e["license.expires_at"] = t("assets.license.validate.expiresBeforeStart");
  }
  if (l.seats && (!/^\d+$/.test(l.seats) || Number(l.seats) < 1)) e["license.seats"] = t("assets.license.validate.seats");
  if (l.billing === "custom" && l.duration_years && !licenseExpiryAfter(l.start_date || "2000-01-01", l.duration_years)) {
    e["license.duration_years"] = t("assets.license.validate.durationYears", { max: LICENSE_MAX_YEARS });
  }
  // เลขที่ทรัพย์สิน ไม่บังคับ
  if (v.license_no.trim() && !/^[A-Za-z0-9\-_/]+$/.test(v.license_no.trim())) e.license_no = t("assets.validate.tagFormat");
  if (!v.name.trim()) e.name = t("assets.validate.nameRequired");
  if (v.purchase_cost && (isNaN(Number(v.purchase_cost)) || Number(v.purchase_cost) < 0)) e.purchase_cost = t("assets.validate.costInvalid");
  if (v.purchase_date && v.purchase_date > localToday()) e.purchase_date = t("assets.validate.purchaseFuture");
  return e;
}

/** ฟอร์มเพิ่ม/แก้ไข License ซอฟต์แวร์ */
export function LicenseForm({
  locations,
  branches,
  brands,
  licenseId,
  initial,
  canDelete = false,
  hasLicenseKey = false,
  defaultType,
  defaultName,
}: {
  locations: Location[];
  branches: Branch[];
  brands: string[];
  /** ไม่ระบุ = โหมดเพิ่มใหม่ */
  licenseId?: string;
  initial?: LicenseRecordValues;
  canDelete?: boolean;
  hasLicenseKey?: boolean;
  /** โหมดเพิ่ม: ประเภทเริ่มต้น (?type= จากช่อง OS / Office / Anti Virus) */
  defaultType?: SoftwareType;
  /** โหมดเพิ่ม: ชื่อเริ่มต้น (?name= จากหน้ารวม License ชื่อเดียวกัน) */
  defaultName?: string;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [values, setValues] = useState<LicenseRecordValues>(
    initial ?? { ...EMPTY, name: defaultName ?? "", license: { ...EMPTY.license, software_type: defaultType ?? "other" } },
  );
  const [errors, setErrors] = useState<LicenseFieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  const isEdit = Boolean(licenseId);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const name = e.target.name as Plain;
    setValues((v) => ({ ...v, [name]: e.target.value }));
    setErrors((prev) => ({ ...prev, [name]: "" })); // ล้าง error ของช่องที่แก้ทันที
  };
  const setField = (name: Plain, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleResult = (result: LicenseSaveResult | undefined) => {
    // สำเร็จ = server action redirect ไปหน้ารายการ จึงมาถึงตรงนี้เฉพาะกรณีผิดพลาด
    if (!result) return;
    setErrors(result.errors ?? {});
    setMessage(result.message ?? "");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, t);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");
    setPendingAction("save");
    startTransition(async () => handleResult(licenseId ? await updateLicense(licenseId, values) : await createLicense(values)));
  };
  const onDelete = async () => {
    if (!licenseId || !(await confirm(t("assets.form.confirmDelete", { tag: values.license_no || values.name })))) return;
    setPendingAction("delete");
    startTransition(async () => handleResult(await deleteLicense(licenseId)));
  };

  type Plain = Exclude<keyof LicenseRecordValues, "license">;
  const field = (name: Plain, label: string, control: ReactNode, required = false) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[name] && <p className="mt-1 text-xs font-medium text-red-500">{errors[name]}</p>}
    </div>
  );
  const cls = (name: Plain) => `${inputBase} ${errors[name] ? inputError : ""}`;
  const input = (name: Plain, props: Record<string, unknown> = {}) => (
    <input id={name} name={name} value={values[name]} onChange={onChange} className={cls(name)} {...props} />
  );

  const lic = values.license;
  // กำหนดระยะเวลาเอง: เลือกแล้วพาไปที่ช่องจำนวนปีทันที (ช่องเพิ่งแสดงหลัง render รอบถัดไป)
  const yearsRef = useRef<HTMLInputElement>(null);
  const chooseBilling = (b: LicenseFormValues["billing"]) => {
    setLicense({ billing: b });
    if (b === "custom") window.setTimeout(() => yearsRef.current?.focus(), 0);
  };
  // ยังไม่กรอกจำนวนปี → ขอบสีเน้นให้รู้ว่าต้องกรอก
  const yearsPending = lic.billing === "custom" && !lic.duration_years && !errors["license.duration_years"];
  const setLicense = (patch: Partial<LicenseFormValues>) => {
    setValues((v) => {
      const next = { ...v.license, ...patch };
      // รายปี: คำนวณวันหมดอายุจากวันเริ่มให้อัตโนมัติ (แก้เองได้)
      if (next.billing === "yearly" && ("start_date" in patch || patch.billing === "yearly")) next.expires_at = yearlyExpiry(next.start_date);
      // กำหนดระยะเวลาเอง: กรอกจำนวนปี → คำนวณวันหมดอายุ (แก้วันหมดอายุเองได้ — จำนวนปีปรับตามถ้าลงตัว ไม่ลงตัว = ว่าง)
      if (next.billing === "custom") {
        if ("duration_years" in patch || "start_date" in patch || patch.billing === "custom") {
          const calc = licenseExpiryAfter(next.start_date, next.duration_years);
          if (calc) next.expires_at = calc;
        } else if ("expires_at" in patch) next.duration_years = licenseYears(next.start_date, next.expires_at);
      }
      return { ...v, license: next };
    });
    setErrors((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(patch).map((k) => [`license.${k}`, ""])), "license.expires_at": "" }));
  };
  const licErr = (k: keyof LicenseFormValues) => errors[`license.${k}`];
  const licCls = (k: keyof LicenseFormValues) => `${inputBase} ${licErr(k) ? inputError : ""}`;
  const licField = (k: keyof LicenseFormValues, label: string, control: ReactNode, opts: { required?: boolean; hint?: string } = {}) => (
    <div>
      <label htmlFor={`license-${k}`} className="mb-1 block text-sm font-medium">
        {label}
        {opts.required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {licErr(k) ? <p className="mt-1 text-xs font-medium text-red-500">{licErr(k)}</p> : opts.hint && <p className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
  );
  const saving = pending && pendingAction === "save";
  const deleting = pending && pendingAction === "delete";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      {/* ล็อกช่องกรอกระหว่างบันทึก/ลบ ป้องกันการแก้ค่าระหว่างส่งข้อมูล */}
      <fieldset disabled={pending} aria-busy={pending} className="space-y-6 transition-opacity disabled:opacity-60">
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("licenses.form.section")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("license_no", t("assets.form.tag"), input("license_no", { maxLength: 50, placeholder: t("licenses.form.noPlaceholder") }))}
            {field("name", t("licenses.form.name"), input("name", { maxLength: 255 }), true)}
            <div>
              <label htmlFor="license-software_type" className="mb-1 block text-sm font-medium">
                {t("assets.form.category")}
                <span className="text-red-500"> *</span>
              </label>
              <AppSelect id="license-software_type" value={lic.software_type} onValueChange={(v) => setLicense({ software_type: v as SoftwareType })} className={licCls("software_type")}>
                {SOFTWARE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`licenses.types.${s}`)}
                  </option>
                ))}
              </AppSelect>
              {licErr("software_type") && <p className="mt-1 text-xs font-medium text-red-500">{licErr("software_type")}</p>}
            </div>
            {field(
              "status",
              t("assets.form.status"),
              <AppSelect id="status" name="status" value={values.status} onChange={onChange} className={cls("status")}>
                {LICENSE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`licenses.statuses.${s}`)}
                  </option>
                ))}
              </AppSelect>,
            )}
            {field(
              "brand",
              t("assets.form.brand"),
              <OptionPicker
                id="brand"
                options={brands.map((b) => ({ value: b, label: b }))}
                value={values.brand}
                onChange={(v) => setField("brand", v)}
                onAdd={(name) => quickAddOption("brand", name)}
                className={cls("brand")}
              />,
            )}
            {field(
              "model",
              t("assets.form.model"),
              <SuggestInput id="model" value={values.model} onChange={(v) => setField("model", v)} load={(q) => suggestAssetValues("model", q, values.brand)} className={cls("model")} />,
            )}
            {field("serial_number", t("assets.form.serial"), input("serial_number", { maxLength: 100 }))}
            {field(
              "branch_id",
              t("assets.form.branch"),
              <AppSelect id="branch_id" name="branch_id" value={values.branch_id} onChange={onChange} className={cls("branch_id")}>
                <option value="">{t("common.none")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </AppSelect>,
            )}
            {field(
              "location_id",
              t("assets.form.location"),
              <LocationPicker id="location_id" locations={locations} value={values.location_id} onChange={(id) => setField("location_id", id)} className={cls("location_id")} />,
            )}
          </div>
        </section>

                  <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="font-semibold">{t("licenses.form.sectionTerms")}</h2>
            <p className="mb-4 mt-1 text-sm text-muted">{t("assets.license.sectionHint")}</p>
            {errors.license && <p className="mb-3 text-xs font-medium text-red-500">{errors.license}</p>}
            {errors["license.billing"] && <p className="mb-3 text-xs font-medium text-red-500">{errors["license.billing"]}</p>}
            <fieldset className="mb-4">
              <legend className="mb-1 text-sm font-medium">
                {t("assets.license.billing")} <span className="text-red-500">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {LICENSE_BILLINGS.map((b) => (
                  <label
                    key={b}
                    className={`flex cursor-pointer gap-2 rounded-xl p-3 ring-1 transition-colors ${
                      lic.billing === b ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"
                    }`}
                  >
                    <input type="radio" name="license-billing" value={b} checked={lic.billing === b} onChange={() => chooseBilling(b)} className="mt-1 accent-[var(--accent-500)]" />
                    <span>
                      <span className="block text-sm font-medium">{t(`assets.license.billings.${b}`)}</span>
                      <span className="block text-xs text-muted">{t(`assets.license.billingHints.${b}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {licField(
                "start_date",
                t("assets.license.startDate"),
                <DateInput id="license-start_date" value={lic.start_date} onChange={(d) => setLicense({ start_date: d })} className={licCls("start_date")} />,
                { required: true },
              )}
              {lic.billing === "custom" &&
                licField(
                  "duration_years",
                  t("assets.license.durationYears"),
                  <input
                    ref={yearsRef}
                    id="license-duration_years"
                    type="number"
                    min={1}
                    max={LICENSE_MAX_YEARS}
                    step={1}
                    inputMode="numeric"
                    value={lic.duration_years}
                    onChange={(e) => setLicense({ duration_years: e.target.value })}
                    placeholder={t("assets.license.durationYearsPlaceholder")}
                    className={`${licCls("duration_years")} ${yearsPending ? "border-accent-400 ring-2 ring-accent-200 dark:ring-accent-400/30" : ""}`}
                  />,
                  { hint: t("assets.license.durationYearsHint") },
                )}
              {lic.billing !== "perpetual" &&
                licField(
                  "expires_at",
                  t("assets.license.expiresAt"),
                  <DateInput id="license-expires_at" value={lic.expires_at} min={lic.start_date || undefined} onChange={(d) => setLicense({ expires_at: d })} className={licCls("expires_at")} />,
                  { required: true, hint: lic.billing === "yearly" ? t("assets.license.yearlyHint") : undefined },
                )}
              {licField(
                "seats",
                t("assets.license.seats"),
                <input id="license-seats" type="number" min={1} inputMode="numeric" value={lic.seats} onChange={(e) => setLicense({ seats: e.target.value })} className={licCls("seats")} />,
                { hint: t("assets.license.seatsHint") },
              )}
              {licField(
                "vendor",
                t("assets.license.vendor"),
                <input id="license-vendor" maxLength={255} value={lic.vendor} onChange={(e) => setLicense({ vendor: e.target.value })} className={licCls("vendor")} />,
              )}
              {lic.billing !== "perpetual" &&
                licField(
                  "notify_days_before",
                  t("assets.license.notifyDays"),
                  <input
                    id="license-notify_days_before"
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    value={lic.notify_days_before}
                    onChange={(e) => setLicense({ notify_days_before: e.target.value })}
                    className={licCls("notify_days_before")}
                  />,
                  { hint: t("assets.license.notifyDaysHint") },
                )}
              <div className="sm:col-span-2 lg:col-span-3">
                {licField(
                  "license_key",
                  t("assets.license.key"),
                  <PasswordInput
                    id="license-license_key"
                    autoComplete="new-password"
                    maxLength={5000}
                    value={lic.license_key}
                    disabled={lic.clear_license_key}
                    placeholder={hasLicenseKey ? t("assets.license.keyKeepPlaceholder") : undefined}
                    onChange={(e) => setLicense({ license_key: e.target.value })}
                    className={`${licCls("license_key")} font-mono`}
                  />,
                  { hint: t("assets.license.keyHint") },
                )}
                {hasLicenseKey && (
                  <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={lic.clear_license_key}
                      onChange={(e) => setLicense({ clear_license_key: e.target.checked, license_key: "" })}
                      className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                    />
                    {t("assets.license.clearKey")}
                  </label>
                )}
              </div>
            </div>
          </section>

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("licenses.form.sectionPurchase")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("purchase_date", t("assets.form.purchaseDate"), <DateInput id="purchase_date" value={values.purchase_date} max={localToday()} onChange={(d) => setField("purchase_date", d)} className={cls("purchase_date")} />)}
            {field("purchase_cost", t("assets.form.cost"), input("purchase_cost", { type: "number", min: 0, step: "0.01", inputMode: "decimal" }))}
          </div>
          <div className="mt-4">
            {field("notes", t("assets.form.notes"), <textarea id="notes" name="notes" rows={3} maxLength={5000} value={values.notes} onChange={onChange} className={cls("notes")} />)}
          </div>
        </section>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && canDelete && (
          <button type="button" onClick={onDelete} disabled={pending} className={`${btn.danger} sm:mr-auto`}>
            {deleting ? <SpinnerIcon /> : <TrashIcon />}
            {deleting ? t("common.deleting") : t("common.delete")}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/licenses" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : isEdit ? t("assets.form.submitUpdate") : t("licenses.add")}
          </button>
        </div>
      </div>
    </form>
  );
}
