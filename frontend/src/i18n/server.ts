import "server-only";

import { cache } from "react";
import { getPrefs } from "@/lib/prefs-server";
import type { Locale } from "@/lib/prefs";
import en from "./en";
import th from "./th";
import { createFormatters, createT, type Dictionary } from "./types";

const DICTIONARIES: Record<Locale, Dictionary> = { th, en };

/** ใช้ใน Server Component / Server Action: const { t, fmt } = await getI18n() */
export const getI18n = cache(async () => {
  const { locale } = await getPrefs();
  const dict = DICTIONARIES[locale];
  return { locale, dict, t: createT(dict), fmt: createFormatters(locale) };
});
