/**
 * สรุป User-Agent ที่บันทึกไว้เป็นข้อความอ่านง่าย เช่น "Windows · Chrome · คอมพิวเตอร์"
 * เบราว์เซอร์ไม่ส่งชื่อเครื่อง / MAC address / ชื่อผู้ใช้ Windows — บอกได้แค่ระบบปฏิบัติการ เบราว์เซอร์ ประเภทอุปกรณ์
 * ลงท้าย " [pwa]" = เปิดจากแอปที่ติดตั้ง (หน้าเว็บใส่ให้จาก cookie eam_pwa — lib/api.ts)
 */
export const PWA_MARK = " [pwa]";

export interface AgentInfo {
  os: string | null;
  browser: string | null;
  device: "desktop" | "mobile" | "tablet" | null;
  pwa: boolean;
}

export function parseAgent(raw: string | null | undefined): AgentInfo | null {
  if (!raw) return null;
  const pwa = raw.endsWith(PWA_MARK);
  const ua = pwa ? raw.slice(0, -PWA_MARK.length) : raw;
  // iPadOS 13+ รายงานตัวเองเป็น Mac — จากฝั่งเซิร์ฟเวอร์แยกไม่ได้ จึงนับเป็น macOS
  const os = /Windows NT/.test(ua)
    ? "Windows"
    : /iPhone|iPod/.test(ua)
      ? "iOS"
      : /iPad/.test(ua)
        ? "iPadOS"
        : /Android/.test(ua)
          ? "Android"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/.test(ua)
              ? "macOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Line\//.test(ua)
          ? "LINE"
          : /FBAN|FBAV/.test(ua)
            ? "Facebook"
            : /FxiOS|Firefox\//.test(ua)
              ? "Firefox"
              : /CriOS|Chrome\//.test(ua)
                ? "Chrome"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : null;
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? "tablet"
    : /Mobi|iPhone|iPod/.test(ua)
      ? "mobile"
      : os
        ? "desktop"
        : null;
  return { os, browser, device, pwa };
}

type Translate = (key: "agent.desktop" | "agent.mobile" | "agent.tablet" | "agent.pwa" | "agent.other") => string;

/** "Windows · Chrome · คอมพิวเตอร์ · แอปที่ติดตั้ง" — อ่านไม่ออก = "อื่นๆ", ไม่มีข้อมูล = null */
export function describeAgent(raw: string | null | undefined, t: Translate): string | null {
  const info = parseAgent(raw);
  if (!info) return null;
  const parts = [info.os, info.browser, info.device ? t(`agent.${info.device}`) : null, info.pwa ? t("agent.pwa") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("agent.other");
}
