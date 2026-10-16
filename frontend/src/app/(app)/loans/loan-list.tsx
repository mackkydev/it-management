"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { card, table } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Loan } from "@/lib/types";
import { LoanDialog } from "./loan-dialog";
import { LoanStatusBadge } from "./loan-status";
import { periodText } from "./loan-utils";

/** รายการการยืม (ของฉัน / ผู้จัดการ) — ตารางบนจอใหญ่ การ์ดบนมือถือ, คลิกแถว = รายละเอียด + ปุ่มตามสิทธิ์ */
export function LoanList({ items, showBorrower = false }: { items: Loan[]; showBorrower?: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<Loan | null>(null);

  return (
    <>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("loan.col.device")}</th>
              {showBorrower && <th className={table.th}>{t("loan.col.borrower")}</th>}
              <th className={table.th}>{t("loan.col.when")}</th>
              <th className={table.th}>{t("loan.col.purpose")}</th>
              <th className={table.th}>{t("loan.col.status")}</th>
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((l) => (
              <tr key={l.id} onClick={() => setSelected(l)} className={`${table.row} cursor-pointer`}>
                <td className={table.td}>
                  <span className="font-mono text-xs font-semibold text-accent-700 dark:text-accent-300">{l.asset.asset_tag}</span>
                  <span className="block text-sm">{l.asset.name}</span>
                </td>
                {showBorrower && (
                  <td className={table.td}>
                    {l.user.name}
                    {l.department && <span className="block text-xs text-muted">{l.department}</span>}
                  </td>
                )}
                <td className={`${table.td} whitespace-nowrap`}>{periodText(l, fmt.date)}</td>
                <td className={table.td}>
                  <span className="line-clamp-2 max-w-xs text-sm">{l.purpose}</span>
                </td>
                <td className={table.td}>
                  <LoanStatusBadge loan={l} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => setSelected(l)} className={`block w-full cursor-pointer space-y-1.5 p-4 text-left ${card}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-accent-700 dark:text-accent-300">{l.asset.asset_tag}</span>
                  <span className="block font-medium">{l.asset.name}</span>
                </span>
                <LoanStatusBadge loan={l} />
              </span>
              <span className="block text-sm">{periodText(l, fmt.date)}</span>
              {showBorrower && <span className="block text-xs text-muted">{[l.user.name, l.department].filter(Boolean).join(" · ")}</span>}
              <span className="line-clamp-2 block text-xs text-muted">{l.purpose}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && <LoanDialog loan={selected} onClose={() => setSelected(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
