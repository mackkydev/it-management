"use client";

import { useEffect } from "react";

/** ลงทะเบียน service worker (public/sw.js) — production เท่านั้นที่ cache ไฟล์ build (?mode=production) */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?mode=${process.env.NODE_ENV}`, { scope: "/", updateViaCache: "none" }).catch(() => {
      // ลงทะเบียนไม่ได้ (เช่น เปิดผ่าน http ที่ไม่ใช่ localhost) — เว็บยังใช้งานได้ตามปกติ
    });
  }, []);
  return null;
}
