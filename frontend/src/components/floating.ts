"use client";

import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * ตำแหน่งของกล่องลอย (dropdown / ปฏิทิน) ใต้ปุ่ม — ใช้ position: fixed จึงไม่ถูกตัดโดยการ์ด/ตารางที่ overflow hidden
 * ที่ว่างด้านล่างไม่พอ → แสดงด้านบนแทน; ติดตามการเลื่อนหน้า/ย่อขยายหน้าต่าง
 */
export function useFloating(trigger: RefObject<HTMLElement | null>, open: boolean, opts: { minWidth?: number; height?: number } = {}): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  const height = opts.height ?? 280;

  const update = () => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, opts.minWidth ?? 0);
    const below = window.innerHeight - r.bottom;
    const up = below < height + 12 && r.top > below;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setStyle({
      position: "fixed",
      left,
      width,
      zIndex: 70,
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  };

  // คำนวณตำแหน่งในเฟรมถัดไปหลังเปิด (กล่องเริ่มแบบซ่อนไว้จนได้ตำแหน่ง)
  useLayoutEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- คำนวณใหม่เมื่อเปิดเท่านั้น
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => update();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return style;
}

/** ปิดเมื่อคลิกนอกกล่อง / กด Esc */
export function useDismiss(open: boolean, refs: RefObject<HTMLElement | null>[], close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!refs.some((r) => r.current?.contains(target))) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
