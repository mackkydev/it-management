"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteCredential, saveCredential, type CredentialPayload } from "@/app/actions/it-data";
import { DateInput } from "@/components/date-input";
import { AlertIcon, KeyIcon, LockIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { CREDENTIAL_CATEGORIES, isBuiltinCategory, type Branch, type Credential, type CredentialAccessOptions } from "@/lib/types";
import { HelperPicker } from "../tickets/[id]/helpers-card";

import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { OptionPicker } from "@/components/option-picker";
import { quickAddOption } from "@/app/actions/dropdowns";
import { Tooltip } from "@/components/tooltip";

/**
 * canDelete = มีสิทธิ์ vault.delete (API ตรวจซ้ำ)
 * การเข้าถึงรายรายการ: ทุกคนที่มีสิทธิ์คลังบัญชี (ค่าเดิม) / เฉพาะผู้ใช้-กลุ่มที่เลือก (+ เจ้าของ + ผู้สร้าง + ผู้มีสิทธิ์เห็นทุกรายการ)
 */
export function CredentialForm({
  credential,
  branches,
  customCategories = [],
  canDelete = false,
  accessOptions,
  canDisableReauth = false,
}: {
  credential?: Credential;
  branches: Branch[];
  customCategories?: string[];
  canDelete?: boolean;
  accessOptions: CredentialAccessOptions;
  /** ปิด "ต้องยืนยันก่อนเปิดดู" ได้ (สิทธิ์ vault.all — API ตรวจซ้ำ) */
  canDisableReauth?: boolean;
}) {
  const { t, locale } = useI18n();
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
  // ปิดได้เฉพาะผู้มีสิทธิ์ vault.all — รายการที่ปิดไว้แล้วเปิดกลับได้ทุกคน
  const reauthLocked = requireReauth && !canDisableReauth;
  const [accessMode, setAccessMode] = useState<"all" | "restricted">(credential?.access_mode ?? "all");
  const [accessUsers, setAccessUsers] = useState<number[]>((credential?.access_users ?? []).map((u) => u.id));
  const [accessGroups, setAccessGroups] = useState<string[]>(credential?.access_groups ?? []);
  // ผู้ใช้ที่เลือกไว้เดิมแต่ไม่อยู่ในตัวเลือกแล้ว (เช่น ถูกถอดสิทธิ์คลังบัญชี) ยังแสดงให้เอาออกได้
  const userOptions = [
    ...accessOptions.users,
    ...(credential?.access_users ?? []).filter((u) => !accessOptions.users.some((o) => o.id === u.id)),
  ].map((u) => ({ ...u, busy: null }));
  const clearAccessError = () => setErrors((e) => ({ ...e, access_mode: "", access_user_ids: "", access_groups: "" }));
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
    if (!v.category) return setErrors({ category: t("vault.form.categoryRequired") });
    const payload: CredentialPayload = { ...v, require_reauth: requireReauth, access_mode: accessMode, access_user_ids: accessUsers, access_groups: accessGroups };
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
  // หมวดตั้งต้น (แปลตามภาษา) + หมวดที่เพิ่มเอง (ข้อมูล Drop Down) — หมวดของบัญชีนี้ที่ไม่มีในรายการแล้วยังแสดงค่าเดิม
  // "อื่นๆ" อยู่ท้ายสุด (หลังหมวดที่เพิ่มเอง)
  const builtin = (c: (typeof CREDENTIAL_CATEGORIES)[number]) => ({ value: c, label: t(`vault.categories.${c}`) });
  const categoryOptions = [
    ...CREDENTIAL_CATEGORIES.filter((c) => c !== "other").map(builtin),
    ...customCategories.filter((c) => !isBuiltinCategory(c)).map((c) => ({ value: c, label: c })),
    builtin("other"),
  ];

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
          <OptionPicker
            id="category"
            options={categoryOptions}
            value={v.category}
            onChange={(value) => set("category", value)}
            onAdd={(name) => quickAddOption("vault_category", name)}
            maxLength={30}
            className={cls("category")}
          />,
          true,
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
            <Tooltip label={t(reauthLocked ? "vault.form.requireReauthLocked" : "vault.form.requireReauthHint")}>
            <label className={`flex shrink-0 items-center gap-2 text-sm ${reauthLocked ? "cursor-not-allowed" : "cursor-pointer"}`}>
              <button
                type="button"
                role="switch"
                aria-checked={requireReauth}
                disabled={reauthLocked}
                onClick={() => setRequireReauth((x) => !x)}
                className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${requireReauth ? "bg-accent-500" : "bg-line"}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${requireReauth ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <KeyIcon width={14} height={14} className={requireReauth ? "text-accent-500" : "text-faint"} />
              {t("vault.form.requireReauth")}
            </label>
            </Tooltip>
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

        {/* การเข้าถึงรายรายการ */}
        <div className="space-y-3 rounded-xl p-4 ring-1 ring-line sm:col-span-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <LockIcon width={14} height={14} className="text-accent-500" />
              {t("vault.access.title")}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t("vault.access.hint")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["all", "restricted"] as const).map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${accessMode === m ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"}`}
              >
                <input type="radio" name="access_mode" checked={accessMode === m} onChange={() => (setAccessMode(m), clearAccessError())} className="mt-0.5 cursor-pointer accent-[var(--accent-500)]" />
                <span>
                  <span className="block font-medium">{t(`vault.access.modes.${m}`)}</span>
                  <span className="block text-xs text-muted">{t(`vault.access.modeHints.${m}`)}</span>
                </span>
              </label>
            ))}
          </div>
          {accessMode === "restricted" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium">{t("vault.access.users")}</p>
                <HelperPicker
                  options={userOptions}
                  value={accessUsers}
                  onChange={(ids) => (setAccessUsers(ids), clearAccessError())}
                  searchLabel={t("vault.access.searchUser")}
                  noMatchLabel={t("vault.access.noUser")}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">{t("vault.access.groups")}</p>
                <div className="max-h-48 overflow-y-auto rounded-xl p-1 ring-1 ring-line">
                  {accessOptions.groups.map((g) => (
                    <label key={g.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle/60">
                      <input
                        type="checkbox"
                        checked={accessGroups.includes(g.key)}
                        onChange={() => (setAccessGroups((x) => (x.includes(g.key) ? x.filter((k) => k !== g.key) : [...x, g.key])), clearAccessError())}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                      />
                      {locale === "th" ? g.name_th : g.name_en}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted sm:col-span-2">{t("vault.access.alwaysSee")}</p>
            </div>
          )}
          {(errors.access_mode || errors.access_user_ids || errors.access_groups) && (
            <p className="text-xs font-medium text-red-500">{errors.access_mode || errors.access_user_ids || errors.access_groups}</p>
          )}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && canDelete && (
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
