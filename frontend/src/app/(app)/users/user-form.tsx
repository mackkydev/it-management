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
}

export function UserForm({ user, isSelf = false, canDelete = false, branches }: Props) {
  const { t } = useI18n();
  const isCreate = !user;
  const [values, setValues] = useState<UserFormValues>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "viewer",
    is_active: user?.is_active ?? true,
    password: "",
    password_confirmation: "",
    branch_id: user?.branch_id ? String(user.branch_id) : "",
    department: user?.department ?? "",
    division: user?.division ?? "",
    supervisor_id: user?.supervisor_id ? String(user.supervisor_id) : "",
    is_it_staff: user?.is_it_staff ?? false,
    is_it_head: user?.is_it_head ?? false,
  });
  const [supervisor, setSupervisor] = useState(user?.supervisor ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const name = e.target.name as Field;
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
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
    startTransition(async () => handle(user ? await updateUser(user.id, values) : await createUser(values)));
  };

  const onDelete = () => {
    if (!user || !confirm(t("users.form.confirmDelete", { name: user.name }))) return;
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

            {/* บทบาท: การ์ดตัวเลือกพร้อมคำอธิบายสิทธิ์ */}
            <fieldset className="sm:col-span-2" disabled={isSelf}>
              <legend className="mb-1 text-sm font-medium">
                {t("users.form.role")} <span className="text-red-500">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className={`flex cursor-pointer gap-2 rounded-xl p-3 ring-1 transition-colors ${
                      values.role === r
                        ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10 dark:ring-accent-400/40"
                        : "ring-line hover:bg-subtle"
                    } ${isSelf ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input type="radio" name="role" value={r} checked={values.role === r} onChange={onChange} className="mt-1 accent-[var(--accent-500)]" />
                    <span>
                      <span className="block text-sm font-medium">{t(`roles.${r}`)}</span>
                      <span className="block text-xs text-muted">{t(`users.form.roleHints.${r}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.role && <p className="mt-1 text-xs font-medium text-red-500">{errors.role}</p>}
            </fieldset>

            <label className={`flex items-start gap-3 rounded-xl bg-subtle p-3 sm:col-span-2 ${isSelf ? "opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                name="is_active"
                checked={values.is_active}
                onChange={onChange}
                disabled={isSelf}
                className="mt-0.5 h-4 w-4 accent-[var(--accent-500)]"
              />
              <span>
                <span className="block text-sm font-medium">{t("users.form.active")}</span>
                <span className="block text-xs text-muted">{t("users.form.activeHint")}</span>
              </span>
            </label>
          </div>
        </section>

        {/* สังกัด + หัวหน้าตามสายบังคับบัญชา (ผู้อนุมัติใบแจ้งงาน) */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("users.form.orgSection")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "branch_id",
              t("users.form.branch"),
              <select id="branch_id" name="branch_id" value={values.branch_id} onChange={onChange} className={cls("branch_id")}>
                <option value="">{t("users.form.noBranch")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>,
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
            {field("department", t("users.form.department"), <input id="department" name="department" value={values.department} onChange={onChange} maxLength={100} className={cls("department")} />)}
            {field("division", t("users.form.division"), <input id="division" name="division" value={values.division} onChange={onChange} maxLength={100} className={cls("division")} />)}
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold">{t("users.form.itSection")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["is_it_staff", "is_it_head"] as const).map((key) => (
              <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl bg-subtle p-3">
                <input type="checkbox" name={key} checked={values[key]} onChange={onChange} className="mt-0.5 h-4 w-4 accent-[var(--accent-500)]" />
                <span>
                  <span className="block text-sm font-medium">{key === "is_it_staff" ? t("users.form.itStaff") : t("users.form.itHead")}</span>
                  <span className="block text-xs text-muted">{key === "is_it_staff" ? t("users.form.itStaffHint") : t("users.form.itHeadHint")}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-1 font-semibold">{t("users.form.passwordSection")}</h2>
          <p className="mb-4 text-sm text-muted">{isCreate ? t("users.form.passwordNewHint") : t("users.form.passwordResetHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("password", t("users.form.password"), <input id="password" name="password" type="password" value={values.password} onChange={onChange} autoComplete="new-password" className={cls("password")} />, isCreate)}
            {field(
              "password_confirmation",
              t("users.form.passwordConfirm"),
              <input id="password_confirmation" name="password_confirmation" type="password" value={values.password_confirmation} onChange={onChange} autoComplete="new-password" className={cls("password_confirmation")} />,
              isCreate,
            )}
          </div>
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
