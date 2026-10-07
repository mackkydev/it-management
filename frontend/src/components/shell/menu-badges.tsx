"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMenuBadges } from "@/app/actions/tickets";
import { DATA_CHANGED_EVENT } from "@/components/live-refresh";
import { useI18n } from "@/i18n/client";

const POLL_MS = 60_000;
const BadgeContext = createContext<Record<string, number>>({});

/**
 * ตัวเลขงานที่รอผู้ใช้ทำบนเมนู (GET /menu-badges) — โหลดครั้งเดียวใช้ร่วมกันทุกรูปแบบเมนู
 * โหลดใหม่ทุก 60 วินาที, เมื่อกลับมาที่แท็บ, เมื่อเปลี่ยนหน้า และเมื่อข้อมูลในระบบเปลี่ยน (LiveRefresh) เหมือนกระดิ่งแจ้งเตือน
 */
export function MenuBadgesProvider({ children }: { children: ReactNode }) {
  const [badges, setBadges] = useState<Record<string, number>>({});
  const pathname = usePathname();
  const load = useCallback(() => void fetchMenuBadges().then(setBadges), []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(DATA_CHANGED_EVENT, load);
    };
  }, [load]);

  // ทำงานเสร็จแล้วเปลี่ยนหน้า (เช่น รับงาน / อนุมัติ) → ตัวเลขอัปเดตทันที
  useEffect(load, [pathname, load]);

  return <BadgeContext.Provider value={badges}>{children}</BadgeContext.Provider>;
}

export const useMenuBadge = (href: string) => useContext(BadgeContext)[href] ?? 0;
export const useMenuBadgeTotal = (hrefs: string[]) => {
  const all = useContext(BadgeContext);
  return hrefs.reduce((sum, h) => sum + (all[h] ?? 0), 0);
};

/** ป้ายตัวเลข (0 = ไม่แสดง, เกิน 99 = 99+) — dot = จุดเล็กมุมไอคอน (เมนูแบบย่อ) */
export function MenuBadge({ count, dot = false, className = "" }: { count: number; dot?: boolean; className?: string }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={t("nav.badge", { count: text })}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-danger-500 font-semibold leading-none text-white tabular-nums ${
        dot ? "absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px] ring-2 ring-surface" : "h-5 min-w-5 px-1.5 text-[11px]"
      } ${className}`}
    >
      {text}
    </span>
  );
}

/** ป้ายของเมนู 1 รายการ */
export function ItemBadge({ href, dot, className }: { href: string; dot?: boolean; className?: string }) {
  return <MenuBadge count={useMenuBadge(href)} dot={dot} className={className} />;
}

/** ป้ายรวมของกลุ่มเมนู (แสดงเมื่อกลุ่มย่ออยู่ ให้รู้ว่ามีงานรอข้างใน) */
export function GroupBadge({ hrefs, className }: { hrefs: string[]; className?: string }) {
  return <MenuBadge count={useMenuBadgeTotal(hrefs)} className={className} />;
}
