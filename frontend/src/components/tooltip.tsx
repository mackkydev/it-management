"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

/** ระยะห่างจากปุ่ม / ระยะห่างขั้นต่ำจากขอบจอ */
const GAP = 10;
const EDGE = 6;

interface Anchor {
  x: number;
  top: number;
  bottom: number;
}

/**
 * Tooltip สวยๆ แบบ inverted (พื้นเข้ม/ตัวอักษรสว่าง ตามโหมดสว่าง–มืดอัตโนมัติ) พร้อมลูกศรและ animation — แสดงด้านบนเสมอ (กฎใน CLAUDE.md)
 * - เลื่อนซ้าย-ขวาไม่ให้ล้นขอบจอ (ลูกศรยังชี้ที่ปุ่ม), ปุ่มชิดขอบบนจนไม่มีที่ = แสดงด้านล่างเฉพาะกรณีนั้น
 * - render ผ่าน portal ด้วย position: fixed จึงไม่ถูกตัดโดยกล่องที่ overflow (เช่น sidebar ที่ scroll ได้)
 * - แสดงทั้งตอน hover และตอนโฟกัสด้วยคีย์บอร์ด, ซ่อนเมื่อ scroll
 */
export function Tooltip({
  label,
  disabled = false,
  className = "",
  children,
}: {
  label: ReactNode;
  disabled?: boolean;
  /** class เพิ่มของกล่องที่ครอบ (เช่น flex-1 ให้ครอบทั้งช่อง) */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const id = useId();

  const show = (e: SyntheticEvent) => {
    const el = ref.current;
    // เหตุการณ์จาก popup ที่เปิดจากปุ่มนี้ (portal) ส่งต่อมาตาม React tree — ไม่ใช่การชี้ที่ปุ่มจริง
    if (!el || disabled || !el.contains(e.target as Node)) return;
    const r = el.getBoundingClientRect();
    setAnchor({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };
  const hide = () => setAnchor(null);

  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [anchor]);

  // วัดขนาดจริงก่อนวาด แล้วขยับให้อยู่ในจอ
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const arrow = arrowRef.current;
    if (!anchor || !tip || !arrow) return;
    const half = tip.offsetWidth / 2;
    const left = Math.max(EDGE + half, Math.min(anchor.x, window.innerWidth - EDGE - half));
    const below = anchor.top - GAP - tip.offsetHeight < EDGE;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? anchor.bottom + GAP : anchor.top - GAP}px`;
    tip.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    arrow.style.left = `${anchor.x - left + half}px`;
    arrow.style.top = below ? "0" : "100%";
  }, [anchor]);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide} // คลิกแล้วซ่อน (เช่น ปุ่มที่เปิดเมนู ไม่ให้ tooltip ทับเมนู)
      aria-describedby={anchor && !disabled ? id : undefined}
    >
      {children}
      {anchor &&
        !disabled &&
        createPortal(
          <span ref={tipRef} role="tooltip" id={id} className="pointer-events-none fixed z-[100] w-max max-w-[min(24rem,calc(100vw-1rem))]" style={{ left: anchor.x, top: anchor.top - GAP, transform: "translate(-50%, -100%)" }}>
            <span className="tooltip-in tooltip-top relative block rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-canvas shadow-lg shadow-black/15 ring-1 ring-white/10">
              <span ref={arrowRef} className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink" aria-hidden="true" />
              <span className="relative">{label}</span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
