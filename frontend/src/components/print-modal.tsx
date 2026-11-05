"use client";

import { useState, type ReactNode } from "react";
import { DocumentModal, PrintToolbar } from "@/components/document-template";
import { PrinterIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { SHEET_PRINT_CSS } from "@/lib/print-page";

/** ปุ่ม "พิมพ์" → แบบฟอร์มเต็มแผ่น A4 ในเทมเพลตเอกสารกลาง — title = หัวกล่อง (ตั้งต้น ใบแจ้งดำเนินงาน IT), fileName = ชื่อไฟล์ตอนบันทึก PDF เช่น IT-2026-00001.pdf */
export function PrintModal({ label, fileName, title, children }: { label: string; fileName: string; title?: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn.secondary} ${btn.sm}`}>
        <PrinterIcon width={14} height={14} className="text-accent-500" />
        {label}
      </button>
      {open && (
        <DocumentModal title={title ?? t("ticketPaper.title")} subtitle={fileName} onClose={() => setOpen(false)}>
          <style>{SHEET_PRINT_CSS}</style>
          {/* กระดาษ A4 — บนจอเลื่อนดูได้, ตอนพิมพ์ไม่มีกรอบ/เงา */}
          <div className="min-h-0 flex-1 overflow-auto bg-canvas py-6 print:overflow-visible print:bg-transparent print:py-0">
            <PrintToolbar fileName={fileName} />
            <div className="mx-auto w-fit shadow print:shadow-none">{children}</div>
          </div>
        </DocumentModal>
      )}
    </>
  );
}
