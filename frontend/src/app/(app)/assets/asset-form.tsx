"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createAsset, deleteAsset, loadSoftwareOptions, suggestAssetValues, updateAsset, type SaveResult } from "@/app/actions/assets";
import { DateInput } from "@/components/date-input";
import { SuggestInput } from "@/components/suggest-input";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, TruckIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey, TFunction } from "@/i18n/types";
import { addToIsoDate, LICENSE_MAX_YEARS, licenseExpiryAfter, licenseYears, localToday } from "@/lib/date";
import {
  CATEGORIES,
  COMPUTER_DATE_FIELDS,
  COMPUTER_TEXT_FIELDS,
  COMPUTER_TYPES,
  CATEGORY_FORM,
  EMPTY_SOFTWARE,
  LICENSE_BILLINGS,
  SOFTWARE_SLOTS,
  STATUSES,
  type AssetFormValues,
  type Branch,
  type FieldErrors,
  type LicenseFormValues,
  type Location,
  type SoftwareOption,
  type SoftwareRef,
  type SoftwareSlot,
  type UserOption,
} from "@/lib/types";
import { SoftwareListPicker, SoftwareSlotPicker } from "./software-picker";
import { CustodianPicker } from "./custodian-picker";
import { LocationPicker } from "./location-picker";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { PasswordInput } from "@/components/password-input";

type ComputerField = (typeof COMPUTER_TEXT_FIELDS)[number] | (typeof COMPUTER_DATE_FIELDS)[number];

const EMPTY: AssetFormValues = {
  asset_tag: "",
  name: "",
  // ใช้ทำทะเบียนคอมพิวเตอร์เป็นหลัก
  category: "COMPUTER",
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
  branch_id: "",
  ...(Object.fromEntries([...COMPUTER_TEXT_FIELDS, ...COMPUTER_DATE_FIELDS].map((k) => [k, ""])) as Record<ComputerField, string>),
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
    duration_years: "",
  },
  software: EMPTY_SOFTWARE,
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
    if (l.billing === "custom" && l.duration_years && !licenseExpiryAfter(l.start_date || "2000-01-01", l.duration_years)) {
      e["license.duration_years"] = t("assets.license.validate.durationYears", { max: LICENSE_MAX_YEARS });
    }
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
  branches: Branch[];
  /** ไม่ระบุ = โหมดเพิ่มใหม่ */
  assetId?: string;
  initial?: AssetFormValues;
  initialCustodian?: { id: number; name: string } | null;
  canDelete?: boolean;
  /** มี license key เดิมอยู่แล้ว (โหมดแก้ไข) */
  hasLicenseKey?: boolean;
  /** โหมดเพิ่มใหม่: หมวดเริ่มต้น (เช่น ?category=SOFTWARE จากปุ่มเพิ่ม License ในช่อง Software) */
  defaultCategory?: string;
}

export function AssetForm({ locations, branches, assetId, initial, initialCustodian = null, canDelete = false, hasLicenseKey = false, defaultCategory }: Props) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [values, setValues] = useState<AssetFormValues>(initial ?? (defaultCategory ? { ...EMPTY, category: defaultCategory } : EMPTY));
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
    const field = e.target.name as Exclude<keyof AssetFormValues, "license" | "software">;
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" })); // ล้าง error ของช่องที่แก้ทันที
  };

  const onLocationChange = (id: string) => {
    setValues((v) => ({ ...v, location_id: id }));
    setErrors((prev) => ({ ...prev, location_id: "" }));
  };

  // ---- ซอฟต์แวร์บนเครื่อง (หมวดคอมพิวเตอร์): เลือกจาก license — โหลดตัวเลือกใหม่เมื่อกลับมาที่แท็บ (เผื่อเพิ่ม License ในแท็บใหม่)
  const [swOptions, setSwOptions] = useState<SoftwareOption[] | null>(null);
  const isComputer = Boolean(CATEGORY_FORM[values.category]?.computer);
  useEffect(() => {
    if (!isComputer) return;
    let alive = true;
    const load = () => loadSoftwareOptions().then((o) => alive && setSwOptions(o));
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [isComputer]);
  // license ที่ติดตั้งบนเครื่องนี้อยู่แล้ว — เลือกซ้ำได้แม้ seat เต็ม
  const installedIds = initial ? [...SOFTWARE_SLOTS.map((k) => initial.software[k]?.id), ...initial.software.others.map((o) => o.id)].filter((x): x is string => Boolean(x)) : [];
  const chosenIds = (except?: SoftwareSlot) =>
    [...SOFTWARE_SLOTS.filter((k) => k !== except).map((k) => values.software[k]?.id), ...(except ? values.software.others.map((o) => o.id) : [])].filter((x): x is string => Boolean(x));
  const setSlot = (slot: SoftwareSlot, ref: SoftwareRef | null) => {
    // เลือก/ล้าง = ไม่ใช้ข้อความเดิม (ค่าที่ยังไม่ผูก) อีก
    setValues((v) => ({ ...v, [slot]: "", software: { ...v.software, [slot]: ref } }));
    setErrors((prev) => ({ ...prev, [`software.${slot}`]: "", [slot]: "" }));
  };
  const setOthers = (others: SoftwareRef[]) => {
    setValues((v) => ({ ...v, software: { ...v.software, others } }));
    setErrors((prev) => ({ ...prev, "software.others": "" }));
  };
  const slotField = (slot: SoftwareSlot, label: string) => {
    const err = errors[`software.${slot}`] || errors[slot];
    return (
      <div>
        <label htmlFor={`software-${slot}`} className="mb-1 block text-sm font-medium">
          {label}
        </label>
        <SoftwareSlotPicker
          id={`software-${slot}`}
          options={swOptions}
          value={values.software[slot]}
          legacy={values[slot]}
          exclude={chosenIds(slot)}
          installed={installedIds}
          onChange={(ref) => setSlot(slot, ref)}
          onClearLegacy={() => setSlot(slot, null)}
          className={`${inputBase} ${err ? inputError : ""}`}
        />
        {err && <p className="mt-1 text-xs font-medium text-red-500">{err}</p>}
      </div>
    );
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

  const onDelete = async () => {
    if (!assetId || !(await confirm(t("assets.form.confirmDelete", { tag: values.asset_tag })))) return;
    setPendingAction("delete");
    startTransition(async () => handleResult(await deleteAsset(assetId)));
  };

  type Plain = Exclude<keyof AssetFormValues, "license" | "software">;
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
  const setField = (name: Plain, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };
  const dateInput = (name: "purchase_date" | "warranty_expires_at" | (typeof COMPUTER_DATE_FIELDS)[number], props: { min?: string; max?: string } = {}) => (
    <DateInput id={name} value={values[name]} onChange={(d) => setField(name, d)} className={cls(name)} {...props} />
  );

  // ---- license (หมวดที่ CATEGORY_FORM กำหนด license: true)
  const form = CATEGORY_FORM[values.category];
  const hidden = (name: keyof AssetFormValues) => form?.hide?.includes(name) ?? false;
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
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionInfo")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* หมวด COMPUTER: รหัสสินทรัพย์ = Host Name */}
            {field(
              "asset_tag",
              form?.computer ? t("assets.computer.hostName") : t("assets.form.tag"),
              input("asset_tag", { maxLength: 50, placeholder: form?.computer ? "LPPCPRD001" : t("assets.form.tagPlaceholder") }),
              true,
            )}
            {field("name", t("assets.form.name"), input("name", { maxLength: 255, placeholder: form?.computer ? t("assets.computer.namePlaceholder") : undefined }), true)}
            {field(
              "category",
              t("assets.form.category"),
              <AppSelect id="category" name="category" value={values.category} onChange={onChange} className={cls("category")}>
                <option value="">{t("assets.form.chooseCategory")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`assets.categories.${c}` as MessageKey)}
                  </option>
                ))}
              </AppSelect>,
              true,
            )}
            {field(
              "status",
              t("assets.form.status"),
              <AppSelect id="status" name="status" value={values.status} onChange={onChange} className={cls("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </AppSelect>,
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
              <LocationPicker id="location_id" locations={locations} value={values.location_id} onChange={onLocationChange} className={cls("location_id")} />,
            )}
            {field(
              "custodian_id",
              t("assets.form.custodian"),
              <CustodianPicker id="custodian_id" value={custodian} onChange={onCustodianChange} className={cls("custodian_id")} />,
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

        {/* ข้อมูลเครื่องคอมพิวเตอร์ — ช่องตามทะเบียน Excel ของฝ่าย IT */}
        {form?.computer && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="font-semibold">{t("assets.computer.section")}</h2>
            <p className="mb-4 mt-1 text-sm text-muted">{t("assets.computer.sectionHint")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field("department", t("assets.computer.department"), input("department", { maxLength: 100 }))}
              {field("user_name", t("assets.computer.userName"), input("user_name", { maxLength: 255 }))}
              {field(
                "computer_type",
                t("assets.computer.computerType"),
                <AppSelect id="computer_type" name="computer_type" value={values.computer_type} onChange={onChange} className={cls("computer_type")}>
                  <option value="">{t("common.none")}</option>
                  {/* ค่าจาก Excel ที่ไม่อยู่ในรายการยังแสดงได้ */}
                  {[...COMPUTER_TYPES, ...(values.computer_type && !COMPUTER_TYPES.includes(values.computer_type) ? [values.computer_type] : [])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </AppSelect>,
              )}
              {field("received_date", t("assets.computer.receivedDate"), dateInput("received_date"))}
              {field("start_use_date", t("assets.computer.startUseDate"), dateInput("start_use_date"))}
              {field("work_group", t("assets.computer.workGroup"), input("work_group", { maxLength: 50, placeholder: "LAMPHUN" }))}
              {field("ip_address", t("assets.computer.ip"), input("ip_address", { maxLength: 45, placeholder: "192.168.4.36", className: `${cls("ip_address")} font-mono` }))}
              {field("mac_address", t("assets.computer.mac"), input("mac_address", { maxLength: 50, placeholder: "A0:36:BC:25:1C:5C", className: `${cls("mac_address")} font-mono` }))}
              {field("monitor_tag", t("assets.computer.monitorTag"), input("monitor_tag", { maxLength: 255, className: `${cls("monitor_tag")} font-mono` }))}
              {/* แถวเครื่อง: IP / MAC / Monitor — แถวซอฟต์แวร์: OS / Office / Anti Virus = license ที่ติดตั้งบนเครื่องนี้ (Email 365 ไม่แสดงในฟอร์ม — ค่าเดิมยังเก็บไว้) */}
              {slotField("os", t("assets.computer.os"))}
              {slotField("office", t("assets.computer.office"))}
              {slotField("antivirus", t("assets.computer.antivirus"))}
              {field("notebook_tag", t("assets.computer.notebookTag"), input("notebook_tag", { maxLength: 100, className: `${cls("notebook_tag")} font-mono` }))}
              {field("cpu_tag", t("assets.computer.cpuTag"), input("cpu_tag", { maxLength: 100, className: `${cls("cpu_tag")} font-mono` }))}
              {/* Software อื่นๆ (หลายรายการ) — เลือกจาก license เหมือน OS / Office */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="software-others" className="mb-1 block text-sm font-medium">
                  {t("assets.computer.otherSoftware")}
                </label>
                <SoftwareListPicker
                  id="software-others"
                  options={swOptions}
                  value={values.software.others}
                  exclude={chosenIds()}
                  installed={installedIds}
                  onChange={setOthers}
                  className={`${inputBase} ${errors["software.others"] ? inputError : ""}`}
                />
                {errors["software.others"] ? (
                  <p className="mt-1 text-xs font-medium text-red-500">{errors["software.others"]}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">{t("assets.software.otherHint")}</p>
                )}
              </div>
            </div>
          </section>
        )}

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
