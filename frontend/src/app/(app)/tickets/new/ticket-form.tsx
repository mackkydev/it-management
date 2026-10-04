"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createTicket } from "@/app/actions/tickets";
import { DocumentPicker, PhotoPicker } from "@/components/file-pickers";
import { AlertIcon, ClipboardIcon, PenIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { TICKET_TYPES, type TicketType, type User } from "@/lib/types";

export interface TicketFormOptions {
  branches: { id: number; code: string; name: string }[];
  it_staff: { id: number; name: string }[];
  other_types: string[];
}

type Field =
  | "type" | "type_other" | "branch_id" | "department" | "division" | "details" | "due_date" | "assignee_id"
  | "person_name_th" | "person_name_en" | "device_name" | "asset_tag" | "symptom" | "photos" | "documents";
type Errors = Partial<Record<Field, string>>;

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * ฟอร์ม "ใบแจ้งดำเนินงาน IT" — ลำดับช่องตามแบบฟอร์มกระดาษ
 * เรื่อง → แผนก/ฝ่าย → สาขา → เจ้าหน้าที่ IT → รายละเอียด → วันที่ต้องการ → (1.1 / 1.2) → ไฟล์แนบ → ผู้แจ้ง
 * ลายเซ็นผู้แจ้งไม่ต้องวาด — API ใช้ลายเซ็นที่อัปโหลดในข้อมูลส่วนตัว แล้วแสตมป์ลงเอกสารตอนดู/พิมพ์
 */
export function TicketForm({ user, options }: { user: User; options: TicketFormOptions }) {
  const { t, fmt } = useI18n();
  const [type, setType] = useState<TicketType>("repair");
  const [v, setV] = useState({
    type_other: "",
    // 4.2.2 สาขา: เลือกให้อัตโนมัติจากสาขาที่ผู้ใช้สังกัด (ถ้าสาขานั้นยังเปิดใช้งาน)
    branch_id: options.branches.some((b) => b.id === user.branch_id) ? String(user.branch_id) : "",
    department: user.department ?? "",
    division: user.division ?? "",
    details: "",
    due_date: "",
    assignee_id: "",
    person_name_th: "",
    person_name_en: "",
    device_name: "",
    asset_tag: "",
    symptom: "",
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const needsPerson = type === "grant_access" || type === "revoke_access";
  const isRepair = type === "repair";

  const set = (name: keyof typeof v, value: string) => {
    setV((s) => ({ ...s, [name]: value }));
    setErrors((e) => ({ ...e, [name]: "" }));
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (type === "other" && !v.type_other.trim()) e.type_other = t("tickets.validate.otherType");
    if (!v.branch_id) e.branch_id = t("tickets.validate.branch");
    if (!v.details.trim()) e.details = t("tickets.validate.details");
    if (needsPerson && !v.person_name_th.trim()) e.person_name_th = t("tickets.validate.nameTh");
    if (needsPerson && !v.person_name_en.trim()) e.person_name_en = t("tickets.validate.nameEn");
    if (isRepair && !v.device_name.trim()) e.device_name = t("tickets.validate.device");
    if (isRepair && !v.symptom.trim()) e.symptom = t("tickets.validate.symptom");
    return e;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");

    const fd = new FormData();
    fd.set("type", type);
    if (type === "other") fd.set("type_other", v.type_other.trim());
    for (const key of ["branch_id", "department", "division", "details", "due_date", "assignee_id"] as const) {
      if (v[key].trim()) fd.set(key, v[key].trim());
    }
    if (needsPerson) {
      fd.set("person_name_th", v.person_name_th.trim());
      fd.set("person_name_en", v.person_name_en.trim());
    }
    if (isRepair) {
      fd.set("device_name", v.device_name.trim());
      fd.set("symptom", v.symptom.trim());
      if (v.asset_tag.trim()) fd.set("asset_tag", v.asset_tag.trim());
    }
    photos.forEach((f) => fd.append("photos[]", f));
    docs.forEach((f) => fd.append("documents[]", f));

    startTransition(async () => {
      const res = await createTicket(fd);
      if (res) {
        setErrors(mapErrors(res.errors));
        setMessage(res.message ?? "");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  const field = (name: Field, label: string, control: ReactNode, required = false, hint?: string, className = "") => (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[name] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[name]}</p> : hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  const cls = (name: Field) => `${input} ${errors[name] ? inputError : ""}`;
  const text = (name: keyof typeof v, props: Record<string, unknown> = {}) => (
    <input id={name} value={v[name]} onChange={(e) => set(name, e.target.value)} className={cls(name as Field)} {...props} />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
            <ClipboardIcon width={22} height={22} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{t("tickets.formTitle")}</h1>
            <p className="text-sm text-muted">{fmt.date(new Date().toISOString())}</p>
          </div>
        </div>
      </div>

      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      <fieldset disabled={pending} className="space-y-5 transition-opacity disabled:opacity-60">
        {/* เรื่อง */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">
            {t("tickets.form.subject")} <span className="text-red-500">*</span>
          </h2>
          <div role="radiogroup" aria-label={t("tickets.form.subject")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {TICKET_TYPES.map((ty) => (
              <label
                key={ty}
                className={`flex cursor-pointer flex-col rounded-xl p-3 ring-1 transition-colors ${
                  type === ty ? "bg-accent-50 ring-2 ring-accent-400 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="type" value={ty} checked={type === ty} onChange={() => setType(ty)} className="accent-[var(--accent-500)]" />
                  {t(`tickets.types.${ty}`)}
                </span>
                {t(`tickets.typeHints.${ty}`) && <span className="ml-6 text-xs text-muted">({t(`tickets.typeHints.${ty}`)})</span>}
              </label>
            ))}
          </div>
          {type === "other" && (
            <div className="mt-3 max-w-md">
              {field(
                "type_other",
                t("tickets.form.otherType"),
                <>
                  {/* เลือกจากรายการ หรือพิมพ์เรื่องใหม่เองได้ */}
                  <input
                    id="type_other"
                    list="ticket-other-types"
                    value={v.type_other}
                    onChange={(e) => set("type_other", e.target.value)}
                    maxLength={255}
                    placeholder={t("tickets.form.otherTypePlaceholder")}
                    className={cls("type_other")}
                  />
                  <datalist id="ticket-other-types">
                    {options.other_types.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                  {options.other_types.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {options.other_types.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => set("type_other", o)}
                          className={`cursor-pointer rounded-full px-3 py-1 text-xs ring-1 transition-colors ${
                            v.type_other === o ? "bg-accent-200 text-accent-900 ring-accent-300 dark:bg-accent-400/25 dark:text-accent-100" : "ring-line hover:bg-subtle"
                          }`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                </>,
                true,
              )}
            </div>
          )}
        </section>

        {/* ข้อมูลผู้แจ้ง + รายละเอียด */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("department", t("tickets.form.department"), text("department", { maxLength: 100 }))}
            {field("division", t("tickets.form.division"), text("division", { maxLength: 100 }))}
            {field(
              "branch_id",
              t("tickets.form.branch"),
              <select id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
                <option value="">{t("tickets.form.chooseBranch")}</option>
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>,
              true,
              user.branch_id ? t("tickets.form.branchAuto") : undefined,
            )}
            {field(
              "assignee_id",
              t("tickets.form.assignee"),
              <select id="assignee_id" value={v.assignee_id} onChange={(e) => set("assignee_id", e.target.value)} className={cls("assignee_id")}>
                <option value="">{t("tickets.form.anyIt")}</option>
                {options.it_staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "details",
              t("tickets.form.details"),
              <textarea id="details" rows={4} maxLength={5000} value={v.details} onChange={(e) => set("details", e.target.value)} className={cls("details")} />,
              true,
              undefined,
              "sm:col-span-2",
            )}
            {field("due_date", t("tickets.form.dueDate"), text("due_date", { type: "date", min: todayIso() }))}
          </div>
        </section>

        {/* 1.1 เพิ่ม/ระงับสิทธิ์ */}
        {needsPerson && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="mb-3 font-semibold">{t("tickets.form.section11")}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("person_name_th", t("tickets.form.nameTh"), text("person_name_th", { maxLength: 255 }), true)}
              {field("person_name_en", t("tickets.form.nameEn"), text("person_name_en", { maxLength: 255, lang: "en" }), true)}
            </div>
          </section>
        )}

        {/* 1.2 งานซ่อม */}
        {isRepair && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="mb-3 font-semibold">{t("tickets.form.section12")}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("device_name", t("tickets.form.device"), text("device_name", { maxLength: 255 }), true)}
              {field("asset_tag", t("tickets.form.assetTag"), text("asset_tag", { maxLength: 50, className: `${cls("asset_tag")} font-mono` }))}
              {field(
                "symptom",
                t("tickets.form.symptom"),
                <textarea id="symptom" rows={3} maxLength={5000} value={v.symptom} onChange={(e) => set("symptom", e.target.value)} className={cls("symptom")} />,
                true,
                undefined,
                "sm:col-span-2",
              )}
            </div>
          </section>
        )}

        {/* ไฟล์แนบ */}
        <section className={`grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-2 ${card}`}>
          <div>
            <h2 className="mb-2 font-semibold">{t("tickets.form.photos")}</h2>
            <PhotoPicker files={photos} onChange={setPhotos} max={4} onError={setMessage} />
            {errors.photos && <p className="mt-1 text-xs font-medium text-red-500">{errors.photos}</p>}
          </div>
          <div>
            <h2 className="mb-2 font-semibold">{t("tickets.form.documents")}</h2>
            <DocumentPicker files={docs} onChange={setDocs} max={5} onError={setMessage} />
            {errors.documents && <p className="mt-1 text-xs font-medium text-red-500">{errors.documents}</p>}
          </div>
        </section>

        {/* 4.2.7 ผู้แจ้ง — ใช้ลายเซ็นที่อัปโหลดไว้ในข้อมูลส่วนตัว (แสตมป์ตอนดู/พิมพ์เอกสาร) */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">
            {t("tickets.form.requester")}: <span className="font-normal">{user.name}</span>
          </h2>
          {user.signature_url ? (
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex h-20 w-64 items-end justify-center border-b border-dashed border-line pb-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นจาก private storage ผ่าน /files */}
                <img src={`/files${user.signature_url}`} alt={t("signature.label")} className="max-h-full max-w-full object-contain dark:invert" />
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-muted">{t("tickets.form.signatureStamp")}</p>
                <Link href="/profile" className="inline-flex cursor-pointer items-center gap-1 text-accent-700 hover:underline dark:text-accent-300">
                  <PenIcon width={14} height={14} />
                  {t("tickets.form.signatureManage")}
                </Link>
              </div>
            </div>
          ) : (
            <div role="status" className={`${alert.warning} flex-wrap`}>
              <AlertIcon className="shrink-0 text-warning-500" />
              <span className="flex-1">{t("tickets.form.signatureMissing")}</span>
              <Link href="/profile" className={`${btn.secondary} ${btn.sm}`}>
                <PenIcon width={14} height={14} />
                {t("profile.signatureUpload")}
              </Link>
            </div>
          )}
        </section>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Link href="/tickets" className={btn.secondary}>
          <XIcon className="text-faint" />
          {t("common.cancel")}
        </Link>
        <button type="submit" disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SendIcon />}
          {pending ? t("tickets.form.submitting") : t("tickets.form.submit")}
        </button>
      </div>
    </form>
  );
}

/** error จาก Laravel เช่น "photos.0" → แสดงที่ช่อง photos */
function mapErrors(errors?: Partial<Record<string, string>>): Errors {
  const out: Errors = {};
  for (const [key, msg] of Object.entries(errors ?? {})) {
    const base = key.split(".")[0] as Field;
    if (!out[base] && msg) out[base] = msg;
  }
  return out;
}
