"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileTextIcon, PrinterIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * ตอนพิมพ์: กระดาษ A4 ไม่มีขอบเว้นของเครื่องพิมพ์ (เอกสารกำหนดระยะขอบเอง)
 * และซ่อนทุกอย่างใน body ยกเว้น modal นี้ (portal เป็นลูกตรงของ body) — ใช้เฉพาะตอน modal เปิดอยู่
 */
const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.ticket-print-root) { display: none !important; }
}`;

/** ปุ่ม "พิมพ์" → modal แสดงเอกสาร A4 พร้อมปุ่มพิมพ์ / บันทึก PDF (ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์) */
export function PrintModal({ label, fileName, children }: { label: string; fileName: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** ชื่อเอกสาร = ชื่อไฟล์ตอน "บันทึกเป็น PDF" (เช่น IT-2026-00001.pdf) */
  const print = () => {
    const title = document.title;
    document.title = fileName;
    window.print();
    document.title = title;
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn.secondary} ${btn.sm}`}>
        <PrinterIcon width={14} height={14} className="text-accent-500" />
        {label}
      </button>
      {open &&
        createPortal(
          <div
            className="ticket-print-root fixed inset-0 z-[60] flex bg-black/50 p-2 backdrop-blur-sm sm:p-6 print:static print:block print:bg-transparent print:p-0 print:backdrop-blur-none"
            onClick={() => setOpen(false)}
          >
            <style>{PRINT_CSS}</style>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("ticketPaper.title")}
              onClick={(e) => e.stopPropagation()}
              className="m-auto flex max-h-full w-full max-w-[calc(210mm+2rem)] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line print:m-0 print:block print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:bg-transparent print:shadow-none print:ring-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 print:hidden">
                <h2 className="font-semibold">
                  {t("ticketPaper.title")} <span className="font-mono text-sm text-muted">{fileName}</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="hidden text-xs text-muted md:inline">{t("ticketPaper.toolbar.pdfHint")}</span>
                  <button type="button" onClick={print} className={`${btn.secondary} ${btn.sm}`}>
                    <FileTextIcon width={14} height={14} className="text-accent-500" />
                    {t("ticketPaper.toolbar.pdf")}
                  </button>
                  <button type="button" onClick={print} className={`${btn.primary} ${btn.sm}`}>
                    <PrinterIcon width={14} height={14} />
                    {t("ticketPaper.toolbar.print")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={t("ticketPaper.toolbar.close")}
                    className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink"
                  >
                    <XIcon width={18} height={18} />
                  </button>
                </div>
              </div>
              {/* กระดาษ A4 — บนจอเลื่อนดูได้, ตอนพิมพ์ไม่มีกรอบ/เงา */}
              <div className="overflow-auto bg-subtle p-4 print:overflow-visible print:bg-transparent print:p-0">
                <div className="mx-auto w-fit shadow-lg ring-1 ring-line print:shadow-none print:ring-0">{children}</div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
