"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/icons";
import { tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PublicAnnouncement } from "@/lib/types";

const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;

/** แสดงทีละ 1 แถว — มีมากกว่า 1 ประกาศจะเลื่อนขึ้นทีละแถวทุก 5 วินาที วนไปเรื่อย ๆ (ชี้เมาส์ค้าง / เปิดอ่านอยู่ = หยุด) */
const VISIBLE = 1;
const ROW_PX = 76; // ความสูงแถว 68px + ช่องว่าง 8px — แถวสูงเท่ากันทุกแถว เพื่อให้เลื่อนได้พอดี
const INTERVAL_MS = 5_000;

export function AnnouncementTicker({ items, title }: { items: PublicAnnouncement[]; title: string }) {
  const { t } = useI18n();
  const loop = items.length > VISIBLE;
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [paused, setPaused] = useState(false);
  // ประกาศที่เปิดอ่านในป๊อปอัป (ตำแหน่งในรายการ) — null = ปิด
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!loop || paused || open !== null) return;
    const timer = window.setInterval(() => {
      setAnimate(true);
      setIndex((i) => i + 1);
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loop, paused, open]);

  if (items.length === 0) return null;

  // ต่อ VISIBLE แถวแรกไว้ท้ายรายการ — เลื่อนถึงชุดที่ต่อไว้แล้วกระโดดกลับแถวแรกแบบไม่มี animation (ดูเหมือนวนต่อเนื่อง)
  const rows = loop ? [...items, ...items.slice(0, VISIBLE)] : items;
  const onTransitionEnd = () => {
    if (index >= items.length) {
      setAnimate(false);
      setIndex(0);
    }
  };

  return (
    <div>
      <p className="login-muted mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
        <BellIcon width={14} height={14} />
        {title}
      </p>
      <div className="flex items-center gap-3" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="min-w-0 flex-1 overflow-hidden" style={{ height: Math.min(items.length, VISIBLE) * ROW_PX - 8 }}>
          <ul
            onTransitionEnd={onTransitionEnd}
            className={`space-y-2 ${animate ? "transition-transform duration-700 ease-in-out motion-reduce:transition-none" : ""}`}
            style={{ transform: `translateY(-${index * ROW_PX}px)` }}
          >
            {rows.map((a, i) => {
              const hidden = i >= items.length;
              return (
                <li key={`${a.id}-${i}`} aria-hidden={hidden || undefined}>
                  {/* คลิก = เปิดอ่านประกาศเต็มในป๊อปอัป */}
                  <button
                    type="button"
                    tabIndex={hidden ? -1 : undefined}
                    onClick={() => setOpen(i % items.length)}
                    aria-haspopup="dialog"
                    className="login-chip group relative flex h-[68px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl pl-5 pr-3 text-left transition-colors login-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--scene-cyan)"
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level]?.dot ?? tone.info.dot}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.title}</span>
                      {a.body && <span className="login-muted mt-0.5 block truncate text-sm">{a.body}</span>}
                    </span>
                    <span className="login-muted flex shrink-0 items-center gap-0.5 text-xs opacity-70 transition-opacity group-hover:opacity-100">
                      {t("auth.readMore")}
                      <ChevronRightIcon width={14} height={14} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ไข่ปลาด้านขวา: จำนวนประกาศ + ตำแหน่งปัจจุบัน — คลิกเพื่อข้ามไปประกาศนั้น */}
        {loop && (
          <div className="flex shrink-0 flex-col gap-1.5" role="tablist" aria-orientation="vertical">
            {items.map((a, i) => {
              const active = index % items.length === i;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`${i + 1} / ${items.length}: ${a.title}`}
                  onClick={() => {
                    setAnimate(true);
                    setIndex(i);
                  }}
                  className={`w-1.5 cursor-pointer rounded-full transition-all duration-300 ${active ? "login-dot h-5" : "h-1.5 bg-(--scene-muted) opacity-40 hover:opacity-80"}`}
                />
              );
            })}
          </div>
        )}
      </div>

      {open !== null && items[open] && (
        <AnnouncementDialog
          items={items}
          at={open}
          onMove={(i) => {
            setOpen(i);
            // เลื่อนแถบประกาศตามที่อ่านอยู่ — ปิดแล้วเห็นประกาศเดียวกัน
            setAnimate(false);
            setIndex(i);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/**
 * ป๊อปอัปอ่านประกาศเต็ม (หัวข้อ + เนื้อหาทั้งหมด + ช่วงวันที่ประกาศ) — ก่อนหน้า/ถัดไปเมื่อมีหลายประกาศ, Esc / คลิกพื้นหลัง = ปิด
 * portal ไป body: ฉาก login มี animation transform ที่ทำให้ position: fixed ไม่ยึดหน้าจอ
 */
function AnnouncementDialog({ items, at, onMove, onClose }: { items: PublicAnnouncement[]; at: number; onMove: (i: number) => void; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const a = items[at];
  const many = items.length > 1;
  const go = (d: -1 | 1) => onMove((at + d + items.length) % items.length);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (many && e.key === "ArrowLeft") go(-1);
      if (many && e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ผูก key ใหม่เมื่อเปลี่ยนประกาศ (go ใช้ at ล่าสุด)
  }, [at]);

  const period =
    a.starts_on && a.ends_on
      ? `${fmt.date(a.starts_on)} – ${fmt.date(a.ends_on)}`
      : a.starts_on
        ? t("auth.announcementFrom", { date: fmt.date(a.starts_on) })
        : a.ends_on
          ? t("auth.announcementUntil", { date: fmt.date(a.ends_on) })
          : null;
  const level = LEVEL_TONE[a.level] ?? tone.info;

  return createPortal(
    <div className="login-modal dark fixed inset-0 z-[80] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
        className="login-modal-panel flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 login-divider border-b p-5">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${level.dot}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="announcement-title" className="text-lg font-semibold leading-snug break-words">
              {a.title}
            </h2>
            {period && <p className="login-muted mt-1 text-xs">{period}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="login-muted -mr-1 -mt-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors login-hover"
          >
            <XIcon width={18} height={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {a.body ? <p className="whitespace-pre-line break-words text-sm leading-relaxed">{a.body}</p> : <p className="login-muted text-sm">{t("auth.announcementNoBody")}</p>}
        </div>

        {many && (
          <div className="flex items-center justify-between gap-2 login-divider border-t px-5 py-3">
            <button type="button" onClick={() => go(-1)} className="login-muted flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors login-hover">
              <ChevronLeftIcon width={16} height={16} />
              {t("common.previous")}
            </button>
            <span className="login-muted text-xs tabular-nums">
              {at + 1} / {items.length}
            </span>
            <button type="button" onClick={() => go(1)} className="login-muted flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors login-hover">
              {t("common.next")}
              <ChevronRightIcon width={16} height={16} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
