"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { AlertIcon, LoginIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export function LoginForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="mt-8 space-y-5">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          {t("auth.email")}
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className={`${input} py-2.5`} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          {t("auth.password")}
        </label>
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
    </form>
  );
}
