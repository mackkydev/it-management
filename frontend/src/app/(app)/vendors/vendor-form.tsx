"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createVendor, deleteVendor, updateVendor, type VendorResult } from "@/app/actions/vendors";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { DocumentPicker } from "@/components/file-pickers";
import { AlertIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vendor, VendorFormValues } from "@/lib/types";

type Field = keyof VendorFormValues;
type Errors = Partial<Record<Field | "vendor" | "files", string>>;

const REQUIRED: Field[] = ["name", "address", "contact_name", "contact_phone", "vendor_type"];
const FILES_MAX = 10;

/** เพิ่ม / แก้ไข Vendor ในกล่อง — เลขผู้เสียภาษี ลิงก์แผนที่ และเอกสารไม่บังคับ นอกนั้นบังคับ */
function VendorForm({ vendor, types, onClose, busyChange }: { vendor?: Vendor; types: string[]; onClose: () => void; busyChange: (busy: boolean) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [values, setValues] = useState<VendorFormValues>({
    name: vendor?.name ?? "",
    tax_id: vendor?.tax_id ?? "",
    address: vendor?.address ?? "",
    contact_name: vendor?.contact_name ?? "",
    contact_phone: vendor?.contact_phone ?? "",
    vendor_type: vendor?.vendor_type ?? "",
    map_url: vendor?.map_url ?? "",
    is_active: vendor?.is_active ?? true,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
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

  const run = (action: "save" | "delete", done: string, call: () => Promise<VendorResult>) => {
    setPendingAction(action);
    busyChange(true);
    startTransition(async () => {
      const r = await call();
      busyChange(false);
      if (r.ok) {
        toast("success", done);
        onClose();
        return router.refresh();
      }
      setErrors((r.errors ?? {}) as Errors);
      setMessage(r.errors?.vendor ?? r.message ?? t("common.saveFailed"));
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    for (const f of REQUIRED) if (!String(values[f]).trim()) found[f] = t("vendors.validate.required");
    if (values.map_url.trim() && !/^https?:\/\/\S+$/i.test(values.map_url.trim())) found.map_url = t("vendors.validate.mapUrl");
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) if (k !== "is_active") fd.set(k, String(v).trim());
    fd.set("is_active", values.is_active ? "1" : "0");
    files.forEach((f) => fd.append("files[]", f));
    removed.forEach((id) => fd.append("remove_file_ids[]", String(id)));
    run("save", t(vendor ? "vendors.saved.updated" : "vendors.saved.created"), () => (vendor ? updateVendor(vendor.id, fd) : createVendor(fd)));
  };

  const onDelete = async () => {
    if (!vendor || !(await confirm(t("vendors.form.confirmDelete", { name: vendor.name }), { danger: true }))) return;
    run("delete", t("vendors.saved.deleted"), () => deleteVendor(vendor.id));
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
  const existing = vendor?.files.filter((f) => !removed.includes(f.id)) ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      <fieldset disabled={pending} aria-busy={pending} className="grid grid-cols-1 gap-4 transition-opacity disabled:opacity-60 sm:grid-cols-2">
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
        {field("contact_name", t("vendors.form.contactName"), <input id="contact_name" name="contact_name" value={values.contact_name} onChange={onChange} maxLength={255} className={cls("contact_name")} />, true)}
        {field("contact_phone", t("vendors.form.contactPhone"), <input id="contact_phone" name="contact_phone" value={values.contact_phone} onChange={onChange} maxLength={50} inputMode="tel" className={cls("contact_phone")} />, true)}
        {field("tax_id", t("vendors.form.taxId"), <input id="tax_id" name="tax_id" value={values.tax_id} onChange={onChange} maxLength={20} inputMode="numeric" className={cls("tax_id")} />)}
        {field("map_url", t("vendors.form.mapUrl"), <input id="map_url" name="map_url" value={values.map_url} onChange={onChange} maxLength={1000} inputMode="url" placeholder={t("vendors.form.mapUrlPlaceholder")} className={cls("map_url")} />)}
        {field("address", t("vendors.form.address"), <textarea id="address" name="address" rows={3} maxLength={2000} value={values.address} onChange={onChange} className={cls("address")} />, true, true)}
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">{t("vendors.form.files")}</p>
          {existing.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {existing.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                  <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                    {f.name}
                  </a>
                  <button type="button" onClick={() => setRemoved((x) => [...x, f.id])} aria-label={t("vendors.form.removeFile", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500">
                    <XIcon width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DocumentPicker files={files} onChange={(f) => (setFiles(f), setMessage(""))} max={FILES_MAX} onError={setMessage} />
          {errors.files && <p className="mt-1 text-xs font-medium text-red-500">{errors.files}</p>}
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-subtle p-3 sm:col-span-2">
          <input type="checkbox" name="is_active" checked={values.is_active} onChange={onChange} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          <span>
            <span className="block text-sm font-medium">{t("vendors.form.active")}</span>
            <span className="block text-xs text-muted">{t("vendors.form.activeHint")}</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {vendor && (
          <div className="sm:mr-auto">
            <button type="button" onClick={onDelete} disabled={pending || !deletable} className={`${btn.danger} disabled:cursor-not-allowed`}>
              {deleting ? <SpinnerIcon /> : <TrashIcon />}
              {deleting ? t("common.deleting") : t("common.delete")}
            </button>
            {!deletable && <p className="mt-1 text-xs text-muted">{t("vendors.form.deleteBlocked")}</p>}
          </div>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <button type="button" onClick={onClose} disabled={pending} className={`${btn.secondary} flex-1 disabled:cursor-not-allowed sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 disabled:cursor-not-allowed sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </form>
  );
}

/** ปุ่ม "เพิ่ม Vendor" (ไม่ส่ง vendor) / "แก้ไข" — เปิดฟอร์มในกล่องแบบกว้าง */
export function VendorButton({ vendor, types }: { vendor?: Vendor; types: string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {vendor ? (
        <button type="button" onClick={() => setOpen(true)} className={`${btn.soft} ${btn.sm}`}>
          <PencilIcon width={13} height={13} />
          {t("common.edit")}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={btn.primary}>
          <PlusIcon />
          {t("vendors.add")}
        </button>
      )}
      {open && (
        <ModalShell id="vendor-form" size="wide" title={t(vendor ? "vendors.editTitle" : "vendors.add")} subtitle={vendor?.name} onClose={() => setOpen(false)} busy={busy}>
          <VendorForm vendor={vendor} types={types} onClose={() => setOpen(false)} busyChange={setBusy} />
        </ModalShell>
      )}
    </>
  );
}
