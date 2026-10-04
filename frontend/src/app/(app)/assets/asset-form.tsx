"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createAsset, deleteAsset, updateAsset, type SaveResult } from "@/app/actions/assets";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, TruckIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TFunction } from "@/i18n/types";
import {
  CATEGORIES,
  STATUSES,
  type AssetFormValues,
  type FieldErrors,
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
};

/** ตรวจเบื้องต้นฝั่ง client ให้ผู้ใช้เห็นทันที — Laravel ตรวจซ้ำทุกครั้ง */
function validate(v: AssetFormValues, t: TFunction): FieldErrors {
  const e: FieldErrors = {};
  if (!v.asset_tag.trim()) e.asset_tag = t("assets.validate.tagRequired");
  else if (!/^[A-Za-z0-9\-_/]+$/.test(v.asset_tag.trim())) e.asset_tag = t("assets.validate.tagFormat");
  if (!v.name.trim()) e.name = t("assets.validate.nameRequired");
  if (!v.category) e.category = t("assets.validate.categoryRequired");
  if (v.purchase_cost && (isNaN(Number(v.purchase_cost)) || Number(v.purchase_cost) < 0)) {
    e.purchase_cost = t("assets.validate.costInvalid");
  }
  if (v.purchase_date && v.purchase_date > new Date().toISOString().slice(0, 10)) {
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
}

export function AssetForm({ locations, assetId, initial, initialCustodian = null, canDelete = false }: Props) {
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
    const field = e.target.name as keyof AssetFormValues;
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

  const field = (name: keyof AssetFormValues, label: string, control: ReactNode, required = false, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[name] && <p className="mt-1 text-xs font-medium text-red-500">{errors[name]}</p>}
    </div>
  );

  const cls = (name: keyof AssetFormValues) => `${inputBase} ${errors[name] ? inputError : ""}`;
  const input = (name: keyof AssetFormValues, props: Record<string, unknown> = {}) => (
    <input id={name} name={name} value={values[name]} onChange={onChange} className={cls(name)} {...props} />
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
                    {c}
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
            {field("brand", t("assets.form.brand"), input("brand", { maxLength: 100 }))}
            {field("model", t("assets.form.model"), input("model", { maxLength: 100 }))}
            {field("serial_number", t("assets.form.serial"), input("serial_number", { maxLength: 100 }))}
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

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionPurchase")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field("purchase_date", t("assets.form.purchaseDate"), input("purchase_date", { type: "date" }))}
            {field("purchase_cost", t("assets.form.cost"), input("purchase_cost", { type: "number", min: 0, step: "0.01", inputMode: "decimal" }))}
            {field("warranty_expires_at", t("assets.form.warranty"), input("warranty_expires_at", { type: "date" }))}
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
