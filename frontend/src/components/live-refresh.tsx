"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** event ที่ส่งเมื่อพบข้อมูลเปลี่ยน — ส่วนที่ดึงข้อมูลเอง (เช่น กระดิ่งแจ้งเตือน) ฟังเพื่อโหลดใหม่ทันที */
export const DATA_CHANGED_EVENT = "eam:data-changed";

/**
 * อัปเดตหน้าแบบ real-time: ถาม /sync ทุก ๆ intervalMs ขณะที่แท็บเปิดอยู่
 * ถ้าลายนิ้วมือข้อมูลเปลี่ยน → router.refresh() (โหลดข้อมูลฝั่ง server ใหม่ ค่าที่กรอกค้างในฟอร์มยังอยู่)
 */
export function LiveRefresh({ scope = "app", intervalMs = 10_000 }: { scope?: "app" | "public"; intervalMs?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    let busy = false;
    const check = async () => {
      // รอบแรกเก็บค่าตั้งต้นเสมอ (แม้แท็บซ่อนอยู่) — รอบถัดไปถามเฉพาะตอนแท็บเปิดอยู่
      if (busy || (last.current !== null && document.visibilityState !== "visible")) return;
      busy = true;
      try {
        const res = await fetch(scope === "public" ? "/sync?scope=public" : "/sync", { cache: "no-store" });
        if (res.status !== 200) return;
        const { version } = (await res.json()) as { version: string };
        if (last.current !== null && version !== last.current) {
          router.refresh();
          window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
        }
        last.current = version;
      } catch {
        // เครือข่ายหลุดชั่วคราว — รอรอบถัดไป
      } finally {
        busy = false;
      }
    };

    check();
    const timer = window.setInterval(check, intervalMs);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, scope, intervalMs]);

  return null;
}
