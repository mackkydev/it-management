"use client";

import { useMemo, useState, useTransition } from "react";
import { saveUserPermissions } from "@/app/actions/access";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, CheckIcon, PlusIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { PermissionMatrix } from "@/components/permission-matrix";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input as inputBase, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import { ROLES, type OverrideValue, type PermissionCatalog, type PermissionDef, type Role, type UserPermissionView } from "@/lib/types";

type Choice = OverrideValue | "inherit";
type Assigned = { key: string; expires_on: string | null };

const ADMIN_ROLES: Role[] = ["super_admin", "admin"];
const sameGroups = (a: Assigned[], b: Assigned[]) => JSON.stringify([...a].sort((x, y) => x.key.localeCompare(y.key))) === JSON.stringify([...b].sort((x, y) => x.key.localeCompare(y.key)));

/**
 * สิทธิ์การใช้งานของผู้ใช้: ตำแหน่ง + กลุ่มที่มอบเพิ่ม (หลายกลุ่ม, ตั้งวันหมดอายุได้) + สิทธิ์รายข้อ (ตาราง ระบบงาน × การกระทำ)
 * สิทธิ์จริง = (ตำแหน่ง + กลุ่ม ให้ หรือ อนุญาตรายคน) และไม่ได้ "ไม่อนุญาตรายคน" — คำนวณให้เห็นทันทีก่อนบันทึก (API ตรวจกติกาการมอบซ้ำ)
 */
export function PermissionEditor({ initial, catalog, superAdmin }: { initial: UserPermissionView; catalog: PermissionCatalog; superAdmin: boolean }) {
  const { t, locale } = useI18n();
  const today = localToday();
  const [view, setView] = useState(initial);
  const [role, setRole] = useState<Role>(initial.user.role);
  const [groups, setGroups] = useState<Assigned[]>(initial.assigned_groups);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => ({ ...initial.overrides }));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const expiry = catalog.expiry_enabled;
  const readOnly = Boolean(view.locked_reason);
  const isSuper = role === "super_admin";
  const name = (x: { name_th: string; name_en: string }) => (locale === "th" ? x.name_th : x.name_en);
  const expired = (date: string | null) => expiry && date !== null && date < today;

  // สิทธิ์จากตำแหน่ง + กลุ่มที่มอบเพิ่ม (ที่ยังไม่หมดอายุ)
  const inherited = useMemo(() => {
    const active = [role, ...groups.filter((g) => !expired(g.expires_on)).map((g) => g.key)];
    return new Set(active.flatMap((g) => catalog.role_permissions[g] ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, groups, catalog.role_permissions, expiry, today]);

  const choiceOf = (key: string): Choice => choices[key] ?? "inherit";
  const effectOf = (key: string) => {
    const c = choiceOf(key);
    return c === "inherit" || expired(c.expires_on) ? null : c.effect;
  };
  const effective = (key: string) => isSuper || ((inherited.has(key) || effectOf(key) === "allow") && effectOf(key) !== "deny");

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(choices), ...Object.keys(view.overrides)]);
    const changed = [...keys].filter((k) => JSON.stringify(choices[k] ?? "inherit") !== JSON.stringify(view.overrides[k] ?? "inherit"));
    return { keys: changed, role: role !== view.user.role, groups: !sameGroups(groups, view.assigned_groups) };
  }, [choices, view, role, groups]);
  const dirtyCount = dirty.keys.length + (dirty.role ? 1 : 0) + (dirty.groups ? 1 : 0);

  // ตำแหน่งที่เลือกได้: super_admin เฉพาะผู้ดูแลระบบ · ซิงก์ตำแหน่งจากต้นทาง = ตั้ง/ถอดได้เฉพาะตำแหน่งผู้ดูแลระบบ
  const roleBlocked = (r: Role) => {
    if (readOnly) return t("access.lockedTarget");
    if ((r === "super_admin" || view.user.role === "super_admin") && !superAdmin) return t("access.roleSuperOnly");
    if (view.role_synced && !ADMIN_ROLES.includes(r) && !ADMIN_ROLES.includes(view.user.role) && r !== view.user.role) return t("access.roleSynced");
    return null;
  };

  const cycle = (p: PermissionDef) =>
    setChoices((s) => {
      const c = s[p.key] ?? "inherit";
      const next: Choice = c === "inherit" ? { effect: "allow", expires_on: null } : c.effect === "allow" ? { ...c, effect: "deny" } : "inherit";
      setResult(null);
      return { ...s, [p.key]: next };
    });

  const save = () =>
    start(async () => {
      const res = await saveUserPermissions(view.user.id, {
        ...(dirty.role ? { role } : {}),
        ...(dirty.groups ? { groups } : {}),
        ...(dirty.keys.length ? { overrides: Object.fromEntries(dirty.keys.map((k) => [k, choiceOf(k)])) } : {}),
      });
      if (res.ok && res.data) {
        setView(res.data);
        setRole(res.data.user.role);
        setGroups(res.data.assigned_groups);
        setChoices({ ...res.data.overrides });
      }
      setResult({ ok: Boolean(res.ok), text: res.ok ? (res.message ?? "") : (Object.values(res.errors ?? {})[0] ?? res.message ?? "") });
    });

  /** ช่องในตาราง: ตามกลุ่ม → อนุญาตรายคน → ไม่อนุญาตรายคน */
  const cell = (p: PermissionDef) => {
    const effect = effectOf(p.key);
    const on = effective(p.key);
    const look =
      effect === "allow"
        ? `${tone.success.badge} ring-success-300`
        : effect === "deny"
          ? `${tone.danger.badge} ring-danger-300`
          : on
            ? "bg-accent-100 text-accent-700 ring-accent-200 dark:bg-accent-400/15 dark:text-accent-200 dark:ring-accent-400/30"
            : "bg-surface text-transparent ring-line";
    const label = effect === "allow" ? t("access.legend.allow") : effect === "deny" ? t("access.legend.deny") : on ? t("access.legend.group") : t("access.legend.none");
    return (
      <button
        type="button"
        onClick={() => cycle(p)}
        disabled={readOnly || isSuper || (p.locked && !superAdmin)}
        aria-label={`${name(p)}: ${label}`}
        className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${look}`}
      >
        {effect === "deny" ? <XIcon width={13} height={13} /> : effect === "allow" ? <PlusIcon width={13} height={13} /> : <CheckIcon width={13} height={13} />}
      </button>
    );
  };

  const pickable = catalog.groups.filter((g) => g.key !== "super_admin" && g.key !== role);
  const overrides = catalog.data.filter((p) => choiceOf(p.key) !== "inherit");

  return (
    <div className="space-y-5">
      {view.locked_reason && (
        <p className={alert.warning}>
          <AlertIcon className="shrink-0 text-warning-500" />
          {view.locked_reason}
        </p>
      )}
      {isSuper && (
        <p className={alert.info}>
          <AlertIcon className="shrink-0" />
          {t("access.superAdminNote")}
        </p>
      )}

      {/* ตำแหน่ง */}
      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("access.role")}</h2>
        <p className="mt-1 text-sm text-muted">{view.role_synced ? t("access.roleSynced") : t("access.roleHint")}</p>
        <div role="radiogroup" aria-label={t("access.role")} className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((r) => {
            const blocked = roleBlocked(r);
            const option = (
              <label
                className={`flex h-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 transition-colors ${role === r ? "bg-accent-100 ring-accent-300 dark:bg-accent-400/15 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"} ${blocked && role !== r ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              >
                <input type="radio" name="role" value={r} checked={role === r} disabled={Boolean(blocked) && role !== r} onChange={() => (setRole(r), setResult(null))} className="cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed" />
                {t(`roles.${r}`)}
              </label>
            );
            return blocked && role !== r ? (
              <Tooltip key={r} label={blocked} side="top">
                {option}
              </Tooltip>
            ) : (
              <div key={r}>{option}</div>
            );
          })}
        </div>
        {(view.user.is_it_staff || view.user.is_it_head) && <p className="mt-3 text-xs text-muted">{t("access.itFlags")}</p>}
      </section>

      {/* กลุ่มที่มอบเพิ่ม */}
      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("access.assignedTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("access.assignedHint")}</p>
        {pickable.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("access.noCustomGroups")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
            {pickable.map((g) => {
              const assigned = groups.find((x) => x.key === g.key);
              return (
                <li key={g.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <label className={`flex min-w-0 flex-1 items-center gap-2 text-sm ${readOnly || isSuper ? "cursor-not-allowed" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(assigned)}
                      disabled={readOnly || isSuper}
                      onChange={(e) => (setGroups((gs) => (e.target.checked ? [...gs, { key: g.key, expires_on: null }] : gs.filter((x) => x.key !== g.key))), setResult(null))}
                      className="h-4 w-4 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed"
                    />
                    <span className="font-medium">{name(g)}</span>
                    <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[11px] text-muted">{g.is_system ? t("rolePermissions.system") : t("rolePermissions.custom")}</span>
                    {assigned && expired(assigned.expires_on) && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.danger.badge}`}>{t("access.expired")}</span>}
                  </label>
                  {assigned && expiry && (
                    <div className="flex items-center gap-2 sm:w-64">
                      <span className="shrink-0 text-xs text-muted">{t("access.expiresOn")}</span>
                      <DateInput
                        id={`group-exp-${g.key}`}
                        value={assigned.expires_on ?? ""}
                        min={today}
                        disabled={readOnly}
                        placeholder={t("access.noExpiry")}
                        onChange={(d) => (setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, expires_on: d || null } : x))), setResult(null))}
                        className={inputBase}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* สิทธิ์รายข้อ */}
      <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
        <div>
          <h2 className="font-semibold">{t("access.overridesTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("access.overridesHint")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
            {(
              [
                ["group", "bg-accent-100 text-accent-700 ring-accent-200 dark:bg-accent-400/15 dark:text-accent-200 dark:ring-accent-400/30", <CheckIcon key="i" width={11} height={11} />],
                ["allow", `${tone.success.badge} ring-success-300`, <PlusIcon key="i" width={11} height={11} />],
                ["deny", `${tone.danger.badge} ring-danger-300`, <XIcon key="i" width={11} height={11} />],
                ["none", "bg-surface text-transparent ring-line", <CheckIcon key="i" width={11} height={11} />],
              ] as const
            ).map(([k, look, icon]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded ring-1 ring-inset ${look}`}>{icon}</span>
                {t(`access.legend.${k}`)}
              </span>
            ))}
          </div>
        </div>
        <PermissionMatrix catalog={catalog.data} modules={catalog.modules} cell={cell} />

        {overrides.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("access.overrideList")}</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
              {overrides.map((p) => {
                const c = choiceOf(p.key) as OverrideValue;
                return (
                  <li key={p.key} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.effect === "allow" ? tone.success.badge : tone.danger.badge}`}>{c.effect === "allow" ? t("access.allow") : t("access.deny")}</span>
                      {name(p)}
                      {expired(c.expires_on) && <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.idle.badge}`}>{t("access.expired")}</span>}
                    </span>
                    {expiry && (
                      <div className="flex items-center gap-2 sm:w-64">
                        <span className="shrink-0 text-xs text-muted">{t("access.expiresOn")}</span>
                        <DateInput
                          id={`perm-exp-${p.key}`}
                          value={c.expires_on ?? ""}
                          min={today}
                          disabled={readOnly}
                          placeholder={t("access.noExpiry")}
                          onChange={(d) => (setChoices((s) => ({ ...s, [p.key]: { ...c, expires_on: d || null } })), setResult(null))}
                          className={inputBase}
                        />
                      </div>
                    )}
                    <Tooltip label={t("access.inherit")} side="top">
                      <button type="button" onClick={() => setChoices((s) => ({ ...s, [p.key]: "inherit" }))} disabled={readOnly} aria-label={t("access.inherit")} className={`${btn.secondary} ${btn.sm} px-2`}>
                        <XIcon width={12} height={12} className="text-faint" />
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {result && (
        <p role="status" className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}

      {!readOnly && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          {dirtyCount > 0 && <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-line">{t("access.changed", { count: dirtyCount })}</span>}
          <button type="button" onClick={save} disabled={pending || dirtyCount === 0} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
            {pending ? <SpinnerIcon /> : <SaveIcon />}
            {t("access.save")}
          </button>
        </div>
      )}
    </div>
  );
}
