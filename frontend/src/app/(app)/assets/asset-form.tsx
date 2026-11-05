"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createAsset, deleteAsset, loadSoftwareOptions, suggestAssetTags, suggestAssetValues, updateAsset, type SaveResult } from "@/app/actions/assets";
import { DateInput } from "@/components/date-input";
import { SuggestInput, type SuggestItem } from "@/components/suggest-input";
import { Tooltip } from "@/components/tooltip";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, TruckIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TFunction } from "@/i18n/types";
import { localToday } from "@/lib/date";
import {
  assetCategoryLabel,
  COMPUTER_DATE_FIELDS,
  COMPUTER_TEXT_FIELDS,
  CATEGORY_FORM,
  EMPTY_SOFTWARE,
  SOFTWARE_SLOTS,
  STATUSES,
  type AssetFormValues,
  type Branch,
  type FieldErrors,
  type Location,
  type SoftwareOption,
  type SoftwareRef,
  type SoftwareSlot,
  type UserOption,
} from "@/lib/types";
import { SoftwareListPicker, SoftwareSlotPicker } from "./software-picker";
import { CustodianPicker } from "./custodian-picker";
import { LocationPicker } from "./location-picker";
import { OptionPicker } from "@/components/option-picker";
import { quickAddOption } from "@/app/actions/dropdowns";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";

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
  is_shared: false,
  purchase_date: "",
  purchase_cost: "",
  warranty_expires_at: "",
  notes: "",
  branch_id: "",
  is_loanable: false,
  ...(Object.fromEntries([...COMPUTER_TEXT_FIELDS, ...COMPUTER_DATE_FIELDS].map((k) => [k, ""])) as Record<ComputerField, string>),
  movement_reason: "",
  software: EMPTY_SOFTWARE,
};

/** เพิ่มใหม่ / เปลี่ยนหมวด / เดิมมีเลขอยู่แล้ว = ต้องมีเลขที่ทรัพย์สิน — คอมพิวเตอร์เดิมที่ยังไม่มีเลขไม่บังคับ */
const numberRequired = (v: AssetFormValues, initial?: AssetFormValues) =>
  !(initial && initial.category === v.category && CATEGORY_FORM[v.category]?.computer && !initial.cpu_tag.trim());

/** ตรวจเบื้องต้นฝั่ง client ให้ผู้ใช้เห็นทันที — API ตรวจซ้ำทุกครั้ง */
function validate(v: AssetFormValues, t: TFunction, initial?: AssetFormValues): FieldErrors {
  const e: FieldErrors = {};
  const computer = Boolean(CATEGORY_FORM[v.category]?.computer);
  // คอมพิวเตอร์: asset_tag = Host Name, เลขที่ทรัพย์สิน = cpu_tag (เครื่องเดิมที่ยังไม่มีเลข แก้ช่องอื่นได้โดยไม่บังคับ)
  if (!v.asset_tag.trim()) e.asset_tag = t(computer ? "assets.validate.hostRequired" : "assets.validate.tagRequired");
  else if (!/^[A-Za-z0-9\-_/]+$/.test(v.asset_tag.trim())) e.asset_tag = t(computer ? "assets.validate.hostFormat" : "assets.validate.tagFormat");
  if (computer && !v.cpu_tag.trim() && numberRequired(v, initial)) e.cpu_tag = t("assets.validate.tagRequired");
  if (!v.name.trim()) e.name = t("assets.validate.nameRequired");
  if (!v.category) e.category = t("assets.validate.categoryRequired");
  if (v.is_shared && !v.branch_id) e.branch_id = t("assets.validate.sharedBranch");
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
  /** ข้อมูล Drop Down (ข้อมูลหลัก) */
  computerTypes: string[];
  /** สเปคคอมพิวเตอร์ (ข้อมูล Drop Down computer_spec) */
  computerSpecs: string[];
  brands: string[];
  /** หมวดหมู่ที่แก้ได้ (ข้อมูล Drop Down asset_category) */
  categories: string[];
  /** ชื่อแผนกจากข้อมูลหลัก */
  departments: string[];
  /** ไม่ระบุ = โหมดเพิ่มใหม่ */
  assetId?: string;
  initial?: AssetFormValues;
  initialCustodian?: { id: number; name: string } | null;
  canDelete?: boolean;
  /** โหมดเพิ่มใหม่: หมวดเริ่มต้น (?category=) */
  defaultCategory?: string;
  /** โหมดเพิ่มใหม่: ค่าเริ่มต้น (เช่น เลขที่ทรัพย์สิน + ชื่อเครื่องจากใบแจ้งซ่อม) */
  prefill?: Partial<Pick<AssetFormValues, "cpu_tag" | "name" | "source_asset_no">>;
}

export function AssetForm({
  locations,
  branches,
  computerTypes,
  computerSpecs,
  brands,
  categories,
  departments,
  assetId,
  initial,
  initialCustodian = null,
  canDelete = false,
  defaultCategory,
  prefill,
}: Props) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [values, setValues] = useState<AssetFormValues>(
    initial ??
      (defaultCategory
        ? { ...EMPTY, ...prefill, category: defaultCategory }
        : { ...EMPTY, ...prefill }),
  );
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
    const field = e.target.name as Exclude<keyof AssetFormValues, "license" | "software" | "is_loanable" | "is_shared" | "source_asset_no">;
    setValues((v) => {
      const next = { ...v, [field]: e.target.value };
      // เปลี่ยนหมวด: เลขที่ทรัพย์สินในช่องบนสุดคงเดิม — คอมพิวเตอร์เก็บที่ cpu_tag, หมวดอื่นเก็บที่ asset_tag
      if (field === "category") {
        const was = Boolean(CATEGORY_FORM[v.category]?.computer);
        const now = Boolean(CATEGORY_FORM[next.category]?.computer);
        if (was && !now) Object.assign(next, { asset_tag: v.cpu_tag.slice(0, 50), cpu_tag: "" });
        if (!was && now) Object.assign(next, { cpu_tag: v.asset_tag, asset_tag: "" });
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: "", ...(field === "category" ? { asset_tag: "", cpu_tag: "" } : {}) })); // ล้าง error ของช่องที่แก้ทันที
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
          softwareType={slot}
          className={`${inputBase} ${err ? inputError : ""}`}
        />
        {err && <p className="mt-1 text-xs font-medium text-red-500">{err}</p>}
      </div>
    );
  };

  // ---- เลขที่ทรัพย์สิน Monitor: ค้นจากทะเบียนสินทรัพย์ (พิมพ์เองได้เหมือนเดิม)
  const loadMonitorTags = async (q: string): Promise<SuggestItem[]> =>
    (await suggestAssetTags(q)).map((a) => ({ value: a.asset_tag, hint: [a.name, [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") }));

  // ผู้ถือครอง = ผู้ใช้งาน: เลือกแล้วเติมชื่อ-สกุลผู้ใช้งาน + Department ให้ (API บันทึกชื่อผู้ใช้งานตามผู้ถือครองเสมอ)
  const onCustodianChange = (user: UserOption | null) => {
    setCustodian(user);
    const dept = user?.department?.trim();
    setValues((v) => ({ ...v, custodian_id: user ? String(user.id) : "", ...(user ? { user_name: user.name, ...(dept ? { department: dept.slice(0, 100) } : {}) } : {}) }));
    setErrors((prev) => ({ ...prev, custodian_id: "", user_name: "" }));
  };

  // ส่วนกลาง: ถือครองโดยสาขา/แผนก — ไม่มีผู้ถือครองที่เป็นผู้ใช้ (ต้องเลือกสาขา)
  const onSharedChange = (shared: boolean) => {
    setCustodian(null);
    setValues((v) => ({ ...v, is_shared: shared, custodian_id: "", user_name: "" }));
    setErrors((prev) => ({ ...prev, custodian_id: "", user_name: "", branch_id: "" }));
  };
  const branchName = branches.find((b) => String(b.id) === values.branch_id)?.name;

  const handleResult = (result: SaveResult | undefined) => {
    // สำเร็จ = server action redirect ไปหน้ารายการ จึงมาถึงตรงนี้เฉพาะกรณีผิดพลาด
    if (!result) return;
    setErrors(result.errors ?? {});
    setMessage(result.message ?? "");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, t, initial);
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

  type Plain = Exclude<keyof AssetFormValues, "license" | "software" | "is_loanable" | "is_shared" | "source_asset_no">;
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

  const form = CATEGORY_FORM[values.category];
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
      {values.source_asset_no && <p className={alert.info}>{t("assets.form.sourceLinked", { no: values.source_asset_no })}</p>}
      <fieldset disabled={pending} aria-busy={pending} className="space-y-6 transition-opacity disabled:opacity-60">
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionInfo")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* เลขที่ทรัพย์สิน: หมวด COMPUTER เก็บที่ cpu_tag (asset_tag = Host Name อยู่ในข้อมูลเครื่อง), หมวดอื่นเก็บที่ asset_tag */}
            {form?.computer
              ? field("cpu_tag", t("assets.form.tag"), input("cpu_tag", { maxLength: 100, placeholder: t("assets.form.tagPlaceholder") }), numberRequired(values, initial))
              : field("asset_tag", t("assets.form.tag"), input("asset_tag", { maxLength: 50, placeholder: t("assets.form.tagPlaceholder") }), true)}
            {field("name", t("assets.form.name"), input("name", { maxLength: 255, placeholder: form?.computer ? t("assets.computer.namePlaceholder") : undefined }), true)}
            {field(
              "category",
              t("assets.form.category"),
              <AppSelect id="category" name="category" value={values.category} onChange={onChange} className={cls("category")}>
                <option value="">{t("assets.form.chooseCategory")}</option>
                {/* หมวดเดิมที่ถูกปิดใช้งาน/ไม่อยู่ในรายการแล้ว ยังแสดงเพื่อไม่ให้ค่าหาย */}
                {[...new Set(["COMPUTER", ...categories, ...(values.category ? [values.category] : [])])].map((c) => (
                  <option key={c} value={c}>
                    {assetCategoryLabel(t, c)}
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
            {/* ป้ายกำกับ: เครื่องสำหรับยืม → แสดงในหน้า ยืมโน้ตบุ๊ก (สถานะใช้งาน / เก็บในคลัง) */}
            <label className="flex cursor-pointer items-start gap-2.5 self-end rounded-xl p-2.5 ring-1 ring-line transition-colors hover:bg-subtle sm:col-span-2">
              <input
                type="checkbox"
                name="is_loanable"
                checked={values.is_loanable}
                onChange={(e) => setValues((v) => ({ ...v, is_loanable: e.target.checked }))}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
              />
              <span>
                <span className="block text-sm font-medium">{t("assets.form.loanable")}</span>
                <span className="block text-xs text-muted">{t("assets.form.loanableHint")}</span>
              </span>
            </label>
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
              <SuggestInput
                id="model"
                value={values.model}
                onChange={(v) => setField("model", v)}
                load={(q) => suggestAssetValues("model", q, values.brand)}
                className={cls("model")}
              />,
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
              "department",
              t("assets.form.department"),
              <AppSelect id="department" name="department" value={values.department} onChange={onChange} className={cls("department")}>
                <option value="">{t("common.none")}</option>
                {/* แผนกเดิมที่ไม่อยู่ในข้อมูลหลัก (เช่น จากไฟล์ Excel) ยังแสดงเพื่อไม่ให้ค่าหาย */}
                {[...new Set([...departments, ...(values.department.trim() ? [values.department] : [])])].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </AppSelect>,
            )}
            {field(
              "location_id",
              t("assets.form.location"),
              <LocationPicker id="location_id" locations={locations} value={values.location_id} onChange={onLocationChange} className={cls("location_id")} />,
            )}
            {/* ผู้ถือครอง = ผู้ใช้งาน (ช่องเดียว) */}
            <div>
              <label htmlFor="custodian_id" className="mb-1 block text-sm font-medium">
                {t("assets.detail.holder")}
              </label>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {values.is_shared ? (
                    <p className={`${inputBase} truncate bg-subtle text-muted`}>{[t("assets.form.shared"), branchName, values.department].filter(Boolean).join(" · ")}</p>
                  ) : (
                    <CustodianPicker id="custodian_id" value={custodian} onChange={onCustodianChange} className={cls("custodian_id")} />
                  )}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="is_shared"
                    checked={values.is_shared}
                    onChange={(e) => onSharedChange(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                  />
                  {t("assets.form.shared")}
                </label>
              </div>
              {errors.custodian_id && <p className="mt-1 text-xs font-medium text-red-500">{errors.custodian_id}</p>}
              {/* ชื่อจากทะเบียน Excel ที่ยังไม่ผูกผู้ใช้ — เลือกผู้ถือครองแล้วแทนที่ */}
              {!custodian && !values.is_shared && values.user_name.trim() && (
                <p className="mt-1 text-xs text-muted">{t("assets.form.holderLegacy", { name: values.user_name })}</p>
              )}
            </div>
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
              {field(
                "computer_type",
                t("assets.computer.computerType"),
                <OptionPicker
                  id="computer_type"
                  options={computerTypes.map((c) => ({ value: c, label: c }))}
                  value={values.computer_type}
                  onChange={(v) => setField("computer_type", v)}
                  onAdd={(name) => quickAddOption("computer_type", name)}
                  maxLength={30}
                  className={cls("computer_type")}
                />,
              )}
              {field("received_date", t("assets.computer.receivedDate"), dateInput("received_date"))}
              {field("start_use_date", t("assets.computer.startUseDate"), dateInput("start_use_date"))}
              {field("asset_tag", t("assets.computer.hostName"), input("asset_tag", { maxLength: 50, placeholder: "LPPCPRD001" }), true)}
              {field("work_group", t("assets.computer.workGroup"), input("work_group", { maxLength: 50, placeholder: "LAMPHUN" }))}
              {/* สเปคคอมพิวเตอร์: ตัวเลือกจากข้อมูล Drop Down (list computer_spec) — เพิ่มด่วนได้ */}
              {field(
                "computer_spec",
                t("assets.computer.spec"),
                <OptionPicker
                  id="computer_spec"
                  options={computerSpecs.map((c) => ({ value: c, label: c }))}
                  value={values.computer_spec}
                  onChange={(v) => setField("computer_spec", v)}
                  onAdd={(name) => quickAddOption("computer_spec", name)}
                  maxLength={255}
                  className={cls("computer_spec")}
                />,
              )}
              {field("ip_address", t("assets.computer.ip"), input("ip_address", { maxLength: 45, placeholder: "192.168.4.36", className: `${cls("ip_address")} font-mono` }))}
              {field("mac_address", t("assets.computer.mac"), input("mac_address", { maxLength: 50, placeholder: "A0:36:BC:25:1C:5C", className: `${cls("mac_address")} font-mono` }))}
              {/* เลขที่ทรัพย์สิน (แสดงค่าจากช่องบนสุด แก้ที่นี่ไม่ได้) + เลขที่ทรัพย์สิน (เดิม) บรรทัดเดียวกัน — ช่องเลขที่ทรัพย์สิน Notebook เลิกแสดง (ค่าเดิมยังเก็บไว้) */}
              <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2 lg:col-span-3">
                <div>
                  <label htmlFor="cpu_tag_view" className="mb-1 block text-sm font-medium">
                    {t("assets.computer.cpuTag")}
                  </label>
                  <input id="cpu_tag_view" value={values.cpu_tag} readOnly disabled className={`${inputBase} cursor-not-allowed bg-subtle font-mono text-muted`} />
                </div>
                {field(
                  "monitor_tag",
                  t("assets.computer.monitorTag"),
                  <SuggestInput
                    id="monitor_tag"
                    value={values.monitor_tag}
                    onChange={(v) => setField("monitor_tag", v)}
                    load={loadMonitorTags}
                    allowNew={false}
                    maxLength={255}
                    placeholder={t("assets.computer.monitorTagPlaceholder")}
                    className={`${cls("monitor_tag")} font-mono`}
                  />,
                )}
              </div>
            </div>
          </section>
        )}

        {/* OS และ Software = license ที่ติดตั้งบนเครื่องนี้ (Email 365 ไม่แสดงในฟอร์ม — ค่าเดิมยังเก็บไว้) */}
        {form?.computer && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="font-semibold">{t("assets.software.section")}</h2>
            <p className="mb-4 mt-1 text-sm text-muted">{t("assets.software.sectionHint")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {slotField("os", t("assets.computer.os"))}
              {slotField("office", t("assets.computer.office"))}
              {slotField("antivirus", t("assets.computer.antivirus"))}
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
                {/* ข้อความเดิมที่ยังไม่ผูก license (นำเข้า Excel แล้วไม่ตรงชื่อ License หรือ seat เต็ม) */}
                {values.other_software.trim() && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-warning-50 px-3 py-2 text-sm ring-1 ring-inset ring-warning-200 dark:bg-warning-400/10 dark:ring-warning-400/30">
                    <AlertIcon width={14} height={14} className="mt-0.5 shrink-0 text-warning-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-muted">{t("assets.software.otherLegacy")}</span>
                      <span className="block break-words">{values.other_software.split(/\r?\n/).filter(Boolean).join(", ")}</span>
                    </span>
                    <Tooltip label={t("common.clear")}>
                      <button
                        type="button"
                        onClick={() => setField("other_software", "")}
                        aria-label={t("common.clear")}
                        className={`${btn.danger} ${btn.sm} shrink-0 px-1.5 py-1`}
                      >
                        <XIcon width={12} height={12} />
                      </button>
                    </Tooltip>
                  </div>
                )}
                {errors["software.others"] || errors.other_software ? (
                  <p className="mt-1 text-xs font-medium text-red-500">{errors["software.others"] || errors.other_software}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">{t("assets.software.otherHint")}</p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("assets.form.sectionPurchase")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field("purchase_date", t("assets.form.purchaseDate"), dateInput("purchase_date", { max: localToday() }))}
            {field("purchase_cost", t("assets.form.cost"), input("purchase_cost", { type: "number", min: 0, step: "0.01", inputMode: "decimal" }))}
            {field("warranty_expires_at", t("assets.form.warranty"), dateInput("warranty_expires_at"))}
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
