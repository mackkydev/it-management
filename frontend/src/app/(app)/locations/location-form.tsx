"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createLocation, deleteLocation, updateLocation, type LocationResult } from "@/app/actions/locations";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TFunction } from "@/i18n/types";
import { LOCATION_TYPES, type Location, type LocationFormValues } from "@/lib/types";
import { AppSelect } from "@/components/app-select";

type Field = keyof LocationFormValues;
type Errors = Partial<Record<Field, string>>;

const EMPTY: LocationFormValues = { code: "", name: "", type: "", parent_id: "", address: "", is_active: true };

function validate(v: LocationFormValues, t: TFunction): Errors {
  const e: Errors = {};
  if (!v.code.trim()) e.code = t("locations.validate.codeRequired");
  else if (!/^[A-Za-z0-9\-_/]+$/.test(v.code.trim())) e.code = t("locations.validate.codeFormat");
  if (!v.name.trim()) e.name = t("locations.validate.nameRequired");
  if (!v.type) e.type = t("locations.validate.typeRequired");
  return e;
}

/** id ของสถานที่ตัวเองและสถานที่ย่อยทั้งหมด — ห้ามเลือกเป็น "อยู่ภายใต้" (กันโครงสร้างวนซ้ำ) */
function selfAndDescendants(all: Location[], id: number): Set<number> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of all) {
      if (l.parent_id !== null && out.has(l.parent_id) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

interface Props {
  locations: Location[];
  /** ไม่ระบุ = เพิ่มใหม่ */
  location?: Location;
  canDelete?: boolean;
}

export function LocationForm({ locations, location, canDelete = false }: Props) {
  const { t } = useI18n();
  const [values, setValues] = useState<LocationFormValues>(
    location
      ? {
          code: location.code,
          name: location.name,
          type: location.type,
          parent_id: location.parent_id ? String(location.parent_id) : "",
          address: location.address ?? "",
          is_active: location.is_active ?? true,
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);

  const blocked = location ? selfAndDescendants(locations, location.id) : new Set<number>();
  const parents = locations.filter((l) => !blocked.has(l.id));
  const deletable = location && (location.assets_count ?? 0) === 0 && (location.children_count ?? 0) === 0;

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const name = e.target.name as Field;
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handle = (r: LocationResult | undefined) => {
    if (!r) return;
    setErrors((r.errors ?? {}) as Errors);
    setMessage(r.message ?? "");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, t);
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");
    setPendingAction("save");
    startTransition(async () => handle(location ? await updateLocation(location.id, values) : await createLocation(values)));
  };

  const onDelete = () => {
    if (!location || !confirm(t("locations.form.confirmDelete", { code: location.code }))) return;
    setPendingAction("delete");
    startTransition(async () => handle(await deleteLocation(location.id)));
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

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      <fieldset disabled={pending} aria-busy={pending} className={`p-4 transition-opacity disabled:opacity-60 sm:p-6 ${card}`}>
        <h2 className="mb-4 font-semibold">{t("locations.form.section")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(
            "code",
            t("locations.form.code"),
            <input id="code" name="code" value={values.code} onChange={onChange} maxLength={50} placeholder={t("locations.form.codePlaceholder")} className={`${cls("code")} font-mono`} />,
            true,
          )}
          {field("name", t("locations.form.name"), <input id="name" name="name" value={values.name} onChange={onChange} maxLength={255} className={cls("name")} />, true)}
          {field(
            "type",
            t("locations.form.type"),
            <AppSelect id="type" name="type" value={values.type} onChange={onChange} className={cls("type")}>
              <option value="">{t("locations.form.chooseType")}</option>
              {LOCATION_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`locations.types.${ty}`)}
                </option>
              ))}
            </AppSelect>,
            true,
          )}
          {field(
            "parent_id",
            t("locations.form.parent"),
            <AppSelect id="parent_id" name="parent_id" value={values.parent_id} onChange={onChange} className={cls("parent_id")}>
              <option value="">{t("locations.form.noParent")}</option>
              {parents.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                  {l.is_active === false ? ` (${t("locations.inactive")})` : ""}
                </option>
              ))}
            </AppSelect>,
          )}
          {field(
            "address",
            t("locations.form.address"),
            <textarea id="address" name="address" rows={2} maxLength={2000} value={values.address} onChange={onChange} className={cls("address")} />,
            false,
            true,
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-subtle p-3 sm:col-span-2">
            <input
              type="checkbox"
              name="is_active"
              checked={values.is_active}
              onChange={onChange}
              className="mt-0.5 h-4 w-4 accent-[var(--accent-500)]"
            />
            <span>
              <span className="block text-sm font-medium">{t("locations.form.active")}</span>
              <span className="block text-xs text-muted">{t("locations.form.activeHint")}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {location && canDelete && (
          <div className="sm:mr-auto">
            <button type="button" onClick={onDelete} disabled={pending || !deletable} className={btn.danger}>
              {deleting ? <SpinnerIcon /> : <TrashIcon />}
              {deleting ? t("common.deleting") : t("locations.form.delete")}
            </button>
            {!deletable && <p className="mt-1 text-xs text-muted">{t("locations.form.deleteBlocked")}</p>}
          </div>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/locations" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : location ? t("locations.form.submitUpdate") : t("locations.form.submitCreate")}
          </button>
        </div>
      </div>
    </form>
  );
}
