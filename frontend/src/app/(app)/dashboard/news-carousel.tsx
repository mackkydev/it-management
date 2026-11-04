"use client";

import { useEffect, useState } from "react";
import { AlertIcon, BellIcon, ChevronLeftIcon, ChevronRightIcon, SparklesIcon } from "@/components/icons";
import { NewsReader } from "@/components/news-reader";
import { plainText } from "@/components/rich-text";
import { btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AnnouncementLevel, NewsAnnouncement } from "@/lib/types";

/** เวลาที่แสดงข่าวแต่ละชิ้นก่อนสลับ */
const ROTATE_MS = 6000;
/** ข่าวจริงไม่ครบเท่านี้ = เติมข่าวตัวอย่าง (มีป้าย "ตัวอย่าง") — ประกาศจริงครบแล้วข่าวตัวอย่างหายเอง */
const MIN_SLIDES = 3;

const LOOK: Record<AnnouncementLevel, { art: string; badge: string; icon: typeof BellIcon }> = {
  info: { art: "from-accent-500 to-info-400", badge: tone.info.badge, icon: BellIcon },
  warning: { art: "from-warning-400 to-accent-500", badge: tone.warning.badge, icon: SparklesIcon },
  danger: { art: "from-danger-400 to-warning-400", badge: tone.danger.badge, icon: AlertIcon },
};

interface Slide {
  id: string;
  title: string;
  body: string | null;
  level: AnnouncementLevel;
  date: string | null;
  sample: boolean;
  cover: string | null;
  files: NewsAnnouncement["files"];
}

/** กล่องข่าวสารหน้าภาพรวม — สลับเองทุก ROTATE_MS (ชี้/โฟกัสที่กล่อง = หยุด), จุด + ลูกศรเลือกเอง, กด "อ่านต่อ" = เนื้อหาเต็มใน popup; รูปหน้าปกเต็มกรอบ ไม่เพี้ยน (ส่วนเกินถูกตัด) */
export function NewsCarousel({ items }: { items: NewsAnnouncement[] }) {
  const { t, fmt } = useI18n();
  const real: Slide[] = items.map((a) => ({ id: String(a.id), title: a.title, body: a.body, level: a.level, date: a.starts_on, sample: false, cover: a.cover_url, files: a.files }));
  const samples: Slide[] = (["info", "warning", "danger"] as const).map((level, i) => {
    const n = (i + 1) as 1 | 2 | 3;
    return { id: `sample-${n}`, title: t(`dashboard.news.sample${n}Title`), body: t(`dashboard.news.sample${n}Body`), level, date: null, sample: true, cover: null, files: [] };
  });
  const slides = [...real, ...samples].slice(0, Math.max(MIN_SLIDES, real.length));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reading, setReading] = useState<Slide | null>(null);
  const current = index % slides.length;

  useEffect(() => {
    if (paused || reading || slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [paused, reading, slides.length]);

  const step = (by: number) => setIndex((current + by + slides.length) % slides.length);

  return (
    <section
      aria-label={t("dashboard.news.title")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`relative flex min-h-[30rem] flex-1 flex-col overflow-hidden ${card}`}
    >
      {slides.map((s, i) => {
        const look = LOOK[s.level] ?? LOOK.info;
        const Icon = look.icon;
        return (
          <article key={s.id} aria-hidden={i !== current} className={`absolute inset-0 flex flex-col transition-opacity duration-700 ${i === current ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            {s.cover ? (
              <div className="relative min-h-40 flex-1 overflow-hidden bg-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
                <img src={`/files${s.cover}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
              </div>
            ) : (
              /* ไม่มีรูปหน้าปก = ภาพประกอบตามระดับข่าว */
              <div className={`relative min-h-40 flex-1 overflow-hidden bg-gradient-to-br ${look.art}`} aria-hidden="true">
                <span className="absolute -right-12 -top-16 h-64 w-64 rounded-full bg-white/15" />
                <span className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10" />
                <span className="absolute bottom-8 right-1/4 h-20 w-20 rounded-full bg-white/10" />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid h-24 w-24 place-items-center rounded-3xl bg-white/20 text-white shadow-lg ring-1 ring-white/30 backdrop-blur-sm">
                    <Icon width={44} height={44} />
                  </span>
                </span>
              </div>
            )}
            {/* ข้อความ */}
            <div className="space-y-2 p-5 pb-14">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-0.5 font-medium ${look.badge}`}>{t(`dashboard.news.level.${s.level}`)}</span>
                {s.sample && <span className={`rounded-full px-2.5 py-0.5 font-medium ${tone.idle.badge}`}>{t("dashboard.news.sample")}</span>}
                {s.date && <span className="text-muted">{fmt.date(s.date)}</span>}
              </div>
              <h3 className="line-clamp-2 text-lg font-semibold">{s.title}</h3>
              {s.body && <p className="line-clamp-2 whitespace-pre-line text-sm text-muted">{plainText(s.body)}</p>}
              {(s.body || s.files.length > 0) && (
                <button type="button" tabIndex={i === current ? 0 : -1} onClick={() => setReading(s)} className="cursor-pointer text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
                  {t("dashboard.news.readMore")}
                </button>
              )}
            </div>
          </article>
        );
      })}

      {/* ตัวควบคุม: จุดบอกตำแหน่ง + ลูกศร */}
      <div className="absolute inset-x-5 bottom-4 z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t("dashboard.news.goTo", { n: i + 1 })}
              aria-current={i === current}
              className={`h-2 cursor-pointer rounded-full transition-all ${i === current ? "w-6 bg-accent-500" : "w-2 bg-line hover:bg-faint"}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label={t("dashboard.news.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={14} height={14} />
          </button>
          <button type="button" onClick={() => step(1)} aria-label={t("dashboard.news.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={14} height={14} />
          </button>
        </div>
      </div>

      {reading && (
        <NewsReader title={reading.title} body={reading.body} cover={reading.cover} files={reading.files} onClose={() => setReading(null)} />
      )}
    </section>
  );
}
