import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { parsePref, PREF_COOKIES, type Prefs } from "@/lib/prefs";

/** อ่านค่าที่ผู้ใช้เลือกจาก cookie (cache ต่อ request) */
export const getPrefs = cache(async (): Promise<Prefs> => {
  const jar = await cookies();
  return {
    mode: parsePref("mode", jar.get(PREF_COOKIES.mode)?.value),
    theme: parsePref("theme", jar.get(PREF_COOKIES.theme)?.value),
    accent: parsePref("accent", jar.get(PREF_COOKIES.accent)?.value),
    layout: parsePref("layout", jar.get(PREF_COOKIES.layout)?.value),
    sidebar: parsePref("sidebar", jar.get(PREF_COOKIES.sidebar)?.value),
    locale: parsePref("locale", jar.get(PREF_COOKIES.locale)?.value),
  };
});
