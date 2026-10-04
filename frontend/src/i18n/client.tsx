"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/lib/prefs";
import { createFormatters, createT, type Dictionary, type Formatters, type TFunction } from "./types";

interface I18nValue {
  locale: Locale;
  t: TFunction;
  fmt: Formatters;
}

const I18nContext = createContext<I18nValue | null>(null);

/** วางไว้ที่ root layout — ส่ง dictionary ของภาษาที่เลือกจาก server ลงมาให้ Client Component */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(dict), fmt: createFormatters(locale) }), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
