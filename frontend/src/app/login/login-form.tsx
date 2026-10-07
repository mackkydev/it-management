"use client";

import { useActionState, useEffect, useState } from "react";
import { getConnectionStatus, login, loginWithConnection, type ConnectionStatus, type LoginState } from "@/app/actions/auth";
import { AlertIcon, LoginIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, input, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { LoginConnection } from "@/lib/types";
import { PasswordInput } from "@/components/password-input";

/** ตรวจสถานะการเชื่อมต่อต้นทางซ้ำทุก 1 นาทีขณะเปิดหน้า login (API cache ไว้ 1 นาทีอยู่แล้ว) */
const STATUS_REFRESH_MS = 60_000;
const STATUS_DOT: Record<ConnectionStatus | "checking", string> = {
  checking: `${tone.idle.dot} animate-pulse`,
  online: tone.success.dot,
  offline: tone.danger.dot,
  unknown: tone.idle.dot,
};
type StatusKey = ConnectionStatus | "checking";
type ServerStatus = "online" | "offline" | "none" | "checking";
const SERVER_DOT: Record<ServerStatus, string> = { online: tone.success.dot, offline: tone.danger.dot, none: tone.idle.dot, checking: `${tone.idle.dot} animate-pulse` };

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
  const [statuses, setStatuses] = useState<Record<number, ConnectionStatus>>({});
  const ids = connections.map((c) => c.id).join(",");

  // สถานะการเชื่อมต่อแต่ละช่องทาง (แถบสถานะด้านบนฟอร์ม + จุดสีบนแท็บ) — เห็นได้ก่อน login
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    const check = () =>
      ids.split(",").map(Number).forEach((id) =>
        void getConnectionStatus(id).then((s) => alive && setStatuses((prev) => ({ ...prev, [id]: s }))),
      );
    check();
    const timer = window.setInterval(check, STATUS_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [ids]);
  const statusOf = (id: number): StatusKey => statuses[id] ?? "checking";
  // รวมเป็นสถานะเดียว: มีอย่างน้อย 1 การเชื่อมต่อที่ต่อได้ = online / ต่อไม่ได้ = offline / ไม่มีการเชื่อมต่อ หรือตรวจไม่ได้ = none
  const all = connections.map((c) => statusOf(c.id));
  const server: ServerStatus = all.includes("online") ? "online" : all.includes("offline") ? "offline" : all.includes("checking") ? "checking" : "none";

  const tab = (active: boolean) =>
    `flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-accent-500/20 text-ink ring-1 ring-accent-400/40" : "text-muted hover:text-ink"}`;

  return (
    <div className="mt-8 space-y-5">
      {/* สถานะการเชื่อมต่อ Server (API ต้นทาง) — มุมบนขวาของกล่อง login แนวเดียวกับไอคอน (.login-card เป็น relative) */}
      <p role="status" aria-live="polite" className="login-chip absolute right-8 top-[43px] flex items-center gap-2 rounded-full px-3 py-1 text-xs sm:right-10 sm:top-[51px]">
        <span className={`h-2 w-2 shrink-0 rounded-full ${SERVER_DOT[server]}`} aria-hidden="true" />
        <span className={server === "online" ? "text-success-300" : server === "offline" ? "text-danger-300" : "login-muted"}>{t(`auth.serverStatus.${server === "checking" ? "none" : server}`)}</span>
      </p>

      {connections.length > 0 && (
        <div role="tablist" aria-label={t("auth.signInWith")} className="login-chip flex gap-1 rounded-xl p-1">
          <button type="button" role="tab" aria-selected={mode === "local"} onClick={() => setMode("local")} className={tab(mode === "local")}>
            {t("auth.localAccount")}
          </button>
          {connections.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={mode === c.id} onClick={() => setMode(c.id)} className={`${tab(mode === c.id)} inline-flex items-center justify-center gap-2`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[statusOf(c.id)]}`} aria-hidden="true" />
              {c.name}
            </button>
          ))}
        </div>
      )}

      <form key={conn ? `api-${conn.id}` : "local"} action={conn ? apiAction : localAction} className="space-y-5">
        {conn && statusOf(conn.id) === "offline" && (
          <p className={alert.error}>
            <AlertIcon className="shrink-0 text-danger-400" />
            {t("auth.apiOfflineHint", { name: conn.name })}
          </p>
        )}
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
          <PasswordInput id="password" name="password" autoComplete="current-password" required className={`${input} py-2.5`} />
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
