"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteCredential, saveCredential, type CredentialPayload } from "@/app/actions/it-data";
import { DateInput } from "@/components/date-input";
import { AlertIcon, KeyIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { CREDENTIAL_CATEGORIES, isBuiltinCategory, type Branch, type Credential } from "@/lib/types";

const NEW_CATEGORY = "__new__";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";

export function CredentialForm({ credential, branches, customCategories = [] }: { credential?: Credential; branches: Branch[]; customCategories?: string[] }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const isEdit = Boolean(credential);
  const [v, setV] = useState({
    title: credential?.title ?? "",
    category: credential?.category ?? "system",
    url: credential?.url ?? "",
    username: credential?.username ?? "",
    notes: credential?.notes ?? "",
    branch_id: credential?.branch_id ? String(credential.branch_id) : "",
    expires_at: credential?.expires_at ?? "",
  });
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [secret, setSecret] = useState("");
  // ต้องยืนยันตัวตน (รหัสผ่าน login / PIN กลาง) ก่อนเปิดดูรหัสของบัญชีนี้ — บัญชีใหม่ = เปิดไว้
  const [requireReauth, setRequireReauth] = useState(credential?.require_reauth ?? true);
  // หมวดหมู่ใหม่ที่ยังไม่มีในรายการ — เลือก "+ เพิ่มหมวดหมู่ใหม่" แล้วพิมพ์ชื่อ (สร้างพร้อมบันทึกบัญชีนี้)
  const [newCategory, setNewCategory] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "delete" | null>(null);

  const set = (k: keyof typeof v, value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const submit = () => {
    if (!v.title.trim()) return setErrors({ title: t("vault.validate.title") });
    const adding = v.category === NEW_CATEGORY;
    if (adding && !newCategory.trim()) return setErrors({ category: t("vault.form.categoryRequired") });
    const payload: CredentialPayload = { ...v, category: adding ? newCategory.trim() : v.category, require_reauth: requireReauth };
    // แก้ไข: ไม่ส่ง = คงเดิม; ติ๊กลบ = ส่ง ""
    if (!isEdit || password) payload.password = password;
    if (isEdit && clearPassword && !password) payload.password = "";
    if (!isEdit || secret) payload.secret_notes = secret;
    setAction("save");
    start(async () => {
      const res = await saveCredential(credential?.id ?? null, payload);
      if (res) {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, m ?? ""])));
        setMessage(res.message ?? "");
      }
    });
  };

  const remove = async () => {
    if (!credential || !(await confirm(t("vault.form.confirmDelete", { title: credential.title })))) return;
    setAction("delete");
    start(async () => {
      const res = await deleteCredential(credential.id);
      if (res) setMessage(res.message ?? "");
    });
  };

  const field = (k: string, label: string, control: ReactNode, required = false, hint?: string, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={k} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;
  // หมวดที่เพิ่มเอง (รวมหมวดของบัญชีนี้ แม้ไม่มีในรายการ)
  const categoryOptions = [...new Set([...customCategories, ...(credential ? [credential.category] : [])])]
    .filter((c) => !isBuiltinCategory(c))
    .sort((a, b) => a.localeCompare(b, "th"));
  const selectCategory = (value: string) => {
    set("category", value);
    // เลือก "+ เพิ่มหมวดหมู่ใหม่" → เด้งไปช่องพิมพ์ชื่อ
    if (value === NEW_CATEGORY) setTimeout(() => document.getElementById("new-category")?.focus());
  };

  return (
    <div className="space-y-5">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}
      <fieldset disabled={pending} className={`grid grid-cols-1 gap-4 p-4 disabled:opacity-60 sm:grid-cols-2 sm:p-6 ${card}`}>
        {field("title", t("vault.form.title"), <input id="title" value={v.title} maxLength={255} onChange={(e) => set("title", e.target.value)} className={cls("title")} />, true)}
        {field(
          "category",
          t("vault.form.category"),
          <div className="space-y-2">
            <AppSelect id="category" value={v.category} onChange={(e) => selectCategory(e.target.value)} className={cls("category")}>
              {CREDENTIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`vault.categories.${c}`)}
                </option>
              ))}
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW_CATEGORY}>{t("vault.form.addCategory")}</option>
            </AppSelect>
            {v.category === NEW_CATEGORY && (
              <input
                id="new-category"
                value={newCategory}
                maxLength={30}
                placeholder={t("vault.form.newCategory")}
                aria-label={t("vault.form.newCategory")}
                onChange={(e) => (setNewCategory(e.target.value), setErrors((x) => ({ ...x, category: "" })))}
                className={`${cls("category")} ${newCategory.trim() ? "" : "ring-2 ring-accent-400"}`}
              />
            )}
          </div>,
          true,
          v.category === NEW_CATEGORY ? t("vault.form.newCategoryHint") : undefined,
        )}
        {field("url", t("vault.form.url"), <input id="url" value={v.url} maxLength={500} onChange={(e) => set("url", e.target.value)} className={`${cls("url")} font-mono`} />, false, t("vault.form.urlHint"), true)}
        {field("username", t("vault.form.username"), <input id="username" value={v.username} maxLength={255} autoComplete="off" onChange={(e) => set("username", e.target.value)} className={`${cls("username")} font-mono`} />)}
        {field(
          "password",
          t("vault.form.password"),
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <PasswordInput
              id="password"
              wrapperClassName="min-w-48 flex-1"
              value={password}
              maxLength={1000}
              autoComplete="new-password"
              onChange={(e) => (setPassword(e.target.value), setClearPassword(false))}
              className={`${cls("password")} font-mono`}
            />
            {/* สวิตช์รายบัญชี: เปิด = ต้องกรอกรหัสผ่าน login / PIN กลางก่อนกดดู, ปิด = กดดูได้เลย */}
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm" title={t("vault.form.requireReauthHint")}>
              <button
                type="button"
                role="switch"
                aria-checked={requireReauth}
                onClick={() => setRequireReauth((x) => !x)}
                className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${requireReauth ? "bg-accent-500" : "bg-line"}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${requireReauth ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <KeyIcon width={14} height={14} className={requireReauth ? "text-accent-500" : "text-faint"} />
              {t("vault.form.requireReauth")}
            </label>
          </div>,
          false,
          [isEdit && credential?.has_password ? t("vault.form.passwordKeep") : null, t(requireReauth ? "vault.form.requireReauthOn" : "vault.form.requireReauthOff")].filter(Boolean).join(" · "),
        )}
        {isEdit && credential?.has_password && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted sm:col-span-2">
            <input type="checkbox" checked={clearPassword} onChange={(e) => (setClearPassword(e.target.checked), e.target.checked && setPassword(""))} className="h-4 w-4 accent-[var(--accent-500)]" />
            {t("vault.form.clearPassword")}
          </label>
        )}
        {field(
          "secret_notes",
          t("vault.form.secretNotes"),
          <textarea id="secret_notes" rows={2} maxLength={5000} value={secret} onChange={(e) => setSecret(e.target.value)} className={`${cls("secret_notes")} font-mono`} />,
          false,
          isEdit ? t("vault.form.secretNotesHint") : undefined,
          true,
        )}
        {field(
          "branch_id",
          t("vault.form.branch"),
          <AppSelect id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
            <option value="">{t("common.none")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </AppSelect>,
        )}
        {field("expires_at", t("vault.form.expiresAt"), <DateInput id="expires_at" value={v.expires_at} onChange={(d) => set("expires_at", d)} className={cls("expires_at")} />)}
        {field("notes", t("vault.form.notes"), <textarea id="notes" rows={3} maxLength={5000} value={v.notes} onChange={(e) => set("notes", e.target.value)} className={cls("notes")} />, false, undefined, true)}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && (
          <button type="button" onClick={remove} disabled={pending} className={`${btn.danger} sm:mr-auto`}>
            {pending && action === "delete" ? <SpinnerIcon /> : <TrashIcon />}
            {t("vault.form.delete")}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/vault" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {pending && action === "save" ? <SpinnerIcon /> : <SaveIcon />}
            {isEdit ? t("vault.form.submitUpdate") : t("vault.form.submitCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}
