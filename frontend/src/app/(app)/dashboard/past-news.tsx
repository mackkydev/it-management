"use client";

import { useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { NewsReader } from "@/components/news-reader";
import { tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { NewsAnnouncement } from "@/lib/types";

const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;

/** ปุ่ม "ประกาศที่ผ่านมา" ที่หัวข้อข่าวสารหน้าภาพรวม → รายการ → กดอ่านฉบับเต็ม (ปิดกล่องอ่าน = กลับมาที่รายการ) — ไม่มีประกาศที่ผ่านไปแล้ว = ไม่แสดงปุ่ม */
export function PastNews({ items }: { items: NewsAnnouncement[] }) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<NewsAnnouncement | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="cursor-pointer whitespace-nowrap text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
        {t("dashboard.news.pastOpen")}
      </button>
      {open && !reading && (
        <ModalShell id="news-past" size="wide" title={t("dashboard.news.pastTitle")} subtitle={t("dashboard.news.pastSubtitle")} onClose={() => setOpen(false)}>
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setReading(a)} className="relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg bg-subtle py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
                  <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level]?.dot ?? tone.info.dot}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{a.title}</span>
                    {a.ends_on && <span className="mt-0.5 block text-xs text-muted">{t("dashboard.news.pastEnded", { date: fmt.date(a.ends_on) })}</span>}
                  </span>
                  <ChevronRightIcon width={16} height={16} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </ModalShell>
      )}
      {reading && <NewsReader title={reading.title} body={reading.body} cover={reading.cover_url} files={reading.files} onClose={() => setReading(null)} />}
    </>
  );
}
