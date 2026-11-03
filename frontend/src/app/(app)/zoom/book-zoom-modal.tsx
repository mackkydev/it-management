"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ZoomBookingValues } from "@/app/actions/zoom";
import { PlusIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { ZoomForm } from "./zoom-form";

/** กรอบ modal จอง ZOOM (หน้ารายการจอง ZOOM + ฟอร์มจองห้องประชุม) — Esc / คลิกนอกกล่อง = ปิด */
export function ZoomModalFrame({ title, subtitle, onClose, children }: { title?: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-zoom-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id="book-zoom-title" className="font-semibold">
              {title ?? t("zoom.form.newTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink">
            <XIcon width={18} height={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * ปุ่ม "จองใช้ ZOOM" + ฟอร์มจองใน modal (หน้ารายการจอง ZOOM) — เปิดจากปฏิทิน/ไทม์ไลน์ด้วย ?book=1&date=&start=&end= = เปิด modal ทันที
 * บันทึกแล้วไปหน้ารายละเอียดการจอง
 */
export function BookZoomModal({ initial, initialRange, autoOpen = false }: { initial: ZoomBookingValues; initialRange: ZoomBooking[]; autoOpen?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const close = () => {
    setOpen(false);
    // เปิดจากลิงก์ (?book=1) — ปิดแล้วล้างพารามิเตอร์ ไม่ให้เปิดซ้ำตอนโหลดหน้าใหม่
    if (autoOpen) router.replace("/zoom/mine");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn.primary}>
        <PlusIcon />
        {t("zoom.book")}
      </button>
      {open && (
        <ZoomModalFrame subtitle={t("zoom.form.subtitle")} onClose={close}>
          <ZoomForm id={null} initial={initial} initialRange={initialRange} onCancel={close} embedded />
        </ZoomModalFrame>
      )}
    </>
  );
}
