"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertIcon, CheckCircleIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * กล่องยืนยัน / แจ้งเตือนของระบบ — ใช้แทน window.confirm / window.alert ทุกที่
 *   const confirm = useConfirm();  if (!(await confirm(t("..."), { danger: true }))) return;
 *   const alert = useAlert();      await alert(message);
 * กด Esc / คลิกนอกกล่อง = ยกเลิก, Enter = ยืนยัน
 */
type Tone = "danger" | "info";
interface DialogRequest {
  kind: "confirm" | "alert";
  message: ReactNode;
  title?: string;
  confirmText?: string;
  tone: Tone;
  resolve: (ok: boolean) => void;
}
export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  /** ปุ่มยืนยันสีแดง (ลบ / ยกเลิก / เพิกถอน) — ค่าเริ่มต้น true */
  danger?: boolean;
}

const DialogContext = createContext<((req: Omit<DialogRequest, "resolve">) => Promise<boolean>) | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const open = useCallback((req: Omit<DialogRequest, "resolve">) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { ...req, resolve }])), []);
  const current = queue[0];
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  return (
    <DialogContext.Provider value={open}>
      {children}
      {current && <Dialog key={queue.length} req={current} onClose={close} />}
    </DialogContext.Provider>
  );
}

function useOpen() {
  const open = useContext(DialogContext);
  if (!open) throw new Error("useConfirm / useAlert must be used inside <DialogProvider>");
  return open;
}

export function useConfirm() {
  const open = useOpen();
  return useCallback(
    (message: ReactNode, opts: ConfirmOptions = {}) => open({ kind: "confirm", message, title: opts.title, confirmText: opts.confirmText, tone: opts.danger === false ? "info" : "danger" }),
    [open],
  );
}

export function useAlert() {
  const open = useOpen();
  return useCallback((message: ReactNode, opts: { title?: string; danger?: boolean } = {}) => open({ kind: "alert", message, title: opts.title, tone: opts.danger ? "danger" : "info" }).then(() => undefined), [open]);
}

function Dialog({ req, onClose }: { req: DialogRequest; onClose: (ok: boolean) => void }) {
  const { t } = useI18n();
  const okRef = useRef<HTMLButtonElement>(null);
  const danger = req.tone === "danger";

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(req.kind === "alert");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, req.kind]);

  const title = req.title ?? (req.kind === "confirm" ? t("dialog.confirmTitle") : t("dialog.alertTitle"));
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => onClose(req.kind === "alert")}>
      <div
        role={req.kind === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-message"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line"
      >
        <div className="flex gap-4 p-5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-danger-100 text-danger-600 dark:bg-danger-400/15 dark:text-danger-300" : "bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300"
            }`}
          >
            {danger ? <AlertIcon width={20} height={20} /> : <CheckCircleIcon width={20} height={20} />}
          </span>
          <div className="min-w-0 pt-1">
            <h2 id="app-dialog-title" className="font-semibold">
              {title}
            </h2>
            <div id="app-dialog-message" className="mt-1 whitespace-pre-line break-words text-sm text-muted">
              {req.message}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-subtle/50 px-5 py-3">
          {req.kind === "confirm" && (
            <button type="button" onClick={() => onClose(false)} className={btn.secondary}>
              {t("common.cancel")}
            </button>
          )}
          <button ref={okRef} type="button" onClick={() => onClose(true)} className={danger && req.kind === "confirm" ? btn.danger : btn.primary}>
            {req.confirmText ?? (req.kind === "confirm" ? t("dialog.confirm") : t("dialog.ok"))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
