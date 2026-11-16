import "server-only";

import { cache } from "react";
import { getPrefs } from "@/lib/prefs-server";
import { apiFetch } from "@/lib/api";
import type { Locale } from "@/lib/prefs";
import en from "./en";
import th from "./th";
import { createFormatters, createT, type Dictionary } from "./types";

const DICTIONARIES: Record<Locale, Dictionary> = { th, en };

/** ชื่อระบบ + ข้อความใต้ชื่อที่ตั้งไว้ — ว่าง = ใช้ค่าตั้งต้น, อ่าน API ไม่ได้ก็ยังแสดงหน้าเว็บด้วยค่าตั้งต้น */
export const getBranding = cache(async (): Promise<{ name: string; tagline: string }> => {
  try {
    return (await apiFetch<{ data: { name: string; tagline: string } }>("/branding")).data;
  } catch {
    return { name: "", tagline: "" };
  }
});

const branded: Partial<Record<Locale, { key: string; dict: Dictionary }>> = {};

/** แทนชื่อตั้งต้นในทุกข้อความ (เมนู, หน้า login, คำแนะนำติดตั้งแอป, แบบฟอร์ม) — เก็บผลไว้ ไม่ต้องแทนใหม่ทุกครั้ง */
function brandDictionary(locale: Locale, { name, tagline }: { name: string; tagline: string }): Dictionary {
  const base = DICTIONARIES[locale];
  if (!name && !tagline) return base;
  const key = JSON.stringify([name, tagline]);
  const hit = branded[locale];
  if (hit?.key === key) return hit.dict;
  const shown = name || base.app.name;
  const swapped = name ? JSON.stringify(base).replaceAll(base.app.name, () => JSON.stringify(name).slice(1, -1)) : JSON.stringify(base);
  const dict = JSON.parse(swapped) as Dictionary;
  if (tagline) dict.app = { ...dict.app, tagline, fullName: `${shown} ${tagline}` };
  branded[locale] = { key, dict };
  return dict;
}

/** ใช้ใน Server Component / Server Action: const { t, fmt } = await getI18n() — defaults = ชื่อตั้งต้นของภาษานี้ */
export const getI18n = cache(async () => {
  const { locale } = await getPrefs();
  const dict = brandDictionary(locale, await getBranding());
  return { locale, dict, defaults: DICTIONARIES[locale].app, t: createT(dict), fmt: createFormatters(locale) };
});
