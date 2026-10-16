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
/** ช่องสิทธิ์แต่ละคอลัมน์: เส้นแบ่งแนวตั้ง + ระยะห่าง ให้อ่านตามคอลัมน์ง่าย */
const CELL = "border-l border-line px-4";

/**
 * สิ่งที่ทุกคนทำได้เสมอกับเอกสารของตัวเอง (ไม่มี permission key — ระบบอนุญาตตามบทบาทในเอกสาร) — ช่องติ๊กที่ล็อกไว้ + คำสั้นใต้ช่อง
 * ถ้าคอลัมน์นั้นมีสิทธิ์ให้ติ๊กด้วย (เช่น ดูทั้งหมด) จะแสดงคู่กัน: "ของตัวเอง" (ล็อก) + "ทั้งหมด" (ติ๊กได้)
 * ต้องตรงกับกฎใน express/src/services/ticket-workflow.ts (canView / canApprove / canEdit / canDelete), routes/calendar.ts, routes/assets.ts
 */
type Always = { label: MessageKey; short: MessageKey };
const ALWAYS: Partial<Record<string, Partial<Record<Column, Always>>>> = {
  tickets: {
    view: { label: "rolePermissions.always.ticketView", short: "rolePermissions.short.own" },
    create: { label: "rolePermissions.always.ticketCreate", short: "rolePermissions.short.everyone" },
    update: { label: "rolePermissions.always.ticketUpdate", short: "rolePermissions.short.own" },
    delete: { label: "rolePermissions.always.ticketDelete", short: "rolePermissions.short.own" },
    approve: { label: "rolePermissions.always.ticketApprove", short: "rolePermissions.short.byRoute" },
  },
  assets: {
    view: { label: "rolePermissions.always.assetView", short: "rolePermissions.short.held" },
  },
  calendar: {
    view: { label: "rolePermissions.always.calendarView", short: "rolePermissions.short.byScope" },
  },
  leave: {
    view: { label: "rolePermissions.always.leaveView", short: "rolePermissions.short.own" },
    approve: { label: "rolePermissions.always.leaveApprove", short: "rolePermissions.short.asApprover" },
  },
  // ห้องประชุม: ทุกคนดูปฏิทินห้อง / จอง / แก้-ยกเลิก-ลบการจองของตัวเอง (routes/meeting-rooms.ts)
  meeting: {
    view: { label: "rolePermissions.always.meetingView", short: "rolePermissions.short.everyone" },
    create: { label: "rolePermissions.always.meetingCreate", short: "rolePermissions.short.everyone" },
  },
  // จองรถ: ทุกคนดูปฏิทินรถ / จอง / แก้-ยกเลิก-ลบ / บันทึกเลขไมล์ของตัวเอง (routes/vehicles.ts)
  vehicle: {
    view: { label: "rolePermissions.always.vehicleView", short: "rolePermissions.short.everyone" },
    create: { label: "rolePermissions.always.vehicleCreate", short: "rolePermissions.short.everyone" },
  },
  // ยืมอุปกรณ์ IT: ทุกคนดูปฏิทิน / จองยืม / แก้-ยกเลิกการจองของตัวเองก่อนส่งมอบ (routes/loans.ts)
  loans: {
    view: { label: "rolePermissions.always.loanView", short: "rolePermissions.short.everyone" },
    create: { label: "rolePermissions.always.loanCreate", short: "rolePermissions.short.everyone" },
  },
};

/** คำสั้นใต้ช่องติ๊กของสิทธิ์ที่ชื่อคอลัมน์อย่างเดียวไม่พอ (เช่น "ดู" ของใบแจ้งงาน = ดูของทุกคน ไม่ใช่ของตัวเอง) */
const SHORT: Partial<Record<string, MessageKey>> = {
  "tickets.view_all": "rolePermissions.short.all",
  "tickets.approve_any": "rolePermissions.short.onBehalfAll",
  "assets.view_all": "rolePermissions.short.all",
  "kpi.view_all": "rolePermissions.short.everyone",
  "leave.view_all": "rolePermissions.short.everyone",
  "leave.approve_any": "rolePermissions.short.onBehalf",
  "meeting.manage_any": "rolePermissions.short.others",
  "vehicle.dispatch": "rolePermissions.short.dispatch",
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
  const caption = (key: MessageKey | undefined) => key && <span className="whitespace-nowrap text-[11px] leading-none text-muted">{t(key)}</span>;
  // ช่อง "ทำได้เสมอ": ติ๊กไว้และล็อก แก้ไม่ได้ (+ คำสั้น เช่น "ของตัวเอง")
  const always = (moduleKey: string, c: Column) => {
    const a = ALWAYS[moduleKey]?.[c];
    if (!a) return null;
    return (
      <Tooltip label={t(a.label)} side="top">
        <span className="inline-flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-1">
            <input type="checkbox" checked readOnly disabled aria-label={t(a.label)} className="h-4 w-4 cursor-not-allowed accent-[var(--accent-500)] opacity-60" />
            <LockIcon width={11} height={11} className="shrink-0 text-faint" />
          </span>
          {caption(a.short)}
        </span>
      </Tooltip>
    );
  };
  const control = (p: PermissionDef) => (
    <Tooltip label={name(p)} side="top">
      <span className="inline-flex flex-col items-center gap-1">
        <span className="inline-flex items-center gap-1">
          {cell(p)}
          {lockBadge(p)}
        </span>
        {caption(SHORT[p.key])}
      </span>
    </Tooltip>
  );
  /** ช่องของคอลัมน์: "ทำได้เสมอ" (ถ้ามี) + สิทธิ์ที่ติ๊กได้ เรียงแนวนอน */
  const slot = (moduleKey: string, c: Column, perms: PermissionDef[]) => (
    <span className="inline-flex items-start justify-center gap-4">
      {always(moduleKey, c)}
      {perms.map((p) => (
        <span key={p.key}>{control(p)}</span>
      ))}
    </span>
  );

  return (
    <>
      {/* วิธีอ่านตาราง */}
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <input type="checkbox" checked readOnly disabled tabIndex={-1} aria-hidden="true" className="h-3.5 w-3.5 accent-[var(--accent-500)] opacity-60" />
          <LockIcon width={11} height={11} className="text-faint" />
          {t("rolePermissions.legend.always")}
        </li>
        <li>{t("rolePermissions.legend.blank")}</li>
        <li>{t("rolePermissions.legend.hover")}</li>
      </ul>
      {/* จอใหญ่: ตาราง */}
      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-line md:block">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              {/* คอลัมน์ระบบงานกินพื้นที่ที่เหลือ → ช่องสิทธิ์ทั้งหมดชิดขวา */}
              <th className="w-full px-4 py-2.5 text-left font-medium">{t("rolePermissions.module")}</th>
              {COLUMNS.map((c) => (
                <th key={c} className={`${CELL} py-2.5 font-medium whitespace-nowrap ${c === "other" ? "min-w-72 pl-6 text-left" : "min-w-40 text-center"}`}>
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
                  <td className={`${CELL} py-3 text-center`}>{slot(m.key, "view", at("view"))}</td>
                  {manage.length > 0 && at("create").length + at("update").length === 0 ? (
                    <>
                      {/* "จัดการ" คร่อมคอลัมน์ เพิ่ม–แก้ไข (–ลบ ถ้าไม่มีสิทธิ์ลบแยก) */}
                      <td colSpan={at("delete").length ? 2 : 3} className={`${CELL} py-3 text-center`}>
                        {manage.map((p) => (
                          <span key={p.key} className="inline-flex items-center gap-1.5">
                            {control(p)}
                            <span className="text-xs text-muted">{t("rolePermissions.actions.manage")}</span>
                          </span>
                        ))}
                      </td>
                      {at("delete").length > 0 && <td className={`${CELL} py-3 text-center`}>{at("delete").map((p) => <span key={p.key}>{control(p)}</span>)}</td>}
                    </>
                  ) : (
                    (["create", "update", "delete"] as const).map((c) => (
                      <td key={c} className={`${CELL} py-3 text-center`}>
                        {slot(m.key, c, [...at(c), ...(c === "create" ? manage : [])])}
                      </td>
                    ))
                  )}
                  <td className={`${CELL} py-3 text-center`}>{slot(m.key, "approve", at("approve"))}</td>
                  <td className={`${CELL} py-3 pl-6`}>
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
              {Object.entries(ALWAYS[m.key] ?? {}).map(([c, a]) => (
                <li key={c} className="flex items-center gap-3 px-3 py-2 text-muted">
                  <input type="checkbox" checked readOnly disabled className="h-4 w-4 accent-[var(--accent-500)] opacity-60" />
                  <span className="min-w-0 flex-1 text-sm">{t(a!.label)}</span>
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
