"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Loan, LoanDevice } from "@/lib/types";
import { DeviceList } from "./device-list";
import { LoanCalendar } from "./loan-calendar";
import { blankLoan, LoanForm } from "./loan-form";
import { loanColorOf } from "./loan-utils";

/**
 * หน้า ยืมโน้ตบุ๊ก: ปุ่ม ยืม-จอง (กล่องฟอร์มขอยืม — ไม่ต้องเลือกเครื่อง), ซ้าย = รายการโน้ตบุ๊ก + สถานะ ว่าง / ติดยืม, ขวา = ปฏิทินเดือน
 * ปฏิทิน คลิกวัน / + / คลิกขวา = เปิดกล่อง ยืม-จอง วันนั้น — ขอยืมแล้ว → โหลดรายการ + ปฏิทินใหม่
 */
export function LoanBoard({
  month,
  loans,
  devices,
  canBook,
  borrower,
  initialDate,
}: {
  month: string;
  loans: Loan[];
  devices: LoanDevice[];
  canBook: boolean;
  borrower: { name: string; department: string | null };
  /** เปิดกล่อง ยืม-จอง ไว้ให้ (ลิงก์เดิม ?date=) */
  initialDate: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const colorOf = useMemo(() => loanColorOf(devices.map((d) => d.id)), [devices]);
  const [booking, setBooking] = useState<{ date: string; nonce: number } | null>(initialDate ? { date: initialDate, nonce: 1 } : null);
  const [refreshKey, setRefreshKey] = useState(0);
  const open = (date = localToday()) => setBooking({ date, nonce: Date.now() });

  return (
    <div className="space-y-4">
      {canBook && (
        <div className="flex justify-end">
          <button type="button" onClick={() => open()} className={btn.primary}>
            <PlusIcon />
            {t("loan.board.borrow")}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <DeviceList devices={devices} colorOf={colorOf} />
        <LoanCalendar month={month} initialLoans={loans} colorOf={colorOf} canBook={canBook} refreshKey={refreshKey} onBook={open} />
      </div>
      {booking && (
        <ModalShell id="loan-book" title={t("loan.board.newRequest")} subtitle={t("loan.board.subtitle")} onClose={() => setBooking(null)} size="lg">
          <div className="overflow-y-auto p-5">
            <LoanForm
              key={booking.nonce}
              id={null}
              initial={blankLoan(booking.date)}
              borrower={borrower}
              onCancel={() => setBooking(null)}
              onDone={() => {
                setBooking(null);
                toast("success", t("loan.form.saved"));
                setRefreshKey((k) => k + 1);
                router.refresh();
              }}
            />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
