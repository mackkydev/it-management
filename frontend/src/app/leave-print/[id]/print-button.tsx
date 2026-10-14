"use client";

import { PrinterIcon } from "@/components/icons";
import { btn } from "@/components/ui";

/** ปุ่มพิมพ์ / บันทึก PDF (หน้าต่างพิมพ์ของเบราว์เซอร์) */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={btn.primary}>
      <PrinterIcon />
      {label}
    </button>
  );
}
