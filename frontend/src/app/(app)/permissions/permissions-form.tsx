"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { saveUiConfig } from "@/app/actions/it-data";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, CheckIcon, PencilIcon, ResetIcon, SaveIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { NAV, type NavItem } from "@/components/shell/nav";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import {
  ALWAYS_FOR_ADMIN, BUTTONS, sampleUser, sortByOrder,
  type Audience, type MenuLabels, type MenuOrder, type UiConfig, type UiPermissions,
} from "@/lib/permissions";
import type { PermissionGroupRow, User } from "@/lib/types";
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
 * ตารางสิทธิ์: แถว = เมนู/ปุ่ม, คอลัมน์ = กลุ่มสิทธิ์ (ตามตำแหน่ง + กลุ่มที่สร้างเอง — ติ๊ก = เห็น)
 * ช่องที่ระบบไม่อนุญาตอยู่แล้ว (visible/system ของรายการ) กดไม่ได้ — หน้านี้ซ่อนเพิ่มได้อย่างเดียว
 */
export function PermissionsForm({
  initial,
  groups,
  defaultNames,
}: {
  initial: UiConfig;
  groups: PermissionGroupRow[];
  /** ชื่อตั้งต้นของเมนูทั้งสองภาษา { "<group id | /href>": { th, en } } */
  defaultNames: Record<string, { th: string; en: string }>;
}) {
  const { t, locale } = useI18n();
  const AUDIENCES = useMemo(() => groups.map((g) => g.key), [groups]);
  const audienceName = (a: Audience) => {
    const g = groups.find((x) => x.key === a);
    return g ? (locale === "th" ? g.name_th : g.name_en) : a;
  };
  const confirm = useConfirm();
  const [deny, setDeny] = useState<UiPermissions>(initial.ui_permissions);
  const [groupOrder, setGroupOrder] = useState<string[]>(() => sortByOrder(NAV, initial.menu_order.groups, (g) => g.id).map((g) => g.id));
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(NAV.map((g) => [g.id, sortByOrder(g.items, initial.menu_order.items?.[g.id], (i) => i.href).map((i) => i.href)])),
  );
  // ชื่อเมนูที่แก้เอง (บันทึกพร้อมปุ่มบันทึกด้านล่าง)
  const [labels, setLabels] = useState<MenuLabels>(initial.menu_labels);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const samples = useMemo(() => Object.fromEntries(AUDIENCES.map((a) => [a, sampleUser(a, initial)])) as Record<Audience, User>, [AUDIENCES, initial]);
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
    start(async () => setResult(await saveUiConfig({ ui_permissions: deny, menu_order, menu_labels: labels })));
  };

  const reset = async () => {
    if (!(await confirm(t("permissions.confirmReset")))) return;
    setDeny({});
    setLabels({});
    setGroupOrder(NAV.map((g) => g.id));
    setItemOrder(Object.fromEntries(NAV.map((g) => [g.id, g.items.map((i) => i.href)])));
    setResult({});
  };

  /** ช่องติ๊กของ 1 รายการ × 1 กลุ่ม */
  const cell = (key: string, a: Audience, systemAllows: boolean) => {
    const locked = a === "super_admin" && ALWAYS_FOR_ADMIN.has(key);
    const visible = locked || (systemAllows && !(deny[key] ?? []).includes(a));
    const box = (
      <input
        type="checkbox"
        checked={visible}
        disabled={!systemAllows || locked}
        onChange={() => toggle(key, a)}
        aria-label={`${key} — ${audienceName(a)}`}
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
            {audienceName(a)}
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
                          <MenuName id={group.id} fallback={t(group.label)} defaults={defaultNames[group.id]} labels={labels} onChange={setLabels} />
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
                            <MenuName id={item.href} fallback={t(item.label)} defaults={defaultNames[item.href]} labels={labels} onChange={setLabels} />
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
            {/* จัดกลุ่มตามหน้าที่ปุ่มอยู่ (ตามลำดับใน BUTTONS) */}
            {BUTTONS.reduce<{ page: (typeof BUTTONS)[number]["page"]; items: typeof BUTTONS }[]>((groups, b) => {
              const last = groups[groups.length - 1];
              if (last?.page === b.page) last.items.push(b);
              else groups.push({ page: b.page, items: [b] });
              return groups;
            }, []).map((g) => (
              <tbody key={g.page} className="border-t border-line">
                <tr className="bg-subtle/40">
                  <td colSpan={AUDIENCES.length + 1} className="px-4 py-2 font-medium">
                    {t(g.page)}
                  </td>
                </tr>
                {g.items.map((b) => (
                  <tr key={b.key} className="border-t border-line/60">
                    <td className="py-2 pl-10 pr-4">
                      {t(b.label)}
                      <code className="ml-2 text-xs text-faint">{b.key}</code>
                    </td>
                    {AUDIENCES.map((a) => cell(b.key, a, !b.system || b.system(samples[a])))}
                  </tr>
                ))}
              </tbody>
            ))}
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

/**
 * ชื่อเมนู + ปุ่มแก้ชื่อ (ไทย + อังกฤษ ต้องกรอกทั้งคู่ — กันชื่อสองภาษาไม่ตรงกัน)
 * "คืนชื่อเดิม" = ลบชื่อที่แก้ กลับไปใช้ชื่อตั้งต้นจากไฟล์แปล
 */
function MenuName({
  id,
  fallback,
  defaults,
  labels,
  onChange,
}: {
  id: string;
  fallback: string;
  defaults?: { th: string; en: string };
  labels: MenuLabels;
  onChange: (next: MenuLabels) => void;
}) {
  const { t, locale } = useI18n();
  const custom = labels[id];
  const [draft, setDraft] = useState<{ th: string; en: string } | null>(null);
  const [error, setError] = useState("");
  const shown = custom?.[locale === "en" ? "en" : "th"] || fallback;

  if (!draft) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={custom ? "font-medium text-accent-700 dark:text-accent-300" : undefined}>{shown}</span>
        {custom && (
          <Tooltip label={t("permissions.menuNameDefault", { name: fallback })} side="top">
            <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">{t("permissions.menuNameEdited")}</span>
          </Tooltip>
        )}
        <Tooltip label={t("permissions.menuNameEdit")} side="top">
          <button
            type="button"
            onClick={() => {
              setDraft({ th: custom?.th ?? defaults?.th ?? fallback, en: custom?.en ?? defaults?.en ?? fallback });
              setError("");
            }}
            aria-label={t("permissions.menuNameEdit")}
            className={ICON_BTN}
          >
            <PencilIcon width={12} height={12} />
          </button>
        </Tooltip>
      </span>
    );
  }

  const apply = () => {
    const th = draft.th.trim();
    const en = draft.en.trim();
    if (!th || !en) return setError(t("permissions.menuNameBoth"));
    const next = { ...labels };
    // ตรงกับชื่อตั้งต้นทั้งสองภาษา = ไม่ต้องเก็บ
    if (defaults && th === defaults.th && en === defaults.en) delete next[id];
    else next[id] = { th, en };
    onChange(next);
    setDraft(null);
  };
  const restore = () => {
    const next = { ...labels };
    delete next[id];
    onChange(next);
    setDraft(null);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        value={draft.th}
        maxLength={60}
        onChange={(e) => setDraft({ ...draft, th: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), apply())}
        aria-label={t("permissions.menuNameTh")}
        placeholder={t("permissions.menuNameTh")}
        className={`${input} h-8 w-44 py-1 text-sm`}
      />
      <input
        value={draft.en}
        maxLength={60}
        onChange={(e) => setDraft({ ...draft, en: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), apply())}
        aria-label={t("permissions.menuNameEn")}
        placeholder={t("permissions.menuNameEn")}
        className={`${input} h-8 w-44 py-1 text-sm`}
      />
      <Tooltip label={t("common.save")} side="top">
        <button type="button" onClick={apply} aria-label={t("common.save")} className={ICON_BTN}>
          <CheckIcon width={14} height={14} />
        </button>
      </Tooltip>
      <Tooltip label={t("common.cancel")} side="top">
        <button type="button" onClick={() => setDraft(null)} aria-label={t("common.cancel")} className={ICON_BTN}>
          <XIcon width={14} height={14} />
        </button>
      </Tooltip>
      {custom && (
        <button type="button" onClick={restore} className="text-xs text-accent-600 hover:underline dark:text-accent-300">
          {t("permissions.menuNameRestore")}
        </button>
      )}
      {error && <span className="w-full text-xs font-medium text-red-500">{error}</span>}
    </span>
  );
}
