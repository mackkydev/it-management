"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "right" | "top" | "bottom";

interface Pos {
  left: number;
  top: number;
}

/**
 * Tooltip สวยๆ แบบ inverted (พื้นเข้ม/ตัวอักษรสว่าง ตามโหมดสว่าง–มืดอัตโนมัติ) พร้อมลูกศรและ animation
 * - render ผ่าน portal ด้วย position: fixed จึงไม่ถูกตัดโดยกล่องที่ overflow (เช่น sidebar ที่ scroll ได้)
 * - แสดงทั้งตอน hover และตอนโฟกัสด้วยคีย์บอร์ด, ซ่อนเมื่อ scroll
 */
export function Tooltip({
  label,
  side = "right",
  disabled = false,
  children,
}: {
  label: ReactNode;
  side?: Side;
  disabled?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const id = useId();

  const show = () => {
    const el = ref.current;
    if (!el || disabled) return;
    const r = el.getBoundingClientRect();
    const gap = 10;
    if (side === "right") setPos({ left: r.right + gap, top: r.top + r.height / 2 });
    else if (side === "top") setPos({ left: r.left + r.width / 2, top: r.top - gap });
    else setPos({ left: r.left + r.width / 2, top: r.bottom + gap });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [pos]);

  const transform =
    side === "right" ? "translateY(-50%)" : side === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  const arrow =
    side === "right"
      ? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : side === "top"
        ? "left-1/2 top-full -translate-x-1/2 -translate-y-1/2"
        : "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2";

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide} // คลิกแล้วซ่อน (เช่น ปุ่มที่เปิดเมนู ไม่ให้ tooltip ทับเมนู)
      aria-describedby={pos && !disabled ? id : undefined}
    >
      {children}
      {pos &&
        !disabled &&
        createPortal(
          <span role="tooltip" id={id} className="pointer-events-none fixed z-[100]" style={{ left: pos.left, top: pos.top, transform }}>
            <span
              className={`tooltip-in tooltip-${side} relative block whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-canvas shadow-lg shadow-black/15 ring-1 ring-white/10`}
            >
              <span className={`absolute h-2 w-2 rotate-45 bg-ink ${arrow}`} aria-hidden="true" />
              <span className="relative">{label}</span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
