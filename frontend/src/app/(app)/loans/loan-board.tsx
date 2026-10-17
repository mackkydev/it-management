"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Loan, LoanDevice } from "@/lib/types";
import { DeviceList, type OpenRequest } from "./device-list";
import { LoanCalendar } from "./loan-calendar";
import { loanColorOf } from "./loan-utils";

/**
 * หน้า ยืมโน้ตบุ๊ก: ซ้าย = รายการโน้ตบุ๊ก (ยืม-จอง ขยายฟอร์มด้านล่าง), ขวา = ปฏิทินเดือน
 * ปฏิทิน ดับเบิลคลิก / คลิกขวาที่วัน → เลือกเครื่องที่ว่าง → เปิดฟอร์มของเครื่องนั้นในรายการ (วันเริ่ม-สิ้นสุด = วันนั้น)
 * จองแล้ว → โหลดรายการ (ช่วงที่ติดยืม) + ปฏิทินใหม่
 */
export function LoanBoard({
  month,
  loans,
  devices,
  canBook,
  initialOpen,
}: {
  month: string;
  loans: Loan[];
  devices: LoanDevice[];
  canBook: boolean;
  initialOpen: OpenRequest;
}) {
  const router = useRouter();
  const colorOf = useMemo(() => loanColorOf(devices.map((d) => d.id)), [devices]);
  const [open, setOpen] = useState<OpenRequest>(initialOpen);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <DeviceList
        devices={devices}
        colorOf={colorOf}
        canBook={canBook}
        open={open}
        onSaved={() => {
          setRefreshKey((k) => k + 1);
          router.refresh();
        }}
      />
      <LoanCalendar
        month={month}
        initialLoans={loans}
        devices={devices}
        colorOf={colorOf}
        canBook={canBook && devices.length > 0}
        refreshKey={refreshKey}
        onPick={(date, deviceId) => setOpen({ deviceId, date, nonce: Date.now() })}
      />
    </div>
  );
}
