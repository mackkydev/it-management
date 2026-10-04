"use client";

import { useMemo, useState, useTransition } from "react";
import { saveRolePermissions } from "@/app/actions/access";
import { AlertIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, table } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import { AUDIENCES, type Audience } from "@/lib/permissions";
import type { PermissionDef, PermissionGroup } from "@/lib/types";

const GROUPS: PermissionGroup[] = ["tickets", "it_data", "assets", "users", "system"];

/** ตารางสิทธิ์: แถว = สิทธิ์, คอลัมน์ = บทบาท / เจ้าหน้าที่ IT / หัวหน้า IT — บันทึกเฉพาะคอลัมน์ที่เปลี่ยน */
export function RoleMatrix({ catalog, initial }: { catalog: PermissionDef[]; initial: Record<string, string[]> }) {
  const { t, locale } = useI18n();
  const toSets = (src: Record<string, string[]>) => Object.fromEntries(AUDIENCES.map((a) => [a, new Set(src[a] ?? [])])) as Record<Audience, Set<string>>;
  const [saved, setSaved] = useState(() => toSets(initial));
  const [state, setState] = useState(() => toSets(initial));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty = useMemo(
    () => AUDIENCES.filter((a) => state[a].size !== saved[a].size || [...state[a]].some((k) => !saved[a].has(k))),
    [state, saved],
  );

  const toggle = (a: Audience, key: string) =>
    setState((s) => {
      const next = new Set(s[a]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...s, [a]: next };
    });

  const save = () =>
    start(async () => {
      for (const a of dirty) {
        const res = await saveRolePermissions(a, [...state[a]]);
        if (!res.ok) return setResult({ ok: false, text: res.message ?? "" });
      }
      setSaved(Object.fromEntries(AUDIENCES.map((a) => [a, new Set(state[a])])) as Record<Audience, Set<string>>);
      setResult({ ok: true, text: t("rolePermissions.saved") });
    });

  return (
    <div className="space-y-4">
      <p className={`${alert.info} text-sm`}>{t("rolePermissions.adminNote")}</p>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("rolePermissions.permission")}</th>
              {AUDIENCES.map((a) => (
                <th key={a} className={`${table.th} text-center`}>
                  {t(`permissions.audiences.${a}` as MessageKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={table.body}>
            {GROUPS.flatMap((g) => {
              const items = catalog.filter((p) => p.group === g);
              if (items.length === 0) return [];
              return [
                <tr key={`g-${g}`} className="bg-subtle">
                  <td colSpan={AUDIENCES.length + 1} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t(`access.groups.${g}` as MessageKey)}
                  </td>
                </tr>,
                ...items.map((p) => (
                  <tr key={p.key} className={table.row}>
                    <td className={table.td}>
                      <div className="text-sm font-medium">{locale === "th" ? p.name_th : p.name_en}</div>
                      <div className="font-mono text-xs text-faint">{p.key}</div>
                    </td>
                    {AUDIENCES.map((a) => (
                      <td key={a} className={`${table.td} text-center`}>
                        <input
                          type="checkbox"
                          checked={state[a].has(p.key)}
                          onChange={() => toggle(a, p.key)}
                          aria-label={`${t(`permissions.audiences.${a}` as MessageKey)}: ${locale === "th" ? p.name_th : p.name_en}`}
                          className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                        />
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>

      {result && (
        <p role="status" className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}
      <div className="sticky bottom-4 flex items-center justify-end gap-3">
        {dirty.length > 0 && <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-line">{t("rolePermissions.changed", { count: dirty.length })}</span>}
        <button type="button" onClick={save} disabled={pending || dirty.length === 0} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("rolePermissions.save")}
        </button>
      </div>
    </div>
  );
}
