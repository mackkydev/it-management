"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { saveUiConfig } from "@/app/actions/it-data";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, ResetIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { NAV, type NavItem } from "@/components/shell/nav";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import {
  ALWAYS_FOR_ADMIN, AUDIENCES, BUTTONS, sampleUser, sortByOrder,
  type Audience, type MenuOrder, type UiConfig, type UiPermissions,
} from "@/lib/permissions";
import type { User } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";

/** ย้ายตำแหน่งในรายการ (dir = -1 ขึ้น, +1 ลง) */
function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

const ICON_BTN =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * ตารางสิทธิ์: แถว = เมนู/ปุ่ม, คอลัมน์ = กลุ่มผู้ใช้ (ติ๊ก = เห็น)
 * ช่องที่ระบบไม่อนุญาตอยู่แล้ว (visible/system ของรายการ) กดไม่ได้ — หน้านี้ซ่อนเพิ่มได้อย่างเดียว
 */
export function PermissionsForm({ initial }: { initial: UiConfig }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [deny, setDeny] = useState<UiPermissions>(initial.ui_permissions);
  const [groupOrder, setGroupOrder] = useState<string[]>(() => sortByOrder(NAV, initial.menu_order.groups, (g) => g.id).map((g) => g.id));
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(NAV.map((g) => [g.id, sortByOrder(g.items, initial.menu_order.items?.[g.id], (i) => i.href).map((i) => i.href)])),
  );
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const samples = useMemo(() => Object.fromEntries(AUDIENCES.map((a) => [a, sampleUser(a, initial)])) as Record<Audience, User>, [initial]);
  const groupsById = useMemo(() => Object.fromEntries(NAV.map((g) => [g.id, g])), []);

  const toggle = (key: string, a: Audience) => {
    setResult({});
    setDeny((d) => {
      const current = d[key] ?? [];
      const next = current.includes(a) ? current.filter((x) => x !== a) : [...current, a];
      return { ...d, [key]: next };
    });
  };

  const save = () => {
    const menu_order: MenuOrder = { groups: groupOrder, items: itemOrder };
    start(async () => setResult(await saveUiConfig({ ui_permissions: deny, menu_order })));
  };

  const reset = async () => {
    if (!(await confirm(t("permissions.confirmReset")))) return;
    setDeny({});
    setGroupOrder(NAV.map((g) => g.id));
    setItemOrder(Object.fromEntries(NAV.map((g) => [g.id, g.items.map((i) => i.href)])));
    setResult({});
  };

  /** ช่องติ๊กของ 1 รายการ × 1 กลุ่ม */
  const cell = (key: string, a: Audience, systemAllows: boolean) => {
    const locked = a === "admin" && ALWAYS_FOR_ADMIN.has(key);
    const visible = locked || (systemAllows && !(deny[key] ?? []).includes(a));
    const box = (
      <input
        type="checkbox"
        checked={visible}
        disabled={!systemAllows || locked}
        onChange={() => toggle(key, a)}
        aria-label={`${key} — ${t(`permissions.audiences.${a}`)}`}
        className="h-4 w-4 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed disabled:opacity-40"
      />
    );
    const hint = locked ? t("permissions.adminLocked") : !systemAllows ? t("permissions.systemDenied") : null;
    return (
      <td key={a} className="px-3 py-2.5 text-center">
        {hint ? (
          <Tooltip label={hint}>
            <span className="inline-flex">{box}</span>
          </Tooltip>
        ) : (
          box
        )}
      </td>
    );
  };

  const head = (first: string) => (
    <thead className="bg-subtle text-xs text-muted">
      <tr>
        <th className="min-w-[18rem] px-4 py-2.5 text-left font-medium">{first}</th>
        {AUDIENCES.map((a) => (
          <th key={a} className="w-28 px-3 py-2.5 text-center font-medium">
            {t(`permissions.audiences.${a}`)}
          </th>
        ))}
      </tr>
    </thead>
  );

  const orderButtons = (onUp: () => void, onDown: () => void, first: boolean, last: boolean, label: ReactNode) => (
    <span className="flex items-center gap-1">
      <span className="flex flex-col">
        <button type="button" onClick={onUp} disabled={first} aria-label={t("permissions.moveUp")} className={ICON_BTN}>
          <ArrowUpIcon width={13} height={13} />
        </button>
        <button type="button" onClick={onDown} disabled={last} aria-label={t("permissions.moveDown")} className={ICON_BTN}>
          <ArrowDownIcon width={13} height={13} />
        </button>
      </span>
      {label}
    </span>
  );

  return (
    <div className="space-y-5">
      <p className={alert.warning}>
        <AlertIcon className="shrink-0 text-warning-500" />
        {t("permissions.note")}
      </p>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}

      {/* เมนู + ลำดับ */}
      <section className={`overflow-hidden ${card}`}>
        <div className="p-4 sm:px-6">
          <h2 className="font-semibold">{t("permissions.menusSection")}</h2>
          <p className="mt-1 text-sm text-muted">{t("permissions.menusHint")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            {head(t("permissions.menu"))}
            {groupOrder.map((gid, gi) => {
              const group = groupsById[gid];
              if (!group) return null;
              const items = (itemOrder[gid] ?? []).map((href) => group.items.find((i) => i.href === href)).filter(Boolean) as NavItem[];
              return (
                <tbody key={gid} className="border-t border-line">
                  <tr className="bg-subtle/40">
                    <td colSpan={AUDIENCES.length + 1} className="px-4 py-2">
                      {orderButtons(
                        () => setGroupOrder((o) => move(o, gi, -1)),
                        () => setGroupOrder((o) => move(o, gi, 1)),
                        gi === 0,
                        gi === groupOrder.length - 1,
                        <span className="flex items-center gap-2 font-semibold">
                          <group.icon width={15} height={15} className="text-accent-500 dark:text-accent-300" />
                          {t(group.label)}
                        </span>,
                      )}
                    </td>
                  </tr>
                  {items.map((item, ii) => (
                    <tr key={item.href} className="border-t border-line/60">
                      <td className="py-1.5 pl-10 pr-4">
                        {orderButtons(
                          () => setItemOrder((o) => ({ ...o, [gid]: move(o[gid], ii, -1) })),
                          () => setItemOrder((o) => ({ ...o, [gid]: move(o[gid], ii, 1) })),
                          ii === 0,
                          ii === items.length - 1,
                          <span className="flex items-center gap-2">
                            <item.icon width={14} height={14} className="text-faint" />
                            {t(item.label)}
                            <code className="text-xs text-faint">{item.href}</code>
                          </span>,
                        )}
                      </td>
                      {AUDIENCES.map((a) => cell(item.href, a, !item.visible || item.visible(samples[a])))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </section>

      {/* ปุ่ม */}
      <section className={`overflow-hidden ${card}`}>
        <div className="p-4 sm:px-6">
          <h2 className="font-semibold">{t("permissions.buttonsSection")}</h2>
          <p className="mt-1 text-sm text-muted">{t("permissions.buttonsHint")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            {head(t("permissions.button"))}
            <tbody>
              {BUTTONS.map((b) => (
                <tr key={b.key} className="border-t border-line/60">
                  <td className="px-4 py-2.5">{t(b.label)}</td>
                  {AUDIENCES.map((a) => cell(b.key, a, !b.system || b.system(samples[a])))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={reset} disabled={pending} className={btn.secondary}>
          <ResetIcon className="text-faint" />
          {t("permissions.reset")}
        </button>
        <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("permissions.save")}
        </button>
      </div>
    </div>
  );
}
