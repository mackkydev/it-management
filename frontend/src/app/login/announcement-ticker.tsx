"use client";

import { useEffect, useState } from "react";
import { BellIcon } from "@/components/icons";
import { tone } from "@/components/ui";
import type { PublicAnnouncement } from "@/lib/types";

const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;

/** แสดงพร้อมกันสูงสุด 2 แถว — มากกว่านั้นเลื่อนขึ้นทีละแถวทุก 5 วินาที วนไปเรื่อย ๆ (ชี้เมาส์ค้าง = หยุด) */
const VISIBLE = 2;
const ROW_PX = 76; // ความสูงแถว 68px + ช่องว่าง 8px — แถวสูงเท่ากันทุกแถว เพื่อให้เลื่อนได้พอดี
const INTERVAL_MS = 5_000;

export function AnnouncementTicker({ items, title }: { items: PublicAnnouncement[]; title: string }) {
  const loop = items.length > VISIBLE;
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!loop || paused) return;
    const timer = window.setInterval(() => {
      setAnimate(true);
      setIndex((i) => i + 1);
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loop, paused]);

  if (items.length === 0) return null;

  // ต่อ 2 แถวแรกไว้ท้ายรายการ — เลื่อนถึงชุดที่ต่อไว้แล้วกระโดดกลับแถวแรกแบบไม่มี animation (ดูเหมือนวนต่อเนื่อง)
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
          {rows.map((a, i) => (
            <li
              key={`${a.id}-${i}`}
              aria-hidden={i >= items.length || undefined}
              title={a.body ? `${a.title}\n${a.body}` : a.title}
              className="login-chip relative flex h-[68px] flex-col justify-center overflow-hidden rounded-xl pl-5 pr-4"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level]?.dot ?? tone.info.dot}`} aria-hidden="true" />
              <p className="truncate font-medium">{a.title}</p>
              {a.body && <p className="login-muted mt-0.5 truncate text-sm">{a.body}</p>}
            </li>
          ))}
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
                aria-label={`${i + 1} / ${items.length}`}
                title={a.title}
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
    </div>
  );
}
