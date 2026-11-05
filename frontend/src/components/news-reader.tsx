"use client";

import { FileTextIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { RichText } from "@/components/rich-text";
import { useI18n } from "@/i18n/client";
import type { NewsAnnouncement } from "@/lib/types";

/** กล่องอ่านข่าวฉบับเต็ม: รูปหน้าปก + รายละเอียด + เอกสารแนบ (หน้าภาพรวม / หน้าต่างสรุปหลัง login / แท็บผ่านไปแล้วของหน้าจัดการ — meta = ข้อมูลการแสดงท้ายกล่อง) */
export function NewsReader({ title, body, cover, files, meta, onClose }: { title: string; body: string | null; cover: string | null; files: NewsAnnouncement["files"]; meta?: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ModalShell id="news-read" size="xl" title={title} onClose={onClose}>
      <div className="space-y-4">
        {cover && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
            <img src={`/files${cover}`} alt="" className="aspect-[21/9] w-full rounded-xl object-cover" />
          </>
        )}
        {body && <RichText text={body} className="text-sm leading-relaxed text-ink" />}
        {files.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">{t("dashboard.news.documents")}</p>
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={f.id}>
                  <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
                    <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {meta && <p className="text-xs text-faint">{meta}</p>}
      </div>
    </ModalShell>
  );
}
