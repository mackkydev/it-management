"use client";

import { Tooltip } from "@/components/tooltip";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { LoanDevice } from "@/lib/types";
import { periodText } from "./loan-utils";

/**
 * รายการโน้ตบุ๊กที่ให้ยืม (คอลัมน์ซ้ายของหน้า ยืมโน้ตบุ๊ก) — แสดงสถานะอย่างเดียว ว่าง / ติดยืม (ไม่มีปุ่มยืมต่อเครื่อง:
 * ผู้ยืมกด ยืม-จอง ด้านบน แล้วเจ้าหน้าที่ IT เลือกเครื่องให้) — สีประจำเครื่องตรงกับแถบในปฏิทิน, ชี้ = ช่วงที่ติดยืม/จอง
 */
export function DeviceList({ devices, colorOf }: { devices: LoanDevice[]; colorOf: (id: number) => string }) {
  const { t, fmt } = useI18n();

  return (
    <section className={`overflow-hidden ${card}`}>
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{t("loan.board.devices")}</h2>
      {devices.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">{t("loan.noDevices")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {devices.map((d) => {
            const status = d.on_loan
              ? d.on_loan.returning
                ? { text: t("loan.board.returning", { name: d.on_loan.user }), cls: "bg-warning-100 text-warning-800 ring-warning-300 dark:bg-warning-400/20 dark:text-warning-200 dark:ring-warning-400/40" }
                : d.on_loan.is_overdue
                  ? { text: `${t("loan.states.overdue")} — ${d.on_loan.user}`, cls: "bg-danger-100 text-danger-800 ring-danger-300 dark:bg-danger-400/20 dark:text-danger-200 dark:ring-danger-400/40" }
                  : { text: t("loan.board.onLoan", { name: d.on_loan.user, end: `${fmt.date(d.on_loan.end_on)} ${d.on_loan.end_time}` }), cls: "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/20 dark:text-accent-200 dark:ring-accent-400/40" }
              : { text: t("loan.board.free"), cls: "bg-success-100 text-success-800 ring-success-300 dark:bg-success-400/20 dark:text-success-200 dark:ring-success-400/40" };
            const upcoming = (d.busy ?? []).filter((b) => b.status === "reserved");
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`h-8 w-1.5 shrink-0 rounded-full ring-1 ring-inset ${colorOf(d.id)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {d.asset_tag}
                    {d.brand || d.model ? ` · ${[d.brand, d.model].filter(Boolean).join(" ")}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`inline-flex max-w-[14rem] truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.cls}`}>{status.text}</span>
                  {upcoming.length > 0 && (
                    <Tooltip
                      label={
                        <span className="block space-y-0.5 text-left">
                          {upcoming.map((b) => (
                            <span key={b.id} className="block">
                              {t("loan.board.busyItem", { period: periodText(b, fmt.date), name: b.user })}
                            </span>
                          ))}
                        </span>
                      }
                    >
                      <span className="text-2xs text-muted">{t("loan.board.busy")} {upcoming.length}</span>
                    </Tooltip>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
