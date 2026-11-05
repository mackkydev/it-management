"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PrinterIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { DOCUMENT_PRINT_CSS } from "@/lib/print-page";

/**
 * เทมเพลตเอกสารกลางของระบบ — ทุกหน้าที่พิมพ์หรือเรียกดูเอกสารต้องใช้ชุดนี้ หน้าตาจะได้เหมือนกันทั้งระบบ (กฎใน CLAUDE.md)
 *   DocumentModal   กล่องกลางจอ: หัวข้อ + ปุ่มปิด (Esc / คลิกนอกกล่อง = ปิด เฉพาะกล่องนี้ แม้เปิดซ้อนบน popup อื่น)
 *   DocumentToolbar แถวเครื่องมือ: คำแนะนำซ้าย + ปุ่มขวา
 *   PrintToolbar    แถวเครื่องมือของเอกสารที่พิมพ์ได้
 *   PrintDocument   หน้าเอกสาร A4 ทั้งหน้า (เปิดในกล่องผ่าน DocumentLink kind="page")
 */
export function DocumentModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="ticket-print-root fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-2 backdrop-blur-sm sm:p-6 print:static print:block print:bg-transparent print:p-0 print:backdrop-blur-none"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line print:block print:h-auto print:max-w-none print:overflow-visible print:rounded-none print:bg-transparent print:shadow-none print:ring-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 print:hidden">
          <h2 className="min-w-0 truncate font-semibold">
            {title}
            {subtitle && <span className="ml-2 font-mono text-sm font-normal text-muted">{subtitle}</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="shrink-0 cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink">
            <XIcon width={18} height={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** แถวเครื่องมือเหนือเอกสาร: คำแนะนำซ้าย + ปุ่มขวา — ไม่ออกในกระดาษ */
export function DocumentToolbar({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
      <p className="text-sm text-muted">{hint}</p>
      {children}
    </div>
  );
}

/** แถวเครื่องมือของเอกสารที่พิมพ์ได้ — fileName = ชื่อไฟล์ตอนบันทึกเป็น PDF (ไม่ระบุ = ชื่อหน้า) */
export function PrintToolbar({ fileName }: { fileName?: string }) {
  const { t } = useI18n();
  const print = () => {
    const title = document.title;
    if (fileName) document.title = fileName;
    window.print();
    document.title = title;
  };
  return (
    <DocumentToolbar hint={t("policyDoc.pdfHint")}>
      <button type="button" onClick={print} className={btn.primary}>
        <PrinterIcon />
        {t("policyDoc.print")}
      </button>
    </DocumentToolbar>
  );
}

/** หน้าเอกสาร A4: แถวเครื่องมือ + กระดาษขาว + หน้ากระดาษตอนพิมพ์ที่แสดงเฉพาะเลขหน้า — className = ระยะห่างในกระดาษ */
export function PrintDocument({ className = "space-y-5", children }: { className?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas py-6 text-black print:bg-white print:py-0">
      <style>{DOCUMENT_PRINT_CSS}</style>
      <PrintToolbar />
      <article className={`mx-auto max-w-[210mm] bg-white p-10 shadow print:p-0 print:shadow-none ${className}`}>{children}</article>
    </div>
  );
}
