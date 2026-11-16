"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";

interface Access {
  user: User;
  uiConfig: UiConfig;
}

const AccessContext = createContext<Access | null>(null);

/** ผู้ใช้ที่ login + การตั้งค่าเมนู ให้คอมโพเนนต์ฝั่ง client ใน app shell (เช่น ปุ่ม + จัดการข้อมูลหลัก) — ใช้ซ่อนปุ่มเท่านั้น สิทธิ์จริงตรวจที่ API */
export function AccessProvider({ user, uiConfig, children }: Access & { children: ReactNode }) {
  return <AccessContext.Provider value={{ user, uiConfig }}>{children}</AccessContext.Provider>;
}

/** null = อยู่นอก app shell */
export function useAccess(): Access | null {
  return useContext(AccessContext);
}
