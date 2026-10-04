"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createAsset, deleteAsset, suggestAssetValues, updateAsset, type SaveResult } from "@/app/actions/assets";
import { DateInput } from "@/components/date-input";
import { SuggestInput } from "@/components/suggest-input";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, TruckIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey, TFunction } from "@/i18n/types";
import { addToIsoDate, localToday } from "@/lib/date";
import {
  CATEGORIES,
  CATEGORY_FORM,
  LICENSE_BILLINGS,
  STATUSES,
  type AssetFormValues,
  type FieldErrors,
  type LicenseFormValues,
  type Location,
  type UserOption,
} from "@/lib/types";
import { CustodianPicker } from "./custodian-picker";

const EMPTY: AssetFormValues = {
  asset_tag: "",
  name: "",
  category: "",
  brand: "",
  model: "",
  serial_number: "",
  status: "active",
  location_id: "",
  custodian_id: "",
  purchase_date: "",
  purchase_cost: "",
  warranty_expires_at: "",
  notes: "",
  movement_reason: "",
  license: {
    billing: "yearly",
    start_date: "",
    expires_at: "",
    seats: "",
    vendor: "",
    license_key: "",
    clear_license_key: false,
    notify_days_before: "",
  },
};

/** วันหมดอายุของ license รายปี: วันเริ่ม + 1 ปี − 1 วัน */
const yearlyExpiry = (start: string) => (start ? addToIsoDate(start, { years: 1, days: -1 }) : "");

/** ตรวจเบื้องต้นฝั่ง client ให้ผู้ใช้เห็นทันที — API ตรวจซ้ำทุกครั้ง */
function validate(v: AssetFormValues, t: TFunction): FieldErrors {
  const e: FieldErrors = {};
  if (CATEGORY_FORM[v.category]?.license) {
    const l = v.license;
    if (!l.start_date) e["license.start_date"] = t("assets.license.validate.startDate");
    if (l.billing !== "perpetual") {
      if (!l.expires_at) e["license.expires_at"] = t("assets.license.validate.expiresAt");
      else if (l.start_date && l.expires_at < l.start_date) e["license.expires_at"] = t("assets.license.validate.expiresBeforeStart");
    }
    if (l.seats && (!/^\d+$/.test(l.seats) || Number(l.seats) < 1)) e["license.seats"] = t("assets.license.validate.seats");
  }
  if (!v.asset_tag.trim()) e.asset_tag = t("assets.validate.tagRequired");
  else if (!/^[A-Za-z0-9\-_/]+$/.test(v.asset_tag.trim())) e.asset_tag = t("assets.validate.tagFormat");
  if (!v.name.trim()) e.name = t("assets.validate.nameRequired");
  if (!v.category) e.category = t("assets.validate.categoryRequired");
  if (v.purchase_cost && (isNaN(Number(v.purchase_cost)) || Number(v.purchase_cost) < 0)) {
    e.purchase_cost = t("assets.validate.costInvalid");
  }
  if (v.purchase_date && v.purchase_date > localToday()) {
    e.purchase_date = t("assets.validate.purchaseFuture");
  }
  if (v.purchase_date && v.warranty_expires_at && v.warranty_expires_at < v.purchase_date) {
    e.warranty_expires_at = t("assets.validate.warrantyBeforePurchase");
  }
  return e;
}

interface Props {
  locations: Location[];
  /** ไม่ระบุ = โหมดเพิ่มใหม่ */
  assetId?: string;
  initial?: AssetFormValues;
  initialCustodian?: { id: number; name: string } | null;
  canDelete?: boolean;
  /** มี license key เดิมอยู่แล้ว (โหมดแก้ไข) */
  hasLicenseKey?: boolean;
}

export function AssetForm({ locations, assetId, initial, initialCustodian = null, canDelete = false, hasLicenseKey = false }: Props) {
  const { t } = useI18n();
  const [values, setValues] = useState<AssetFormValues>(initial ?? EMPTY);
  const [custodian, setCustodian] = useState(initialCustodian);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  const isEdit = Boolean(assetId);
  // แสดงช่องเหตุผลเมื่อสถานที่/ผู้ถือครองเปลี่ยนจากค่าเดิม (ระบบจะบันทึกประวัติการโอนย้าย)
  const isMoving =
    isEdit && (values.location_id !== initial?.location_id || values.custodian_id !== initial?.custodian_id);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const field = e.target.name as Exclude<keyof AssetFormValues, "license">;
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" })); // ล้าง error ของช่องที่แก้ทันที
  };

  const onCustodianChange = (user: UserOption | null) => {
    setCustodian(user);
    setValues((v) => ({ ...v, custodian_id: user ? String(user.id) : "" }));
    setErrors((prev) => ({ ...prev, custodian_id: "" }));
  };

  const handleResult = (result: SaveResult | undefined) => {
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
    startTransition(async () => {
      handleResult(assetId ? await updateAsset(assetId, values) : await createAsset(values));
    });
  };

  const onDelete = () => {
    if (!assetId || !confirm(t("assets.form.confirmDelete", { tag: values.asset_tag }))) return;
    setPendingAction("delete");
    startTransition(async () => handleResult(await deleteAsset(assetId)));
  };

  type Plain = Exclude<keyof AssetFormValues, "license">;
  const field = (name: Plain, label: string, control: ReactNode, required = false, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
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
  const setField = (name: Exclude<keyof AssetFormValues, "license">, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };
  const dateInput = (name: "purchase_date" | "warranty_expires_at", props: { min?: string; max?: string } = {}) => (
    <DateInput id={name} value={values[name]} onChange={(d) => setField(name, d)} className={cls(name)} {...props} />
  );

  // ---- license (หมวดที่ CATEGORY_FORM กำหนด license: true)
  const form = CATEGORY_FORM[values.category];
  const hidden = (name: keyof AssetFormValues) => form?.hide?.includes(name) ?? false;
  const lic = values.license;
  const setLicense = (patch: Partial<LicenseFormValues>) => {
    setValues((v) => {
      const next = { ...v.license, ...patch };
      // รายปี: คำนวณวันหมดอายุจากวันเริ่มให้อัตโนมัติ (แก้เองได้)
      if (next.billing === "yearly" && ("start_date" in patch || patch.billing === "yearly")) next.expires_at = yearlyExpiry(next.start_date);
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
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionInfo")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("asset_tag", t("assets.form.tag"), input("asset_tag", { maxLength: 50, placeholder: t("assets.form.tagPlaceholder") }), true)}
            {field("name", t("assets.form.name"), input("name", { maxLength: 255 }), true)}
            {field(
              "category",
              t("assets.form.category"),
              <select id="category" name="category" value={values.category} onChange={onChange} className={cls("category")}>
                <option value="">{t("assets.form.chooseCategory")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`assets.categories.${c}` as MessageKey)}
                  </option>
                ))}
              </select>,
              true,
            )}
            {field(
              "status",
              t("assets.form.status"),
              <select id="status" name="status" value={values.status} onChange={onChange} className={cls("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "brand",
              t("assets.form.brand"),
              <SuggestInput id="brand" value={values.brand} onChange={(v) => setField("brand", v)} load={(q) => suggestAssetValues("brand", q)} className={cls("brand")} />,
            )}
            {field(
              "model",
              t("assets.form.model"),
              <SuggestInput
                id="model"
                value={values.model}
                onChange={(v) => setField("model", v)}
                load={(q) => suggestAssetValues("model", q, values.brand)}
                className={cls("model")}
              />,
            )}
            {!hidden("serial_number") && field("serial_number", t("assets.form.serial"), input("serial_number", { maxLength: 100 }))}
            {field(
              "location_id",
              t("assets.form.location"),
              <select id="location_id" name="location_id" value={values.location_id} onChange={onChange} className={cls("location_id")}>
                <option value="">{t("common.none")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "custodian_id",
              t("assets.form.custodian"),
              <CustodianPicker id="custodian_id" value={custodian} onChange={onCustodianChange} className={cls("custodian_id")} />,
              false,
              true,
            )}
            {isMoving && (
              <div className={`sm:col-span-2 ${alert.info}`}>
                <p className="mb-2 flex items-center gap-1.5 text-sm text-accent-800 dark:text-accent-200">
                  <TruckIcon className="shrink-0 text-accent-500" />
                  {t("assets.form.movingNotice")}
                </p>
                {field(
                  "movement_reason",
                  t("assets.form.movementReason"),
                  input("movement_reason", { maxLength: 1000, placeholder: t("assets.form.movementReasonPlaceholder") }),
                )}
              </div>
            )}
          </div>
        </section>

        {form?.license && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="font-semibold">{t("assets.license.section")}</h2>
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
                    <input type="radio" name="license-billing" value={b} checked={lic.billing === b} onChange={() => setLicense({ billing: b })} className="mt-1 accent-[var(--accent-500)]" />
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
                  <input
                    id="license-license_key"
                    type="password"
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
        )}

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionPurchase")}</h2>
          <div className={`grid grid-cols-1 gap-4 ${hidden("warranty_expires_at") ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            {field("purchase_date", t("assets.form.purchaseDate"), dateInput("purchase_date", { max: localToday() }))}
            {field("purchase_cost", t("assets.form.cost"), input("purchase_cost", { type: "number", min: 0, step: "0.01", inputMode: "decimal" }))}
            {!hidden("warranty_expires_at") && field("warranty_expires_at", t("assets.form.warranty"), dateInput("warranty_expires_at"))}
          </div>
          <div className="mt-4">
            {field(
              "notes",
              t("assets.form.notes"),
              <textarea id="notes" name="notes" rows={3} maxLength={5000} value={values.notes} onChange={onChange} className={cls("notes")} />,
            )}
          </div>
        </section>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && canDelete && (
          <button type="button" onClick={onDelete} disabled={pending} className={`${btn.danger} sm:mr-auto`}>
            {deleting ? <SpinnerIcon /> : <TrashIcon />}
            {deleting ? t("common.deleting") : t("assets.form.delete")}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/assets" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : isEdit ? t("assets.form.submitUpdate") : t("assets.form.submitCreate")}
          </button>
        </div>
      </div>
    </form>
  );
}
