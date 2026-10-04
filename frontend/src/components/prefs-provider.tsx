"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { customThemeVars, HEX_RE } from "@/lib/color";
import { DEFAULT_PREFS, PREF_COOKIES, type Prefs } from "@/lib/prefs";

interface PrefsValue extends Prefs {
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

const ONE_YEAR = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string) {
  // ค่าการแสดงผลเท่านั้น (ไม่ใช่ข้อมูลลับ) จึงเขียนจากฝั่ง client ได้
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

function applyMode(mode: Prefs["mode"]) {
  const root = document.documentElement;
  root.dataset.mode = mode;
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

/** ชื่อตัวแปร CSS ทั้งหมดที่ธีมกำหนดเองตั้งไว้ใน style ของ <html> (ใช้ลบออกตอนกลับไปธีมสำเร็จรูป) */
const CUSTOM_VAR_NAMES = Object.keys(customThemeVars(DEFAULT_PREFS.accent));

function applyTheme(theme: Prefs["theme"], accent: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (theme === "custom" && HEX_RE.test(accent)) {
    for (const [name, value] of Object.entries(customThemeVars(accent))) root.style.setProperty(name, value);
  } else {
    for (const name of CUSTOM_VAR_NAMES) root.style.removeProperty(name);
  }
}

/**
 * เก็บค่าการแสดงผล (โหมด / ธีม / สีกำหนดเอง / รูปแบบเมนู / ภาษา)
 * - โหมดและธีม: เปลี่ยนที่ <html> ทันทีโดยไม่ต้องโหลดใหม่
 * - รูปแบบเมนูและภาษา: ต้อง render ฝั่ง server ใหม่ → router.refresh()
 */
export function PrefsProvider({ initial, children }: { initial: Prefs; children: ReactNode }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>(initial);

  // โหมด "ตามระบบ": ติดตามการเปลี่ยนโหมดของเครื่องแบบ realtime
  useEffect(() => {
    if (prefs.mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs.mode]);

  // ค่าล่าสุดสำหรับใช้ใน set() (ธีมกำหนดเองต้องรู้ทั้ง theme และ accent)
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);

  const set = useCallback(
    <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
      writeCookie(PREF_COOKIES[key], value);
      const next = { ...latest.current, [key]: value };
      latest.current = next;
      setPrefs(next);
      if (key === "mode") applyMode(value as Prefs["mode"]);
      if (key === "theme" || key === "accent") applyTheme(next.theme, next.accent);
      if (key === "layout" || key === "locale") router.refresh();
    },
    [router],
  );

  const value = useMemo(() => ({ ...prefs, set }), [prefs, set]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
