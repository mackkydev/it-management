"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createVendor, deleteVendor, updateVendor, type VendorResult } from "@/app/actions/vendors";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vendor, VendorFormValues } from "@/lib/types";

type Field = keyof VendorFormValues;
type Errors = Partial<Record<Field | "vendor", string>>;

const REQUIRED: Field[] = ["name", "address", "contact_name", "contact_phone", "vendor_type"];

/** เพิ่ม / แก้ไข Vendor — เลขผู้เสียภาษีไม่บังคับ นอกนั้นบังคับ */
export function VendorForm({ vendor, types, canDelete = false }: { vendor?: Vendor; types: string[]; canDelete?: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [values, setValues] = useState<VendorFormValues>({
    name: vendor?.name ?? "",
    tax_id: vendor?.tax_id ?? "",
    address: vendor?.address ?? "",
    contact_name: vendor?.contact_name ?? "",
    contact_phone: vendor?.contact_phone ?? "",
    vendor_type: vendor?.vendor_type ?? "",
    is_active: vendor?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const name = e.target.name as Field;
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handle = (r: VendorResult | undefined) => {
    if (!r) return;
    setErrors((r.errors ?? {}) as Errors);
    setMessage(r.errors?.vendor ?? r.message ?? "");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    for (const f of REQUIRED) if (!String(values[f]).trim()) found[f] = t("vendors.validate.required");
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");
    setPendingAction("save");
    startTransition(async () => handle(vendor ? await updateVendor(vendor.id, values) : await createVendor(values)));
  };

  const onDelete = async () => {
    if (!vendor || !(await confirm(t("vendors.form.confirmDelete", { name: vendor.name })))) return;
    setPendingAction("delete");
    startTransition(async () => handle(await deleteVendor(vendor.id)));
  };

  const cls = (f: Field) => `${input} ${errors[f] ? inputError : ""}`;
  const field = (f: Field, label: string, control: ReactNode, required = false, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={f} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[f] && <p className="mt-1 text-xs font-medium text-red-500">{errors[f]}</p>}
    </div>
  );
  const saving = pending && pendingAction === "save";
  const deleting = pending && pendingAction === "delete";
  const deletable = vendor && vendor.repairs_count === 0;
  // ประเภทที่ถูกปิดใช้งานไปแล้วยังแสดงในรายการของ Vendor ที่ใช้อยู่
  const typeOptions = [...new Set([...types, ...(vendor?.vendor_type ? [vendor.vendor_type] : [])])];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      <fieldset disabled={pending} aria-busy={pending} className={`p-4 transition-opacity disabled:opacity-60 sm:p-6 ${card}`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("name", t("vendors.form.name"), <input id="name" name="name" value={values.name} onChange={onChange} maxLength={255} className={cls("name")} />, true)}
          {field(
            "vendor_type",
            t("vendors.form.type"),
            <AppSelect id="vendor_type" name="vendor_type" value={values.vendor_type} onChange={onChange} className={cls("vendor_type")}>
              <option value="">{t("vendors.form.chooseType")}</option>
              {typeOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </AppSelect>,
            true,
          )}
          {field("tax_id", t("vendors.form.taxId"), <input id="tax_id" name="tax_id" value={values.tax_id} onChange={onChange} maxLength={20} inputMode="numeric" className={cls("tax_id")} />)}
          <div className="hidden sm:block" aria-hidden="true" />
          {field("contact_name", t("vendors.form.contactName"), <input id="contact_name" name="contact_name" value={values.contact_name} onChange={onChange} maxLength={255} className={cls("contact_name")} />, true)}
          {field("contact_phone", t("vendors.form.contactPhone"), <input id="contact_phone" name="contact_phone" value={values.contact_phone} onChange={onChange} maxLength={50} inputMode="tel" className={cls("contact_phone")} />, true)}
          {field("address", t("vendors.form.address"), <textarea id="address" name="address" rows={3} maxLength={2000} value={values.address} onChange={onChange} className={cls("address")} />, true, true)}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-subtle p-3 sm:col-span-2">
            <input type="checkbox" name="is_active" checked={values.is_active} onChange={onChange} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
            <span>
              <span className="block text-sm font-medium">{t("vendors.form.active")}</span>
              <span className="block text-xs text-muted">{t("vendors.form.activeHint")}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {vendor && canDelete && (
          <div className="sm:mr-auto">
            <button type="button" onClick={onDelete} disabled={pending || !deletable} className={`${btn.danger} disabled:cursor-not-allowed`}>
              {deleting ? <SpinnerIcon /> : <TrashIcon />}
              {deleting ? t("common.deleting") : t("common.delete")}
            </button>
            {!deletable && <p className="mt-1 text-xs text-muted">{t("vendors.form.deleteBlocked")}</p>}
          </div>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/vendors" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 disabled:cursor-not-allowed sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
