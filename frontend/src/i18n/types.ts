import type th from "./th";
import type { Locale } from "@/lib/prefs";

/** โครงสร้างข้อความ — ใช้ภาษาไทยเป็นต้นแบบ แต่ค่าเป็น string ทั่วไป (ภาษาอื่นต้องมี key ครบ) */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dictionary = Widen<typeof th>;

/** key แบบจุด เช่น "assets.form.tag" — ตรวจสอบตอน compile ว่ามีอยู่จริง */
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Paths<Dictionary>;

export type Vars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

const INTL_LOCALE: Record<Locale, string> = { th: "th-TH", en: "en-US" };

export function createT(dict: Dictionary): TFunction {
  return (key, vars) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
    const text = typeof value === "string" ? value : key;
    return vars ? text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : text;
  };
}

/** ตัวจัดรูปแบบตัวเลข/วันที่ตามภาษา (th ใช้ปี พ.ศ.) */
export function createFormatters(locale: Locale) {
  const intl = INTL_LOCALE[locale];
  const money = new Intl.NumberFormat(intl, { style: "currency", currency: "THB" });
  const number = new Intl.NumberFormat(intl);
  const date = new Intl.DateTimeFormat(intl, { dateStyle: "medium" });
  const dateTime = new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" });
  return {
    money: (v: string | number) => money.format(Number(v)),
    number: (v: number) => number.format(v),
    date: (iso: string) => date.format(new Date(iso)),
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
  };
}

export type Formatters = ReturnType<typeof createFormatters>;
