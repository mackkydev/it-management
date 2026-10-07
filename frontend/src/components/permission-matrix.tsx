"use client";

import type { ReactNode } from "react";
import { LockIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { PermissionDef, PermissionModule } from "@/lib/types";

/** คอลัมน์ของตาราง — "manage" (เพิ่ม/แก้ไข/ลบ รวมกัน) วางคร่อม 3 คอลัมน์ เพิ่ม–ลบ */
const COLUMNS = ["view", "create", "update", "delete", "approve", "other"] as const;
type Column = (typeof COLUMNS)[number];

/**
 * สิ่งที่ทุกคนทำได้เสมอ (ไม่มี permission key — ระบบอนุญาตตามเจ้าของเอกสาร) — แสดงเป็นช่องติ๊กที่ล็อกไว้ในช่องที่ว่าง
 * ต้องตรงกับกฎใน express/src/services/ticket-workflow.ts (canEdit / canDelete)
 */
const ALWAYS: Partial<Record<string, Partial<Record<Column, MessageKey>>>> = {
  tickets: {
    create: "rolePermissions.always.ticketCreate",
    update: "rolePermissions.always.ticketUpdate",
    delete: "rolePermissions.always.ticketDelete",
  },
};

/**
 * ตารางสิทธิ์แบบ ระบบงาน × การกระทำ (แบบหน้าจอสิทธิ์ของ STEC)
 * แถว = ระบบงาน, คอลัมน์ = ดู / เพิ่ม / แก้ไข / ลบ / อนุมัติ / อื่นๆ — cell(p) วาดตัวควบคุมของสิทธิ์แต่ละข้อ (checkbox / ปุ่มสลับ)
 * จอเล็ก: การ์ดต่อระบบงาน แสดงรายการสิทธิ์เป็นแถว
 */
export function PermissionMatrix({ catalog, modules, cell }: { catalog: PermissionDef[]; modules: PermissionModule[]; cell: (p: PermissionDef) => ReactNode }) {
  const { t, locale } = useI18n();
  const name = (x: { name_th: string; name_en: string }) => (locale === "th" ? x.name_th : x.name_en);
  const rows = modules.map((m) => ({ module: m, items: catalog.filter((p) => p.module === m.key) })).filter((r) => r.items.length > 0);
  const lockBadge = (p: PermissionDef) =>
    p.locked && (
      <Tooltip label={t("rolePermissions.locked")} side="top">
        <LockIcon width={12} height={12} className="shrink-0 text-warning-500" aria-label={t("rolePermissions.locked")} />
      </Tooltip>
    );
  // ช่อง "ทำได้เสมอ": ติ๊กไว้และล็อก แก้ไม่ได้
  const always = (moduleKey: string, c: Column) => {
    const label = ALWAYS[moduleKey]?.[c];
    if (!label) return null;
    return (
      <Tooltip label={t(label)} side="top">
        <span className="inline-flex items-center gap-1">
          <input type="checkbox" checked readOnly disabled aria-label={t(label)} className="h-4 w-4 cursor-not-allowed accent-[var(--accent-500)] opacity-60" />
          <LockIcon width={11} height={11} className="shrink-0 text-faint" />
        </span>
      </Tooltip>
    );
  };
  const control = (p: PermissionDef) => (
    <Tooltip label={name(p)} side="top">
      <span className="inline-flex items-center gap-1">
        {cell(p)}
        {lockBadge(p)}
      </span>
    </Tooltip>
  );

  return (
    <>
      {/* จอใหญ่: ตาราง */}
      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-line md:block">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              {/* คอลัมน์ระบบงานกินพื้นที่ที่เหลือ → ช่องสิทธิ์ทั้งหมดชิดขวา */}
              <th className="w-full px-4 py-2.5 text-left font-medium">{t("rolePermissions.module")}</th>
              {COLUMNS.map((c) => (
                <th key={c} className={`px-3 py-2.5 font-medium whitespace-nowrap ${c === "other" ? "min-w-72 pl-6 text-left" : "w-32 text-center"}`}>
                  {t(`rolePermissions.actions.${c}` as MessageKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ module: m, items }) => {
              const manage = items.filter((p) => p.action === "manage");
              const at = (c: (typeof COLUMNS)[number]) => items.filter((p) => p.action === c);
              return (
                <tr key={m.key} className="hover:bg-subtle/40">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{name(m)}</td>
                  <td className="px-3 py-2.5 text-center">{at("view").map((p) => <span key={p.key}>{control(p)}</span>)}</td>
                  {manage.length > 0 && at("create").length + at("update").length === 0 ? (
                    <>
                      {/* "จัดการ" คร่อมคอลัมน์ เพิ่ม–แก้ไข (–ลบ ถ้าไม่มีสิทธิ์ลบแยก) */}
                      <td colSpan={at("delete").length ? 2 : 3} className="px-3 py-2.5 text-center">
                        {manage.map((p) => (
                          <span key={p.key} className="inline-flex items-center gap-1.5">
                            {control(p)}
                            <span className="text-xs text-muted">{t("rolePermissions.actions.manage")}</span>
                          </span>
                        ))}
                      </td>
                      {at("delete").length > 0 && <td className="px-3 py-2.5 text-center">{at("delete").map((p) => <span key={p.key}>{control(p)}</span>)}</td>}
                    </>
                  ) : (
                    (["create", "update", "delete"] as const).map((c) => (
                      <td key={c} className="px-3 py-2.5 text-center">
                        {[...at(c), ...(c === "create" ? manage : [])].map((p) => (
                          <span key={p.key}>{control(p)}</span>
                        ))}
                        {at(c).length === 0 && !(c === "create" && manage.length) && always(m.key, c)}
                      </td>
                    ))
                  )}
                  <td className="px-3 py-2.5 text-center">{at("approve").map((p) => <span key={p.key}>{control(p)}</span>)}</td>
                  <td className="py-2.5 pl-6 pr-3">
                    <div className="flex flex-col gap-1.5">
                      {at("other").map((p) => (
                        <span key={p.key} className="flex items-center gap-2">
                          {cell(p)}
                          <span className="whitespace-nowrap text-xs text-muted">{name(p)}</span>
                          {lockBadge(p)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* จอเล็ก: การ์ดต่อระบบงาน */}
      <div className="space-y-3 md:hidden">
        {rows.map(({ module: m, items }) => (
          <div key={m.key} className="rounded-xl ring-1 ring-line">
            <p className="border-b border-line bg-subtle px-3 py-2 text-sm font-semibold">{name(m)}</p>
            <ul className="divide-y divide-line">
              {Object.entries(ALWAYS[m.key] ?? {}).map(([c, label]) => (
                <li key={c} className="flex items-center gap-3 px-3 py-2 text-muted">
                  <input type="checkbox" checked readOnly disabled className="h-4 w-4 accent-[var(--accent-500)] opacity-60" />
                  <span className="min-w-0 flex-1 text-sm">{t(label!)}</span>
                  <LockIcon width={12} height={12} className="shrink-0 text-faint" />
                </li>
              ))}
              {items.map((p) => (
                <li key={p.key} className="flex items-center gap-3 px-3 py-2">
                  {cell(p)}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="mr-1.5 rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">{t(`rolePermissions.actions.${p.action}` as MessageKey)}</span>
                    {name(p)}
                  </span>
                  {lockBadge(p)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
