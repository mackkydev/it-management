"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

/** กล่อง popup กลางจอ (พื้นหลัง bg-overlay, Esc / คลิกนอกกล่อง = ปิด) — ใช้กับฟอร์มสั้นๆ เช่น โอนย้ายสินทรัพย์ / จัดการสัญญา */
export function ModalShell({ id, title, subtitle, onClose, children, busy = false, size = "md" }: { id: string; title: string; subtitle?: string; onClose: () => void; children: ReactNode; busy?: boolean; size?: "md" | "wide" | "xl" }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line ${size === "xl" ? "max-w-5xl" : size === "wide" ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={id} className="font-semibold">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink disabled:cursor-not-allowed"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
