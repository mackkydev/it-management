"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteCredential, saveCredential, type CredentialPayload } from "@/app/actions/it-data";
import { DateInput } from "@/components/date-input";
import { AlertIcon, EyeIcon, EyeOffIcon, KeyIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { CREDENTIAL_CATEGORIES, type Branch, type Credential } from "@/lib/types";

/** สร้างรหัสผ่านแบบสุ่ม (crypto) 20 ตัว */
function generatePassword(length = 20): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function CredentialForm({ credential, branches }: { credential?: Credential; branches: Branch[] }) {
  const { t } = useI18n();
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
  const [showPw, setShowPw] = useState(false);
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
    const payload: CredentialPayload = { ...v };
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

  const remove = () => {
    if (!credential || !confirm(t("vault.form.confirmDelete", { title: credential.title }))) return;
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
          <select id="category" value={v.category} onChange={(e) => set("category", e.target.value)} className={cls("category")}>
            {CREDENTIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`vault.categories.${c}`)}
              </option>
            ))}
          </select>,
          true,
        )}
        {field("url", t("vault.form.url"), <input id="url" value={v.url} maxLength={500} onChange={(e) => set("url", e.target.value)} className={`${cls("url")} font-mono`} />, false, undefined, true)}
        {field("username", t("vault.form.username"), <input id="username" value={v.username} maxLength={255} autoComplete="off" onChange={(e) => set("username", e.target.value)} className={`${cls("username")} font-mono`} />)}
        {field(
          "password",
          t("vault.form.password"),
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                maxLength={1000}
                autoComplete="new-password"
                onChange={(e) => (setPassword(e.target.value), setClearPassword(false))}
                className={`${cls("password")} pr-9 font-mono`}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? t("vault.hide") : t("vault.reveal")}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted hover:text-ink"
              >
                {showPw ? <EyeOffIcon width={14} height={14} /> : <EyeIcon width={14} height={14} />}
              </button>
            </div>
            <button type="button" onClick={() => (setPassword(generatePassword()), setShowPw(true))} className={`${btn.secondary} shrink-0 px-3`}>
              <KeyIcon width={14} height={14} className="text-accent-500" />
              <span className="hidden sm:inline">{t("vault.form.generate")}</span>
            </button>
          </div>,
          false,
          isEdit && credential?.has_password ? t("vault.form.passwordKeep") : undefined,
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
          <select id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
            <option value="">{t("common.none")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>,
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
