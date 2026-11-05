"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createUser, deleteUser, updateUser, type UserResult } from "@/app/actions/users";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TFunction } from "@/i18n/types";
import { ROLES, type ManagedUser, type UserFormValues } from "@/lib/types";
import { CustodianPicker } from "../assets/custodian-picker";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { PasswordInput } from "@/components/password-input";

type Field = keyof UserFormValues;
type Errors = Partial<Record<Field, string>>;

function validate(v: UserFormValues, isCreate: boolean, t: TFunction): Errors {
  const e: Errors = {};
  if (!v.name.trim()) e.name = t("users.validate.nameRequired");
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = t("users.validate.emailInvalid");
  if (isCreate && !v.password) e.password = t("users.validate.passwordRequired");
  if (v.password && (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password))) {
    e.password = t("users.validate.passwordWeak");
  }
  if (v.password !== v.password_confirmation) e.password_confirmation = t("users.validate.passwordMismatch");
  return e;
}

interface Props {
  /** ไม่ระบุ = เพิ่มใหม่ */
  user?: ManagedUser;
  isSelf?: boolean;
  canDelete?: boolean;
  branches: { id: number; name: string }[];
  /** สายอนุมัติสำหรับกำหนดรายบุคคล */
  routes: { id: number; name: string; is_active: boolean }[];
  /** แผนก / ฝ่าย จากข้อมูลหลัก (ที่เปิดใช้งาน) */
  departments: { id: number; name: string }[];
  divisions: { id: number; name: string }[];
  /** ผู้ทำมีสิทธิ์มอบตำแหน่ง (access.assign) — ไม่มี = เปลี่ยนตำแหน่งไม่ได้ (ผู้ใช้ใหม่ = พนักงาน) */
  canAssign?: boolean;
  /** ชื่อกลุ่มตามตำแหน่งที่แก้ไว้ (หน้าสิทธิ์ตามกลุ่ม) — ไม่มี = ชื่อตั้งต้น */
  roleNames?: Record<string, { th: string; en: string }>;
  /** การ์ดลายเซ็น / 2FA — แสดงแถวเดียวกับเปิดใช้งานบัญชี */
  statusCards?: ReactNode;
  /** กลุ่มงานที่เลือกได้ตอนสร้างผู้ใช้ (กลุ่มที่สร้างเอง — ผู้มี access.assign) */
  groupOptions?: { key: string; name_th: string; name_en: string }[];
  /** ผู้ทำเป็นผู้ดูแลระบบ — ตั้งตำแหน่งผู้ดูแลระบบได้ */
  superAdmin?: boolean;
}

export function UserForm({ user, isSelf = false, canDelete = false, branches, routes, departments, divisions, canAssign = false, groupOptions = [], roleNames, statusCards, superAdmin = false }: Props) {
  const { t, locale } = useI18n();
  const [groups, setGroups] = useState<string[]>([]);
  const confirm = useConfirm();
  const isCreate = !user;
  const [values, setValues] = useState<UserFormValues>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    username: user?.username ?? "",
    role: user?.role ?? "viewer",
    job_title: user?.job_title ?? "",
    is_it_head: user?.is_it_head ?? false,
    is_active: user?.is_active ?? true,
    password: "",
    password_confirmation: "",
    // ผู้ดูแลรู้รหัสผ่านที่ตั้งให้ — ตั้งต้นให้ผู้ใช้เปลี่ยนเอง
    must_change_password: true,
    branch_id: user?.branch_id ? String(user.branch_id) : "",
    department: user?.department ?? "",
    division: user?.division ?? "",
    supervisor_id: user?.supervisor_id ? String(user.supervisor_id) : "",
    approval_route_id: user?.approval_route_id ? String(user.approval_route_id) : "",
  });
  const [supervisor, setSupervisor] = useState(user?.supervisor ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const name = e.target.name as Field;
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
    // บทบาทเจ้าหน้าที่ IT → ติ๊กเจ้าหน้าที่ IT ให้ด้วย (API ทำซ้ำอีกชั้น)
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handle = (r: UserResult | undefined) => {
    if (!r) return;
    setErrors((r.errors ?? {}) as Errors);
    setMessage(r.message ?? "");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, isCreate, t);
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");
    setPendingAction("save");
    startTransition(async () => handle(user ? await updateUser(user.id, values) : await createUser({ ...values, groups })));
  };

  const onDelete = async () => {
    if (!user || !(await confirm(t("users.form.confirmDelete", { name: user.name })))) return;
    setPendingAction("delete");
    startTransition(async () => handle(await deleteUser(user.id)));
  };

  const field = (f: Field, label: string, control: ReactNode, required = false, hint?: string) => (
    <div>
      <label htmlFor={f} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[f] ? (
        <p className="mt-1 text-xs font-medium text-red-500">{errors[f]}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
  const cls = (f: Field) => `${input} ${errors[f] ? inputError : ""}`;
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
      {isSelf && <p className={alert.warning}>{t("users.form.selfNote")}</p>}

      <fieldset disabled={pending} aria-busy={pending} className="space-y-6 transition-opacity disabled:opacity-60">
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("users.form.section")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("name", t("users.form.name"), <input id="name" name="name" value={values.name} onChange={onChange} maxLength={255} autoComplete="off" className={cls("name")} />, true)}
            {field("email", t("users.form.email"), <input id="email" name="email" type="email" value={values.email} onChange={onChange} maxLength={255} autoComplete="off" className={cls("email")} />, true)}
            {field("username", t("users.form.username"), <input id="username" name="username" value={values.username} onChange={onChange} maxLength={50} autoComplete="off" autoCapitalize="none" placeholder={t("users.form.usernameHint")} className={cls("username")} />)}
            {field("job_title", t("users.form.jobTitle"), <input id="job_title" name="job_title" value={values.job_title} onChange={onChange} maxLength={100} placeholder={t("users.form.jobTitlePlaceholder")} className={cls("job_title")} />)}

            {/* บทบาท: การ์ดตัวเลือกพร้อมคำอธิบายสิทธิ์ */}
            <fieldset className="sm:col-span-2" disabled={isSelf}>
              <legend className="mb-1 text-sm font-medium">
                {t("users.form.role")} <span className="text-red-500">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {ROLES.map((r) => {
                  // เปลี่ยนตำแหน่ง = มอบสิทธิ์: ต้องมี access.assign · ตำแหน่งผู้ดูแลระบบตั้ง/ถอดได้เฉพาะผู้ดูแลระบบ (API ตรวจซ้ำ)
                  const current = user?.role ?? "viewer";
                  const blocked = r !== current && (!canAssign || ((r === "super_admin" || current === "super_admin" || r === "auditor" || current === "auditor") && !superAdmin));
                  return (
                  <label
                    key={r}
                    className={`flex gap-2 rounded-xl p-3 ring-1 transition-colors ${
                      values.role === r
                        ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10 dark:ring-accent-400/40"
                        : "ring-line hover:bg-subtle"
                    } ${isSelf || blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input type="radio" name="role" value={r} checked={values.role === r} disabled={blocked} onChange={onChange} className="mt-1 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed" />
                    <span>
                      <span className="block text-sm font-medium">{roleNames?.[r]?.[locale === "en" ? "en" : "th"] || t(`roles.${r}`)}</span>
                      <span className="block text-xs text-muted">{t(`users.form.roleHints.${r}`)}</span>
                    </span>
                  </label>
                  );
                })}
              </div>
              {errors.role && <p className="mt-1 text-xs font-medium text-red-500">{errors.role}</p>}
            </fieldset>
            {/* กลุ่มงานเพิ่มเติม (ตอนสร้างเท่านั้น — ภายหลังแก้ที่หน้าสิทธิ์รายคน) */}
            {!user && groupOptions.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 text-sm font-medium">{t("users.form.groups")}</legend>
                <p className="mb-2 text-xs text-muted">{t("users.form.groupsHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((g) => (
                    <label key={g.key} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-line transition-colors hover:bg-subtle">
                      <input
                        type="checkbox"
                        checked={groups.includes(g.key)}
                        onChange={(e) => {
                          setGroups((x) => (e.target.checked ? [...x, g.key] : x.filter((k) => k !== g.key)));
                          setErrors((prev) => ({ ...prev, groups: undefined }));
                        }}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                      />
                      {locale === "en" ? g.name_en : g.name_th}
                    </label>
                  ))}
                </div>
                {errors.groups && <p className="mt-1 text-xs font-medium text-red-500">{errors.groups}</p>}
              </fieldset>
            )}

          </div>
        </section>

        {/* ลายเซ็น / ยืนยันตัวตน 2 ขั้น + เปิดใช้งานบัญชี แถวเดียว */}
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {statusCards}
          <div className={`flex items-center justify-between gap-4 p-4 sm:px-6 ${card}`}>
            <label htmlFor="is_active" className={isSelf ? "opacity-60" : "cursor-pointer"}>
              <span className="block font-semibold">{t("users.form.active")}</span>
              <span className="block text-xs text-muted">{t("users.form.activeHint")}</span>
            </label>
            <button
              id="is_active"
              type="button"
              role="switch"
              aria-checked={values.is_active}
              disabled={isSelf}
              onClick={() => {
                setValues((v) => ({ ...v, is_active: !v.is_active }));
                setErrors((e) => ({ ...e, is_active: "" }));
              }}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${values.is_active ? "bg-accent-500" : "bg-line"}`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${values.is_active ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        </div>
        {errors.is_active && <p className="text-xs font-medium text-red-500">{errors.is_active}</p>}

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-1 font-semibold">{t("users.form.passwordSection")}</h2>
          <p className="mb-4 text-sm text-muted">{isCreate ? t("users.form.passwordNewHint") : t("users.form.passwordResetHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("password", t("users.form.password"), <PasswordInput id="password" name="password" value={values.password} onChange={onChange} autoComplete="new-password" className={cls("password")} />, isCreate)}
            {field(
              "password_confirmation",
              t("users.form.passwordConfirm"),
              <PasswordInput id="password_confirmation" name="password_confirmation" value={values.password_confirmation} onChange={onChange} autoComplete="new-password" className={cls("password_confirmation")} />,
              isCreate,
            )}
          </div>
          {/* ผู้ดูแลตั้งรหัสผ่านให้คนอื่น (ไม่ใช่ของตัวเอง) */}
          {(isCreate || (!isSelf && values.password)) && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" name="must_change_password" checked={Boolean(values.must_change_password)} onChange={onChange} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
              <span>
                {t("users.form.mustChangePassword")}
                <span className="block text-xs text-muted">{t("users.form.mustChangePasswordHint")}</span>
              </span>
            </label>
          )}
        </section>

        {/* สังกัด + หัวหน้าตามสายบังคับบัญชา (ผู้อนุมัติใบแจ้งงาน) */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("users.form.orgSection")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "branch_id",
              t("users.form.branch"),
              <AppSelect id="branch_id" name="branch_id" value={values.branch_id} onChange={onChange} className={cls("branch_id")}>
                <option value="">{t("users.form.noBranch")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </AppSelect>,
            )}
            {field(
              "supervisor_id",
              t("users.form.supervisor"),
              <CustodianPicker
                id="supervisor_id"
                value={supervisor}
                onChange={(u) => {
                  setSupervisor(u);
                  setValues((v) => ({ ...v, supervisor_id: u ? String(u.id) : "" }));
                  setErrors((e) => ({ ...e, supervisor_id: "" }));
                }}
                className={cls("supervisor_id")}
              />,
              false,
              supervisor ? undefined : t("users.form.noSupervisor"),
            )}
            {field("division", t("users.form.division"), <OrgSelect id="division" value={values.division} options={divisions} onChange={onChange} className={cls("division")} placeholder={t("users.form.chooseDivision")} />)}
            {field("department", t("users.form.department"), <OrgSelect id="department" value={values.department} options={departments} onChange={onChange} className={cls("department")} placeholder={t("users.form.chooseDepartment")} />)}
            <div className="sm:col-span-2">
              {field(
                "approval_route_id",
                t("users.form.approvalRoute"),
                <AppSelect id="approval_route_id" name="approval_route_id" value={values.approval_route_id} onChange={onChange} className={cls("approval_route_id")}>
                  <option value="">{t("users.form.approvalRouteAuto")}</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.is_active ? "" : ` (${t("approvalRoutes.inactive")})`}
                    </option>
                  ))}
                </AppSelect>,
                false,
                t("users.form.approvalRouteHint"),
              )}
            </div>
          </div>

          {/* เจ้าหน้าที่ IT ดูจากแผนก/ฝ่าย — ผู้จัดการฝ่าย IT เป็นหน้าที่เฉพาะคน จึงกำหนดที่นี่ (ไม่ให้สิทธิ์เพิ่ม) */}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-subtle p-3">
            <input
              type="checkbox"
              checked={values.is_it_head}
              onChange={(e) => {
                setValues((v) => ({ ...v, is_it_head: e.target.checked }));
                setErrors((prev) => ({ ...prev, is_it_head: "" }));
              }}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
            />
            <span>
              <span className="block text-sm font-medium">{t("users.form.itHead")}</span>
              <span className="block text-xs text-muted">{t("users.form.itHeadHint")}</span>
            </span>
          </label>
        </section>

      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {user && !isSelf && (
          <div className="sm:mr-auto">
            <button type="button" onClick={onDelete} disabled={pending || !canDelete} className={btn.danger}>
              {deleting ? <SpinnerIcon /> : <TrashIcon />}
              {deleting ? t("common.deleting") : t("users.form.delete")}
            </button>
            {!canDelete && <p className="mt-1 max-w-xs text-xs text-muted">{t("users.form.deleteBlocked")}</p>}
          </div>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/users" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {saving ? <SpinnerIcon /> : <SaveIcon />}
            {saving ? t("common.saving") : isCreate ? t("users.form.submitCreate") : t("users.form.submitUpdate")}
          </button>
        </div>
      </div>
    </form>
  );
}

/** เลือกแผนก/ฝ่ายจากข้อมูลหลัก — ค่าเดิมที่ไม่อยู่ในรายการ (เช่น ปิดใช้งานแล้ว) ยังแสดงให้เลือกค้างไว้ */
function OrgSelect({
  id,
  value,
  options,
  onChange,
  className,
  placeholder,
}: {
  id: "department" | "division";
  value: string;
  options: { id: number; name: string }[];
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  className: string;
  placeholder: string;
}) {
  const known = options.some((o) => o.name.toLowerCase() === value.trim().toLowerCase());
  return (
    <AppSelect id={id} name={id} value={value} onChange={onChange} className={className}>
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.name}>
          {o.name}
        </option>
      ))}
    </AppSelect>
  );
}
