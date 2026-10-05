"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { deleteConnection, saveConnection, syncNow, testConnection, type ConnectionPayload } from "@/app/actions/access";
import { ChipList } from "@/components/chip-list";
import { AlertIcon, CheckCircleIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import { API_AUTH_TYPES, API_ERROR_KINDS, type ApiConnection, type ApiConnectionTest, type ApiErrorKind, type SyncResult } from "@/lib/types";
import { AppSelect } from "@/components/app-select";

type Rule = { value: string; role: "manager" | "viewer" };
type ErrorRow = { code: string; kind: ApiErrorKind; message_th: string; message_en: string };

/** ค่าในฟอร์ม (ตัวเลขเก็บเป็นข้อความระหว่างแก้) */
function initialValues(c: ApiConnection | null) {
  return {
    name: c?.name ?? "",
    is_enabled: c?.is_enabled ?? false,
    base_url: c?.base_url ?? "https://",
    timeout_ms: String(c?.timeout_ms ?? 10000),
    login_method: c?.login_method ?? "POST",
    login_path: c?.login_path ?? "",
    login_username_field: c?.login_username_field ?? "username",
    login_password_field: c?.login_password_field ?? "password",
    login_body_type: c?.login_body_type ?? "json",
    profile_method: c?.profile_method ?? "GET",
    profile_path: c?.profile_path ?? "",
    profile_root_path: c?.profile_root_path ?? "",
    logout_path: c?.logout_path ?? "",
    refresh_path: c?.refresh_path ?? "",
    token_path: c?.token_path ?? "token",
    token_ttl_path: c?.token_ttl_path ?? "",
    refresh_token_path: c?.refresh_token_path ?? "",
    default_token_ttl_seconds: String(c?.default_token_ttl_seconds ?? 86400),
    profile_cache_seconds: String(c?.profile_cache_seconds ?? 600),
    map_external_id: c?.field_map.external_id ?? "id",
    map_name: c?.field_map.name ?? "name",
    map_email: c?.field_map.email ?? "email",
    map_role_code: c?.field_map.role_code ?? "",
    default_role: c?.default_role ?? "viewer",
    error_code_path: c?.error_code_path ?? "",
    auth_type: c?.auth_type ?? "none",
    auth_header_name: c?.auth_header_name ?? "",
    auth_username: c?.auth_username ?? "",
    auth_secret: "",
    clear_auth_secret: false,
    max_redirects: String(c?.max_redirects ?? 0),
    register_url: c?.register_url ?? "",
    forgot_password_url: c?.forgot_password_url ?? "",
    change_password_url: c?.change_password_url ?? "",
    users_list_path: c?.users_list_path ?? "",
    users_list_root_path: c?.users_list_root_path ?? "",
    users_page_param: c?.users_page_param ?? "",
    users_page_size_param: c?.users_page_size_param ?? "",
    users_page_size: String(c?.users_page_size ?? 100),
    map_status: c?.field_map.status ?? "",
    sync_interval_minutes: String(c?.sync_interval_minutes ?? 0),
  };
}
type Values = ReturnType<typeof initialValues>;

export function ConnectionForm({ connection }: { connection: ApiConnection | null }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<Values>(() => initialValues(connection));
  const [rules, setRules] = useState<Rule[]>(connection?.role_rules ?? []);
  const [errorRows, setErrorRows] = useState<ErrorRow[]>(() =>
    Object.entries(connection?.error_messages ?? {}).map(([code, e]) => ({ code, kind: e.kind, message_th: e.message_th ?? "", message_en: e.message_en ?? "" })),
  );
  const [hosts, setHosts] = useState<string[]>(connection?.allowed_hosts ?? []);
  const [activeValues, setActiveValues] = useState<string[]>(connection?.active_values ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setV((s) => ({ ...s, [key]: value }));
    // ล้าง error ของช่องนั้นทันทีเมื่อผู้ใช้แก้
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
  };
  const err = (key: string) => errors[key];
  const errPrefix = (prefix: string) => Object.entries(errors).find(([k]) => k === prefix || k.startsWith(`${prefix}.`))?.[1];
  const cls = (key: string) => `${input} ${err(key) ? inputError : ""}`;
  const label = (key: string) => t(`apiConnections.fields.${key}` as MessageKey);

  const field = (key: keyof Values, opts: { hint?: string; type?: string; errorKey?: string; placeholder?: string; mono?: boolean } = {}) => (
    <div>
      <label htmlFor={key} className="mb-1 block text-sm font-medium">
        {label(key)}
      </label>
      <input
        id={key}
        type={opts.type ?? "text"}
        value={String(v[key])}
        placeholder={opts.placeholder}
        onChange={(e) => set(key, e.target.value as never)}
        className={`${cls(opts.errorKey ?? key)} ${opts.mono ? "font-mono text-xs" : ""}`}
      />
      {err(opts.errorKey ?? key) ? <p className="mt-1 text-xs font-medium text-red-500">{err(opts.errorKey ?? key)}</p> : opts.hint && <p className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
  );
  const select = (key: keyof Values, options: { value: string; label: string }[]) => (
    <div>
      <label htmlFor={key} className="mb-1 block text-sm font-medium">
        {label(key)}
      </label>
      <AppSelect id={key} value={String(v[key])} onChange={(e) => set(key, e.target.value as never)} className={cls(key)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </AppSelect>
      {err(key) && <p className="mt-1 text-xs font-medium text-red-500">{err(key)}</p>}
    </div>
  );
  const section = (title: MessageKey, children: ReactNode, hint?: string) => (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="font-semibold">{t(title)}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
  const opt = (values: readonly string[]) => values.map((x) => ({ value: x, label: x }));
  const jsonHint = t("apiConnections.hints.jsonPath");
  const pathHint = t("apiConnections.hints.path");

  const payload = (): ConnectionPayload => ({
    name: v.name,
    is_enabled: v.is_enabled,
    base_url: v.base_url.trim(),
    timeout_ms: Number(v.timeout_ms),
    login_method: v.login_method,
    login_path: v.login_path.trim(),
    login_username_field: v.login_username_field.trim(),
    login_password_field: v.login_password_field.trim(),
    login_body_type: v.login_body_type as "json" | "form",
    profile_method: v.profile_method,
    profile_path: v.profile_path.trim() || null,
    profile_root_path: v.profile_root_path.trim() || null,
    logout_path: v.logout_path.trim() || null,
    refresh_path: v.refresh_path.trim() || null,
    token_path: v.token_path.trim(),
    token_ttl_path: v.token_ttl_path.trim() || null,
    refresh_token_path: v.refresh_token_path.trim() || null,
    default_token_ttl_seconds: Number(v.default_token_ttl_seconds),
    profile_cache_seconds: Number(v.profile_cache_seconds),
    field_map: { external_id: v.map_external_id.trim(), name: v.map_name.trim(), email: v.map_email.trim(), role_code: v.map_role_code.trim(), status: v.map_status.trim() },
    role_rules: rules.filter((r) => r.value.trim() !== ""),
    default_role: v.default_role as "manager" | "viewer",
    error_code_path: v.error_code_path.trim() || null,
    error_messages: Object.fromEntries(
      errorRows.filter((r) => r.code.trim() !== "").map((r) => [r.code.trim(), { kind: r.kind, message_th: r.message_th || null, message_en: r.message_en || null }]),
    ),
    auth_type: v.auth_type as ConnectionPayload["auth_type"],
    auth_header_name: v.auth_header_name.trim() || null,
    auth_username: v.auth_username.trim() || null,
    auth_secret: v.auth_secret,
    clear_auth_secret: v.clear_auth_secret,
    allowed_hosts: hosts,
    max_redirects: Number(v.max_redirects),
    register_url: v.register_url.trim() || null,
    forgot_password_url: v.forgot_password_url.trim() || null,
    change_password_url: v.change_password_url.trim() || null,
    users_list_path: v.users_list_path.trim() || null,
    users_list_root_path: v.users_list_root_path.trim() || null,
    users_page_param: v.users_page_param.trim() || null,
    users_page_size_param: v.users_page_size_param.trim() || null,
    users_page_size: Number(v.users_page_size) || 100,
    active_values: activeValues,
    sync_interval_minutes: Number(v.sync_interval_minutes) || 0,
  });

  const save = () =>
    start(async () => {
      const res = await saveConnection(connection?.id ?? null, payload());
      setErrors((res.errors as Record<string, string>) ?? {});
      setResult({ ok: Boolean(res.ok), text: res.message ?? "" });
      if (res.ok) {
        set("auth_secret", "");
        if (!connection && res.id) router.replace(`/api-connections/${res.id}`);
        else router.refresh();
      }
    });

  const remove = () => {
    if (!connection || !confirm(t("apiConnections.deleteConfirm", { name: connection.name }))) return;
    start(async () => {
      const res = await deleteConnection(connection.id);
      if (res.ok) router.replace("/api-connections");
      else setResult({ ok: false, text: res.message ?? "" });
    });
  };

  return (
    <div className="space-y-5">
      {section(
        "apiConnections.sections.general",
        <>
          {field("name")}
          {field("base_url", { hint: t("apiConnections.hints.baseUrl"), placeholder: "https://hr.example.com/api" })}
          {field("timeout_ms", { type: "number" })}
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm font-medium">
            <input type="checkbox" checked={v.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} className="cursor-pointer accent-[var(--accent-500)]" />
            {label("is_enabled")}
          </label>
        </>,
      )}

      {section(
        "apiConnections.sections.login",
        <>
          {select("login_method", opt(["POST", "PUT", "PATCH", "GET"]))}
          {field("login_path", { hint: pathHint, placeholder: "/auth/login", mono: true })}
          {field("login_username_field", { mono: true })}
          {field("login_password_field", { mono: true })}
          {select("login_body_type", opt(["json", "form"]))}
        </>,
      )}

      {section(
        "apiConnections.sections.token",
        <>
          {field("token_path", { hint: jsonHint, mono: true })}
          {field("token_ttl_path", { hint: t("apiConnections.hints.ttlPath"), mono: true })}
          {field("default_token_ttl_seconds", { type: "number" })}
          {field("profile_cache_seconds", { type: "number" })}
          {field("refresh_token_path", { hint: jsonHint, mono: true })}
          {field("refresh_path", { hint: pathHint, mono: true })}
          {field("logout_path", { hint: pathHint, mono: true })}
        </>,
        t("apiConnections.hints.userSession"),
      )}

      {section(
        "apiConnections.sections.profile",
        <>
          {field("profile_path", { hint: t("apiConnections.hints.profilePath"), mono: true })}
          {select("profile_method", opt(["GET", "POST"]))}
          {field("profile_root_path", { hint: jsonHint, mono: true })}
          <div />
          {field("map_external_id", { errorKey: "field_map.external_id", mono: true })}
          {field("map_name", { errorKey: "field_map.name", mono: true })}
          {field("map_email", { errorKey: "field_map.email", mono: true })}
          {field("map_role_code", { errorKey: "field_map.role_code", mono: true })}
        </>,
      )}

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("apiConnections.sections.roles")}</h2>
        <p className="mt-1 text-sm text-muted">{t("apiConnections.hints.roleRules")}</p>
        <div className="mt-4 space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <input
                value={r.value}
                placeholder={t("apiConnections.value")}
                onChange={(e) => setRules((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                className={`${input} flex-1 ${errPrefix(`role_rules.${i}`) ? inputError : ""}`}
              />
              <AppSelect value={r.role} onChange={(e) => setRules((s) => s.map((x, j) => (j === i ? { ...x, role: e.target.value as Rule["role"] } : x)))} className={`${input} w-48`}>
                <option value="manager">{t("roles.manager")}</option>
                <option value="viewer">{t("roles.viewer")}</option>
              </AppSelect>
              <button type="button" onClick={() => setRules((s) => s.filter((_, j) => j !== i))} aria-label={t("apiConnections.remove")} className={`${btn.secondary} px-3`}>
                <XIcon width={14} height={14} />
              </button>
              {errPrefix(`role_rules.${i}`) && <p className="w-full text-xs font-medium text-red-500">{errPrefix(`role_rules.${i}`)}</p>}
            </div>
          ))}
          <button type="button" onClick={() => setRules((s) => [...s, { value: "", role: "manager" }])} className={`${btn.secondary} ${btn.sm}`}>
            <PlusIcon width={13} height={13} />
            {t("apiConnections.addRule")}
          </button>
        </div>
        <div className="mt-4 max-w-sm">
          {select("default_role", [
            { value: "viewer", label: t("roles.viewer") },
            { value: "manager", label: t("roles.manager") },
          ])}
        </div>
      </section>

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("apiConnections.sections.errors")}</h2>
        <p className="mt-1 text-sm text-muted">{t("apiConnections.hints.errorMessages")}</p>
        <div className="mt-4 max-w-sm">{field("error_code_path", { hint: jsonHint, mono: true })}</div>
        <div className="mt-4 space-y-2">
          {errorRows.map((r, i) => {
            const upd = (patch: Partial<ErrorRow>) => setErrorRows((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            const e = errPrefix(`error_messages.${r.code}`);
            return (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-xl p-3 ring-1 ring-line sm:grid-cols-[8rem_12rem_1fr_1fr_auto]">
                <input value={r.code} placeholder={t("apiConnections.code")} onChange={(ev) => upd({ code: ev.target.value })} className={`${input} font-mono text-xs ${e ? inputError : ""}`} />
                <AppSelect value={r.kind} onChange={(ev) => upd({ kind: ev.target.value as ApiErrorKind })} className={input} aria-label={t("apiConnections.kind")}>
                  {API_ERROR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`apiConnections.errorKinds.${k}`)}
                    </option>
                  ))}
                </AppSelect>
                <input value={r.message_th} placeholder={t("apiConnections.messageTh")} disabled={r.kind === "invalid"} onChange={(ev) => upd({ message_th: ev.target.value })} className={`${input} disabled:opacity-50`} />
                <input value={r.message_en} placeholder={t("apiConnections.messageEn")} disabled={r.kind === "invalid"} onChange={(ev) => upd({ message_en: ev.target.value })} className={`${input} disabled:opacity-50`} />
                <button type="button" onClick={() => setErrorRows((s) => s.filter((_, j) => j !== i))} aria-label={t("apiConnections.remove")} className={`${btn.secondary} px-3`}>
                  <XIcon width={14} height={14} />
                </button>
                {e && <p className="text-xs font-medium text-red-500 sm:col-span-5">{e}</p>}
              </div>
            );
          })}
          <button type="button" onClick={() => setErrorRows((s) => [...s, { code: "", kind: "invalid", message_th: "", message_en: "" }])} className={`${btn.secondary} ${btn.sm}`}>
            <PlusIcon width={13} height={13} />
            {t("apiConnections.addError")}
          </button>
        </div>
      </section>

      {section(
        "apiConnections.sections.auth",
        <>
          {select(
            "auth_type",
            API_AUTH_TYPES.map((a) => ({ value: a, label: t(`apiConnections.authTypes.${a}`) })),
          )}
          {v.auth_type === "api_key" && field("auth_header_name", { placeholder: "X-API-Key", mono: true })}
          {v.auth_type === "basic" && field("auth_username")}
          {v.auth_type !== "none" && (
            <div className="sm:col-span-2">
              {field("auth_secret", {
                type: "password",
                hint: connection?.has_auth_secret ? t("apiConnections.hints.secretSet") : t("apiConnections.hints.secretNotSet"),
              })}
              {connection?.has_auth_secret && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={v.clear_auth_secret} onChange={(e) => set("clear_auth_secret", e.target.checked)} className="cursor-pointer accent-[var(--accent-500)]" />
                  {t("apiConnections.hints.clearSecret")}
                </label>
              )}
            </div>
          )}
        </>,
      )}

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("apiConnections.sections.security")}</h2>
        <p className="mt-1 text-sm text-muted">{t("apiConnections.hints.allowedHosts")}</p>
        <div className="mt-4">
          <ChipList
            items={hosts}
            onChange={setHosts}
            placeholder="10.0.0.0/8, hr.internal"
            addLabel={t("apiConnections.addHost")}
            validate={(h) => (/^[A-Za-z0-9.:/-]+$/.test(h) ? null : t("apiConnections.fields.allowed_hosts"))}
          />
          {errPrefix("allowed_hosts") && <p className="mt-1 text-xs font-medium text-red-500">{errPrefix("allowed_hosts")}</p>}
        </div>
        <div className="mt-4 max-w-xs">{field("max_redirects", { type: "number" })}</div>
      </section>

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("apiConnections.sections.sync")}</h2>
        <p className="mt-1 text-sm text-muted">{t("apiConnections.hints.sync")}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("users_list_path", { hint: pathHint, placeholder: "/users", mono: true })}
          {field("users_list_root_path", { hint: jsonHint, placeholder: "data.items", mono: true })}
          {field("users_page_param", { placeholder: "page", mono: true })}
          {field("users_page_size_param", { placeholder: "per_page", mono: true })}
          {field("users_page_size", { type: "number" })}
          {field("sync_interval_minutes", { type: "number", hint: t("apiConnections.hints.syncInterval") })}
          {field("map_status", { errorKey: "field_map.status", hint: t("apiConnections.hints.statusPath"), mono: true })}
          <div>
            <p className="mb-1 text-sm font-medium">{label("active_values")}</p>
            <ChipList items={activeValues} onChange={setActiveValues} placeholder="active" addLabel={t("apiConnections.addHost")} validate={(x) => (x.trim().length <= 100 ? null : t("apiConnections.fields.active_values"))} />
            <p className="mt-1 text-xs text-muted">{t("apiConnections.hints.activeValues")}</p>
          </div>
        </div>
        {connection && <SyncPanel id={connection.id} last={connection.last_sync_result} lastAt={connection.last_synced_at} />}
      </section>

      {section(
        "apiConnections.sections.links",
        <>
          {field("forgot_password_url", { placeholder: "https://" })}
          {field("change_password_url", { placeholder: "https://" })}
          {field("register_url", { placeholder: "https://" })}
        </>,
      )}

      {result && (
        <p role="status" className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {connection && connection.users_count === 0 ? (
          <button type="button" onClick={remove} disabled={pending} className={`${btn.danger} disabled:cursor-not-allowed`}>
            <TrashIcon />
            {t("common.delete")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("common.save")}
        </button>
      </div>

      {connection ? <TestPanel id={connection.id} fmtSeconds={(s) => fmt.number(Math.round(s / 3600)) + " h"} /> : <p className="text-sm text-muted">{t("apiConnections.test.saveFirst")}</p>}
    </div>
  );
}

/** ทดสอบด้วยบัญชีจริง — แสดงผลการ map (ไม่สร้างผู้ใช้ / ไม่เก็บรหัสผ่าน) */
function TestPanel({ id, fmtSeconds }: { id: number; fmtSeconds: (s: number) => string }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [res, setRes] = useState<ApiConnectionTest | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setRes(null);
      const r = await testConnection(id, username.trim(), password);
      setPassword("");
      setMessage(r.ok ? "" : (r.message ?? ""));
      if (r.data) setRes(r.data);
    });

  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="font-semibold">{t("apiConnections.test.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("apiConnections.test.hint")}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("auth.username")} autoComplete="off" className={input} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.password")} autoComplete="new-password" className={input} />
        <button type="button" onClick={run} disabled={pending || !username || !password} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <CheckCircleIcon />}
          {pending ? t("apiConnections.test.running") : t("apiConnections.test.run")}
        </button>
      </div>
      {message && <p className={`mt-3 ${alert.error}`}>{message}</p>}
      {res &&
        (res.ok ? (
          <div className={`mt-3 ${alert.success} flex-col items-start`}>
            <p className="font-medium">{t("apiConnections.test.ok")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>{t("apiConnections.fields.map_external_id")}</dt>
              <dd className="font-mono">{res.profile.external_id}</dd>
              <dt>{t("apiConnections.fields.map_name")}</dt>
              <dd>{res.profile.name}</dd>
              <dt>{t("apiConnections.fields.map_email")}</dt>
              <dd>{res.profile.email ?? "-"}</dd>
              <dt>{t("apiConnections.fields.map_role_code")}</dt>
              <dd>
                {res.profile.role_code ?? "-"} → {t(`roles.${res.profile.role}`)}
              </dd>
            </dl>
            <p className="text-xs">
              {t("apiConnections.test.expiresIn", { value: fmtSeconds(res.token_expires_in) })}
              {res.has_refresh_token ? ` · ${t("apiConnections.test.refresh")}` : ""}
            </p>
          </div>
        ) : (
          <p className={`mt-3 ${alert.error}`}>
            <AlertIcon className="shrink-0 text-danger-400" />
            {t("apiConnections.test.failed")}: {res.message}
          </p>
        ))}
    </section>
  );
}

/** ผลการซิงค์ล่าสุด + ปุ่มซิงค์ตอนนี้ */
function SyncPanel({ id, last, lastAt }: { id: number; last: SyncResult | null; lastAt: string | null }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [result, setResult] = useState<SyncResult | null>(last);
  const [at, setAt] = useState<string | null>(lastAt);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setMessage("");
      const res = await syncNow(id);
      if (res.data) {
        setResult(res.data);
        setAt(new Date().toISOString());
        router.refresh();
      } else setMessage(res.message ?? "");
    });

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-subtle p-4">
      <div className="text-sm">
        <p className="font-medium">
          {t("apiConnections.sync.last")}: {at ? fmt.dateTime(at) : t("apiConnections.sync.never")}
        </p>
        {result &&
          (result.ok ? (
            <p className="mt-1 text-muted">
              {t("apiConnections.sync.summary", {
                fetched: fmt.number(result.fetched),
                created: fmt.number(result.created),
                disabled: fmt.number(result.disabled + result.missing),
                reactivated: fmt.number(result.reactivated),
              })}
            </p>
          ) : (
            <p className="mt-1 text-danger-600 dark:text-danger-300">
              {t("apiConnections.sync.failed")}: {result.error}
            </p>
          ))}
        {message && <p className="mt-1 text-danger-600 dark:text-danger-300">{message}</p>}
      </div>
      <button type="button" onClick={run} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? <SpinnerIcon /> : <CheckCircleIcon />}
        {pending ? t("apiConnections.sync.running") : t("apiConnections.sync.now")}
      </button>
    </div>
  );
}
