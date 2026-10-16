"use client";

import { useI18n } from "@/i18n/client";
import type { Loan } from "@/lib/types";
import { STATE_TONE, stateOf } from "./loan-utils";

/** ป้ายสถานะการยืม (เกินกำหนดคืน = สีแดง) */
export function LoanStatusBadge({ loan }: { loan: Pick<Loan, "status" | "is_overdue"> }) {
  const { t } = useI18n();
  const s = stateOf(loan);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_TONE[s].bar}`}>{t(`loan.states.${s}`)}</span>;
}
