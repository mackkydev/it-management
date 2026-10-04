"use client";

import { useActionState, useState } from "react";
import { login, loginWithConnection, type LoginState } from "@/app/actions/auth";
import { AlertIcon, LoginIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { LoginConnection } from "@/lib/types";

/**
 * ฟอร์มเข้าสู่ระบบ — "บัญชีในระบบ" (อีเมล + รหัสผ่านของระบบเรา) หรือ login ผ่านระบบต้นทางที่ Local Admin เปิดไว้
 * ไม่มีการเชื่อมต่อที่เปิดอยู่ = ฟอร์มเดิมทุกอย่าง
 */
export function LoginForm({ connections = [] }: { connections?: LoginConnection[] }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"local" | number>("local");
  const [localState, localAction, localPending] = useActionState<LoginState, FormData>(login, {});
  const [apiState, apiAction, apiPending] = useActionState<LoginState, FormData>(loginWithConnection, {});
  const conn = mode === "local" ? null : (connections.find((c) => c.id === mode) ?? null);
  const state = conn ? apiState : localState;
  const pending = conn ? apiPending : localPending;

  const tab = (active: boolean) =>
    `flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-accent-500/20 text-ink ring-1 ring-accent-400/40" : "text-muted hover:text-ink"}`;

  return (
    <div className="mt-8 space-y-5">
      {connections.length > 0 && (
        <div role="tablist" aria-label={t("auth.signInWith")} className="login-chip flex gap-1 rounded-xl p-1">
          <button type="button" role="tab" aria-selected={mode === "local"} onClick={() => setMode("local")} className={tab(mode === "local")}>
            {t("auth.localAccount")}
          </button>
          {connections.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={mode === c.id} onClick={() => setMode(c.id)} className={tab(mode === c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <form key={conn ? `api-${conn.id}` : "local"} action={conn ? apiAction : localAction} className="space-y-5">
        {conn ? (
          <div>
            <input type="hidden" name="connection_id" value={conn.id} />
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
              {t("auth.username")}
            </label>
            <input id="username" name="username" autoComplete="username" required defaultValue={apiState.username} className={`${input} py-2.5`} />
          </div>
        ) : (
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              {t("auth.emailOrUsername")}
            </label>
            <input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" required defaultValue={localState.email} className={`${input} py-2.5`} />
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="password" className="block text-sm font-medium">
              {t("auth.password")}
            </label>
            {/* API User: ลืม/เปลี่ยนรหัสผ่านทำที่ระบบต้นทางเท่านั้น */}
            {conn?.forgot_password_url && (
              <a href={conn.forgot_password_url} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-xs font-medium text-accent-300 hover:underline">
                {t("auth.forgotPassword")}
              </a>
            )}
          </div>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={`${input} py-2.5`} />
        </div>
        {state.error && (
          <p role="alert" className={alert.error}>
            <AlertIcon className="shrink-0 text-danger-400" />
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} w-full py-2.5`}>
          {pending ? <SpinnerIcon /> : <LoginIcon />}
          {pending ? t("auth.loggingIn") : t("auth.login")}
        </button>
        {conn?.register_url && (
          <p className="login-muted text-center text-sm">
            {t("auth.noAccount")}{" "}
            <a href={conn.register_url} target="_blank" rel="noopener noreferrer" className="cursor-pointer font-medium text-accent-300 hover:underline">
              {t("auth.registerAt", { name: conn.name })}
            </a>
          </p>
        )}
      </form>
    </div>
  );
}
