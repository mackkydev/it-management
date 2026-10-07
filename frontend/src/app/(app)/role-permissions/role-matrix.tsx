"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteGroup, savePermissionExpiry, saveGroup, saveRolePermissions } from "@/app/actions/access";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { PermissionMatrix } from "@/components/permission-matrix";
import { alert, btn, card, input as inputBase, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PermissionCatalog, PermissionGroupRow } from "@/lib/types";

const SUPER = "super_admin";

/**
 * สิทธิ์ตามกลุ่ม: เลือกกลุ่ม → ตาราง ระบบงาน × การกระทำ (ติ๊ก = กลุ่มได้สิทธิ์) — บันทึกเฉพาะกลุ่มที่เปลี่ยน
 * super_admin = ทุกสิทธิ์ (แก้ไม่ได้) · สิทธิ์ที่สงวนไว้ (แม่กุญแจ) ติ๊กได้เฉพาะผู้ดูแลระบบ · ไม่มี access.manage = ดูอย่างเดียว
 */
export function RoleMatrix({ catalog, canManage, superAdmin }: { catalog: PermissionCatalog; canManage: boolean; superAdmin: boolean }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [groups, setGroups] = useState<PermissionGroupRow[]>(catalog.groups);
  const toSets = (src: Record<string, string[]>) => Object.fromEntries(Object.entries(src).map(([g, keys]) => [g, new Set(keys)])) as Record<string, Set<string>>;
  const [saved, setSaved] = useState(() => toSets(catalog.role_permissions));
  const [state, setState] = useState(() => toSets(catalog.role_permissions));
  const [selected, setSelected] = useState(() => catalog.groups.find((g) => g.key !== SUPER)?.key ?? SUPER);
  const [expiry, setExpiry] = useState(catalog.expiry_enabled);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // ฟอร์มสร้าง/เปลี่ยนชื่อกลุ่ม (key null = กลุ่มใหม่)
  const [editing, setEditing] = useState<{ key: string | null; name_th: string; name_en: string; errors: Record<string, string> } | null>(null);

  const name = (g: { name_th: string; name_en: string }) => (locale === "th" ? g.name_th : g.name_en);
  const current = groups.find((g) => g.key === selected);
  const set = state[selected] ?? new Set<string>();
  const dirty = useMemo(
    () => Object.keys(state).filter((g) => g !== SUPER && (state[g].size !== (saved[g]?.size ?? 0) || [...state[g]].some((k) => !saved[g]?.has(k)))),
    [state, saved],
  );

  const toggle = (key: string) =>
    setState((s) => {
      const next = new Set(s[selected] ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setResult(null);
      return { ...s, [selected]: next };
    });

  const save = () =>
    start(async () => {
      for (const g of dirty) {
        const res = await saveRolePermissions(g, [...state[g]]);
        if (!res.ok) return setResult({ ok: false, text: Object.values(res.errors ?? {})[0] ?? res.message ?? "" });
      }
      setSaved(Object.fromEntries(Object.entries(state).map(([g, keys]) => [g, new Set(keys)])));
      setResult({ ok: true, text: t("rolePermissions.saved") });
    });

  const toggleExpiry = () =>
    start(async () => {
      const res = await savePermissionExpiry(!expiry);
      if (res.ok) setExpiry(!expiry);
      setResult({ ok: Boolean(res.ok), text: res.message ?? "" });
    });

  const submitGroup = () => {
    if (!editing) return;
    const errors: Record<string, string> = {};
    if (!editing.name_th.trim()) errors.name_th = t("rolePermissions.nameRequired");
    if (!editing.name_en.trim()) errors.name_en = t("rolePermissions.nameRequired");
    if (Object.keys(errors).length) return setEditing({ ...editing, errors });
    start(async () => {
      const res = await saveGroup(editing.key, editing);
      if (!res.ok || !res.data) return setEditing({ ...editing, errors: { ...(res.errors ?? {}), ...(res.message && !res.errors ? { name_th: res.message } : {}) } });
      const row = res.data;
      setGroups((gs) => (editing.key ? gs.map((g) => (g.key === row.key ? row : g)) : [...gs, row]));
      if (!editing.key) {
        setState((s) => ({ ...s, [row.key]: new Set() }));
        setSaved((s) => ({ ...s, [row.key]: new Set() }));
        setSelected(row.key);
      }
      setEditing(null);
      setResult({ ok: true, text: res.message ?? "" });
    });
  };

  const removeGroup = async (g: PermissionGroupRow) => {
    if (!(await confirm(t("rolePermissions.confirmDelete", { name: name(g), count: g.members })))) return;
    start(async () => {
      const res = await deleteGroup(g.key);
      if (!res.ok) return setResult({ ok: false, text: res.message ?? "" });
      setGroups((gs) => gs.filter((x) => x.key !== g.key));
      setSelected(groups.find((x) => x.key !== SUPER && x.key !== g.key)?.key ?? SUPER);
      setResult({ ok: true, text: res.message ?? "" });
      router.refresh();
    });
  };

  const field = (k: "name_th" | "name_en", label: string) =>
    editing && (
      <div className="min-w-0 flex-1">
        <label htmlFor={`group-${k}`} className="mb-1 block text-xs font-medium">
          {label}
        </label>
        <input
          id={`group-${k}`}
          maxLength={100}
          value={editing[k]}
          onChange={(e) => setEditing({ ...editing, [k]: e.target.value, errors: { ...editing.errors, [k]: "" } })}
          className={`${inputBase} ${editing.errors[k] ? inputError : ""}`}
        />
        {editing.errors[k] && <p className="mt-1 text-xs font-medium text-red-500">{editing.errors[k]}</p>}
      </div>
    );

  return (
    <div className="space-y-5">
      <p className={`${alert.info} text-sm`}>{t("rolePermissions.adminNote")}</p>
      {!canManage && <p className={`${alert.warning} text-sm`}>{t("rolePermissions.readOnly")}</p>}

      {/* สวิตช์วันหมดอายุของสิทธิ์ */}
      <section className={`flex items-start justify-between gap-4 p-4 sm:p-5 ${card}`}>
        <div>
          <h2 className="text-sm font-semibold">{t("rolePermissions.expiryTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("rolePermissions.expiryHint")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={expiry}
          aria-label={t("rolePermissions.expiryOn")}
          disabled={!canManage || pending}
          onClick={toggleExpiry}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${expiry ? "bg-accent-500" : "bg-line"}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${expiry ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </section>

      {/* กลุ่ม */}
      <section className={`space-y-3 p-4 sm:p-5 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t("rolePermissions.groupsTitle")}</h2>
          {canManage && !editing && (
            <button type="button" onClick={() => setEditing({ key: null, name_th: "", name_en: "", errors: {} })} className={`${btn.soft} ${btn.sm}`}>
              <PlusIcon width={13} height={13} />
              {t("rolePermissions.addGroup")}
            </button>
          )}
        </div>
        <div role="tablist" className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={g.key === selected}
              onClick={() => setSelected(g.key)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ring-1 transition-colors ${
                g.key === selected ? "bg-accent-100 ring-accent-300 dark:bg-accent-400/15 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"
              }`}
            >
              <span className="font-medium">{name(g)}</span>
              <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[11px] text-muted">{g.is_system ? t("rolePermissions.system") : t("rolePermissions.custom")}</span>
              <span className="text-xs text-faint">{t("rolePermissions.members", { count: g.members })}</span>
              {dirty.includes(g.key) && <span className="h-1.5 w-1.5 rounded-full bg-warning-500" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {editing && (
          <div className="flex flex-col gap-3 rounded-xl bg-subtle p-3 sm:flex-row sm:items-end">
            {field("name_th", t("rolePermissions.nameTh"))}
            {field("name_en", t("rolePermissions.nameEn"))}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(null)} disabled={pending} className={`${btn.secondary} ${btn.sm}`}>
                <XIcon width={13} height={13} className="text-faint" />
                {t("common.cancel")}
              </button>
              <button type="button" onClick={submitGroup} disabled={pending} aria-busy={pending} className={`${btn.primary} ${btn.sm}`}>
                {pending ? <SpinnerIcon width={13} height={13} /> : <SaveIcon width={13} height={13} />}
                {t("common.save")}
              </button>
            </div>
          </div>
        )}

        {current && canManage && !editing && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing({ key: current.key, name_th: current.name_th, name_en: current.name_en, errors: {} })} className={`${btn.secondary} ${btn.sm}`}>
              <PencilIcon width={13} height={13} className="text-faint" />
              {t("rolePermissions.rename")}
            </button>
            {!current.is_system && (
              <button type="button" onClick={() => removeGroup(current)} disabled={pending} className={`${btn.danger} ${btn.sm}`}>
                <TrashIcon width={13} height={13} />
                {t("rolePermissions.deleteGroup")}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ตารางสิทธิ์ของกลุ่มที่เลือก */}
      <section className={`space-y-3 p-4 sm:p-5 ${card}`}>
        <h2 className="font-semibold">
          {t("rolePermissions.permission")}: {current ? name(current) : ""}
        </h2>
        {selected === SUPER ? (
          <p className={`${alert.info} text-sm`}>{t("rolePermissions.allPermissions")}</p>
        ) : (
          <PermissionMatrix
            catalog={catalog.data}
            modules={catalog.modules}
            cell={(p) => (
              <input
                type="checkbox"
                checked={set.has(p.key)}
                disabled={!canManage || (p.locked && !superAdmin)}
                onChange={() => toggle(p.key)}
                aria-label={`${current ? name(current) : ""}: ${locale === "th" ? p.name_th : p.name_en}`}
                className="h-4 w-4 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            )}
          />
        )}
      </section>

      {result && (
        <p role="status" className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}
      {canManage && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          {dirty.length > 0 && <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-line">{t("rolePermissions.changed", { count: dirty.length })}</span>}
          <button type="button" onClick={save} disabled={pending || dirty.length === 0} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
            {pending ? <SpinnerIcon /> : <SaveIcon />}
            {t("rolePermissions.save")}
          </button>
        </div>
      )}
    </div>
  );
}
