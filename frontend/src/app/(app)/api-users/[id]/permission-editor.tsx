"use client";

import { useMemo, useState, useTransition } from "react";
import { saveUserPermissions } from "@/app/actions/access";
import { AlertIcon, CheckCircleIcon, CheckIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { PermissionDef, PermissionGroup, UserPermissionView } from "@/lib/types";

type Choice = "inherit" | "allow" | "deny";
const GROUPS: PermissionGroup[] = ["tickets", "it_data", "assets", "users", "system"];

/**
 * แก้บทบาท (API User: ผู้จัดการ / ผู้ใช้งานทั่วไป) + ตั้งสิทธิ์รายตัว: ตามบทบาท / อนุญาต / ไม่อนุญาต
 * สิทธิ์จริง = (บทบาทให้ หรือ อนุญาต) และไม่ได้ "ไม่อนุญาต" — แสดงผลทันทีก่อนบันทึก
 */
export function PermissionEditor({
  initial,
  catalog,
  rolePermissions,
}: {
  initial: UserPermissionView;
  catalog: PermissionDef[];
  rolePermissions: Record<string, string[]>;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState(initial);
  const [role, setRole] = useState(initial.user.role);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => ({ ...initial.overrides }));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const isApi = view.user.type === "API";
  // role ตาม appIds จากต้นทางอัตโนมัติ → แก้รายคนไม่ได้
  const roleEditable = isApi && !view.role_synced;

  // สิทธิ์จากกลุ่มตามบทบาทที่เลือกอยู่ (+ it_staff / it_head ตาม flag)
  const inherited = useMemo(() => {
    const groups = [role, ...(view.user.is_it_staff ? ["it_staff"] : []), ...(view.user.is_it_head ? ["it_head"] : [])];
    return new Set(groups.flatMap((g) => rolePermissions[g] ?? []));
  }, [role, view.user.is_it_staff, view.user.is_it_head, rolePermissions]);

  const choiceOf = (key: string): Choice => choices[key] ?? "inherit";
  const effective = (key: string) => view.is_local_admin || ((inherited.has(key) || choiceOf(key) === "allow") && choiceOf(key) !== "deny");

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(choices), ...Object.keys(view.overrides)]);
    const changed = [...keys].filter((k) => (choices[k] ?? "inherit") !== (view.overrides[k] ?? "inherit"));
    return { keys: changed, role: role !== view.user.role };
  }, [choices, view, role]);

  const save = () =>
    start(async () => {
      const overrides = Object.fromEntries(dirty.keys.map((k) => [k, choiceOf(k)]));
      const res = await saveUserPermissions(view.user.id, { ...(dirty.role ? { role: role as "manager" | "viewer" } : {}), overrides });
      if (res.ok && res.data) {
        setView(res.data);
        setRole(res.data.user.role);
        setChoices({ ...res.data.overrides });
      }
      setResult({ ok: Boolean(res.ok), text: res.message ?? "" });
    });

  const seg = (active: boolean, kind: Choice) =>
    `cursor-pointer px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
      active
        ? kind === "allow"
          ? tone.success.badge
          : kind === "deny"
            ? tone.danger.badge
            : "bg-accent-100 text-accent-800 dark:bg-accent-400/20 dark:text-accent-200"
        : "text-muted hover:bg-subtle hover:text-ink"
    }`;

  return (
    <div className="space-y-5">
      {view.is_local_admin && (
        <p className={alert.info}>
          <AlertIcon className="shrink-0" />
          {t("access.localAdminNote")}
        </p>
      )}

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("access.role")}</h2>
        <p className="mt-1 text-sm text-muted">{!isApi ? t("access.roleLocal") : view.role_synced ? t("access.roleSynced") : t("access.roleHint")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {(isApi ? (["manager", "viewer"] as const) : [view.user.role]).map((r) => (
            <label
              key={r}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm ring-1 transition-colors ${role === r ? "bg-accent-100 ring-accent-300 dark:bg-accent-400/15 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"} ${!roleEditable ? "cursor-not-allowed opacity-70" : ""}`}
            >
              <input type="radio" name="role" value={r} checked={role === r} disabled={!roleEditable} onChange={() => setRole(r)} className="cursor-pointer accent-[var(--accent-500)]" />
              {t(`roles.${r}`)}
            </label>
          ))}
        </div>
        {(view.user.is_it_staff || view.user.is_it_head) && <p className="mt-3 text-xs text-muted">{t("access.itFlags")}</p>}
      </section>

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="mb-4 font-semibold">{t("access.permissionsTitle")}</h2>
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const items = catalog.filter((p) => p.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t(`access.groups.${g}` as MessageKey)}</h3>
                <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                  {items.map((p) => {
                    const on = effective(p.key);
                    return (
                      <li key={p.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{locale === "th" ? p.name_th : p.name_en}</p>
                          <p className="mt-0.5 text-xs text-faint">
                            {p.key} · {inherited.has(p.key) ? t("access.fromRole") : t("access.notFromRole")}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div role="radiogroup" aria-label={locale === "th" ? p.name_th : p.name_en} className="inline-flex rounded-lg ring-1 ring-line">
                            {(["inherit", "allow", "deny"] as const).map((c) => (
                              <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={choiceOf(p.key) === c}
                                disabled={view.is_local_admin}
                                onClick={() => setChoices((s) => ({ ...s, [p.key]: c }))}
                                className={`${seg(choiceOf(p.key) === c, c)} disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {t(`access.${c}`)}
                              </button>
                            ))}
                          </div>
                          <span className={`inline-flex w-28 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${on ? tone.success.badge : tone.idle.badge}`}>
                            {on ? <CheckIcon width={12} height={12} /> : <XIcon width={12} height={12} />}
                            {on ? t("access.granted") : t("access.notGranted")}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {result && (
        <p role="status" className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}

      <div className="sticky bottom-4 flex items-center justify-end gap-3">
        {(dirty.keys.length > 0 || dirty.role) && (
          <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-line">
            {t("access.changed", { count: dirty.keys.length + (dirty.role ? 1 : 0) })}
          </span>
        )}
        <button type="button" onClick={save} disabled={pending || view.is_local_admin || (dirty.keys.length === 0 && !dirty.role)} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("access.save")}
        </button>
      </div>
    </div>
  );
}
