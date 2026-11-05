"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

const SIZE = {
  md: "max-h-full w-full max-w-lg",
  wide: "max-h-full w-full max-w-3xl",
  xl: "max-h-full w-full max-w-5xl",
  /** อ่านนโยบาย: สูง 80% กว้าง 70% ของจอ (จอมือถือเต็มความกว้าง) */
  policy: "h-[80vh] w-full sm:w-[70vw]",
} as const;

/** กล่อง popup กลางจอ (พื้นหลัง bg-overlay, Esc / คลิกนอกกล่อง = ปิด) — ใช้กับฟอร์มสั้นๆ เช่น โอนย้ายสินทรัพย์ / จัดการสัญญา */
export function ModalShell({ id, title, subtitle, onClose, children, busy = false, size = "md" }: { id: string; title: string; subtitle?: string; onClose: () => void; children: ReactNode; busy?: boolean; size?: keyof typeof SIZE }) {
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
        className={`flex flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line ${SIZE[size]}`}
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
        <div className={`overflow-y-auto px-5 py-4 ${size === "policy" ? "min-h-0 flex-1" : ""}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
