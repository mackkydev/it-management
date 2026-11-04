"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

/**
 * Toast กลางจอบน ขนาดเท่ากันทุกอัน (max-w-sm, จอเล็กเต็มความกว้างหักขอบ) หายเองใน 3 วินาที (แอนิเมชัน `.toast-flash` ใน globals.css) — ใช้แทนแถบแจ้งผลในหน้า
 *   ผลจาก URL หลัง redirect:  {saved && <FlashToast param="saved" message={t("...")} />}  แสดงแล้วเอา param ออกจาก URL
 *   ผลใน state ของฟอร์ม:      {result.message && <ResultToast result={result} />}          แสดงใหม่ทุกครั้งที่ได้ object ผลใหม่
 *   เรียกเอง:                 const toast = useToast();  toast("success", message);
 */
export type ToastKind = "success" | "error" | "warning" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };
type Show = (kind: ToastKind, message: string) => void;

/** แถบซ้าย + พื้นจางตามสถานะ (วางบนพื้นทึบ bg-surface — สีจางโปร่งในโหมดมืด) */
const STYLE = {
  success: { box: "border-success-500 bg-success-50 dark:bg-success-400/10", icon: "text-success-500", Icon: CheckCircleIcon },
  error: { box: "border-danger-500 bg-danger-50 dark:bg-danger-400/10", icon: "text-danger-500", Icon: AlertIcon },
  warning: { box: "border-warning-500 bg-warning-50 dark:bg-warning-400/10", icon: "text-warning-500", Icon: AlertIcon },
  info: { box: "border-info-500 bg-info-50 dark:bg-info-400/10", icon: "text-info-500", Icon: InfoIcon },
} as const;

const ToastContext = createContext<Show | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const show = useCallback<Show>((kind, message) => {
    // ข้อความเดียวกันที่ยังแสดงอยู่ ไม่ซ้อนซ้ำ
    setItems((list) => (list.some((x) => x.kind === kind && x.message === message) ? list : [...list, { id: ++nextId.current, kind, message }]));
  }, []);
  const remove = (id: number) => setItems((list) => list.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={show}>
      {children}
      {items.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex flex-col items-center gap-2 px-4">
          {items.map(({ id, kind, message }) => {
            const { box, icon, Icon } = STYLE[kind];
            return (
              <div
                key={id}
                role={kind === "error" || kind === "warning" ? "alert" : "status"}
                onAnimationEnd={(e) => e.target === e.currentTarget && remove(id)}
                className="toast-flash pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-line"
              >
                <div className={`flex items-center gap-3 border-l-4 py-3 pl-4 pr-3 ${box}`}>
                  <Icon width={22} height={22} className={`shrink-0 ${icon}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{t(`toast.${kind}`)}</p>
                    <p className="text-sm text-muted">{message}</p>
                  </div>
                  <button type="button" onClick={() => remove(id)} aria-label={t("common.close")} className="ml-2 shrink-0 cursor-pointer text-faint transition-colors hover:text-ink">
                    <XIcon width={16} height={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}

function Flash({ param, message, kind }: { param: string; message: string; kind: ToastKind }) {
  const show = useToast();
  const pathname = usePathname();
  const params = useSearchParams();
  const present = params.has(param);
  useEffect(() => {
    if (!present) return;
    show(kind, message);
    // เอาออกจาก URL: refresh แล้วไม่แสดงซ้ำ และบันทึกอีกครั้งก็แสดงใหม่ได้
    const rest = new URLSearchParams(params);
    rest.delete(param);
    window.history.replaceState(null, "", rest.size ? `${pathname}?${rest}` : pathname);
  }, [present, show, kind, message, param, params, pathname]);
  return null;
}

/** Toast ของผลที่ส่งมาทาง URL หลัง redirect (เช่น ?saved=created) */
export function FlashToast({ param, message, kind = "success" }: { param: string; message: string; kind?: ToastKind }) {
  return (
    <Suspense fallback={null}>
      <Flash param={param} message={message} kind={kind} />
    </Suspense>
  );
}

/** Toast ของผลใน state — ข้อความล้วน = สำเร็จ; object = ตาม ok (ได้ object ใหม่ = แสดงใหม่ แม้ข้อความเดิม) */
export function ResultToast({ result }: { result: string | { ok?: boolean; text?: string; message?: string } }) {
  const show = useToast();
  useEffect(() => {
    if (typeof result === "string") return show("success", result);
    const message = result.text ?? result.message;
    if (message) show(result.ok ? "success" : "error", message);
  }, [result, show]);
  return null;
}
