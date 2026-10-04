import { HEX_RE } from "@/lib/color";

/**
 * ค่าที่ผู้ใช้เลือกเอง (เก็บใน cookie เพื่อให้ server render ได้ถูกตั้งแต่แรก ไม่กระพริบ)
 * ไฟล์นี้ใช้ได้ทั้งฝั่ง server และ client
 */
export const MODES = ["light", "dark", "system"] as const;
/** ธีมสำเร็จรูป — สีสถานะของระบบจะเปลี่ยนตามธีมเพื่อไม่ให้ซ้ำกัน (ดู globals.css ส่วน "สีสถานะของระบบ") */
export const PRESET_THEMES = ["lavender", "sky", "mint", "rose", "peach"] as const;
/** "custom" = ผู้ใช้เลือกสีเอง (ค่าสีเก็บใน accent) */
export const THEMES = [...PRESET_THEMES, "custom"] as const;
export const LAYOUTS = ["sidebar", "topbar"] as const;
/** sidebar ย่อเหลือแค่ icon หรือแสดงเต็ม */
export const SIDEBAR_STATES = ["expanded", "collapsed"] as const;
export const LOCALES = ["th", "en"] as const;

export type Mode = (typeof MODES)[number];
export type PresetTheme = (typeof PRESET_THEMES)[number];
export type Theme = (typeof THEMES)[number];
export type Layout = (typeof LAYOUTS)[number];
export type SidebarState = (typeof SIDEBAR_STATES)[number];
export type Locale = (typeof LOCALES)[number];

export interface Prefs {
  mode: Mode;
  theme: Theme;
  /** สีหลักของธีมกำหนดเอง (#rrggbb) */
  accent: string;
  layout: Layout;
  sidebar: SidebarState;
  locale: Locale;
}

export const PREF_COOKIES = {
  mode: "eam_mode",
  theme: "eam_theme",
  accent: "eam_accent",
  layout: "eam_layout",
  sidebar: "eam_sidebar",
  locale: "eam_locale",
} as const satisfies Record<keyof Prefs, string>;

export const DEFAULT_PREFS: Prefs = {
  mode: "system",
  theme: "lavender",
  accent: "#8b5cf6",
  layout: "sidebar",
  sidebar: "expanded",
  locale: "th",
};

const ALLOWED: { [K in Exclude<keyof Prefs, "accent">]: readonly Prefs[K][] } = {
  mode: MODES,
  theme: THEMES,
  layout: LAYOUTS,
  sidebar: SIDEBAR_STATES,
  locale: LOCALES,
};

/** ตรวจค่าจาก cookie — ค่าที่ไม่รู้จักใช้ค่าเริ่มต้น (กันค่าแปลกปลอมถูกนำไปใส่ใน HTML/CSS) */
export function parsePref<K extends keyof Prefs>(key: K, value: string | undefined): Prefs[K] {
  if (key === "accent") {
    return (value && HEX_RE.test(value) ? value.toLowerCase() : DEFAULT_PREFS.accent) as Prefs[K];
  }
  const allowed = ALLOWED[key as Exclude<keyof Prefs, "accent">] as readonly string[];
  return allowed.includes(value ?? "") ? (value as Prefs[K]) : DEFAULT_PREFS[key];
}

/** สีตัวอย่างของแต่ละธีมสำเร็จรูป (ใช้แสดงจุดสีในตัวเลือกธีม) */
export const THEME_SWATCH: Record<PresetTheme, string> = {
  lavender: "#a5b4fc", // indigo-300
  sky: "#7dd3fc", // sky-300
  mint: "#6ee7b7", // emerald-300
  rose: "#f9a8d4", // pink-300
  peach: "#fdba74", // orange-300
};

/** สีแนะนำสำหรับธีมกำหนดเอง */
export const CUSTOM_SUGGESTIONS = ["#8b5cf6", "#14b8a6", "#e11d48", "#ca8a04", "#2563eb", "#64748b"];
