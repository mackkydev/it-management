"use client";

import { useState } from "react";
import { DocumentLink } from "@/components/document-viewer";
import { ChevronDownIcon, FileTextIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";
import { sectionChanges, type DiffPart, type SectionChange } from "@/lib/text-diff";
import type { PolicyFile, PolicySection } from "@/lib/types";

/** ไอคอนเอกสารสำหรับวางในบรรทัดเดียวกับหัวข้อ — ไม่แสดงชื่อไฟล์, กดแล้วเปิดเอกสาร (ชื่อไฟล์อยู่ที่หัวกล่องและโปรแกรมอ่านหน้าจอ) */
export function PolicyFileIcons({ files }: { files: Pick<PolicyFile, "id" | "name" | "url">[] }) {
  const { t } = useI18n();
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {files.map((f) => (
        <Tooltip key={f.id} label={t("docViewer.open")}>
          <DocumentLink href={`/files${f.url}`} name={f.name} aria-label={`${t("docViewer.open")}: ${f.name}`} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-accent-500 transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
            <FileTextIcon width={18} height={18} />
          </DocumentLink>
        </Tooltip>
      ))}
    </span>
  );
}

/** รายการไฟล์แนบของนโยบาย */
export function PolicyFiles({ files }: { files: Pick<PolicyFile, "id" | "name" | "url">[] }) {
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id}>
          <DocumentLink href={`/files${f.url}`} name={f.name} className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
            <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
          </DocumentLink>
        </li>
      ))}
    </ul>
  );
}

/** เอกสารแนบท้ายประกาศ (ต่อท้ายหัวข้อสุดท้าย) */
export function PolicyAttachments({ files }: { files: Pick<PolicyFile, "id" | "name" | "url">[] }) {
  const { t } = useI18n();
  if (!files.length) return null;
  return (
    <section className="space-y-2 rounded-xl p-3 ring-1 ring-line">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileTextIcon width={16} height={16} className="text-accent-500" />
        {t("policyPage.attachments")}
      </h3>
      <PolicyFiles files={files} />
    </section>
  );
}

/** ข้อความที่เพิ่ม/แก้จากฉบับก่อนหน้าเป็นสีแดง */
export const CHANGED_TEXT = "font-medium text-red-600 dark:text-red-400";

/** ป้าย NEW บนหัวข้อที่เปลี่ยนจากฉบับก่อนหน้า (ยังไม่ได้เปิดอ่าน) */
export function NewBadge() {
  const { t } = useI18n();
  return <span className="shrink-0 animate-pulse rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">{t("policyPage.newBadge")}</span>;
}

/** เนื้อหาหัวข้อ — ส่วนที่เพิ่ม/แก้ทำสีแดง */
export function PolicyBody({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.added ? (
          <mark key={i} className={`bg-transparent ${CHANGED_TEXT}`}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** เนื้อหานโยบายแบบอ่านอย่างเดียว: หัวข้อทั้งหมด + ไฟล์แนบท้าย (หน้า login / ดูตัวอย่าง / ฉบับก่อนหน้า) — previous = ทำสีส่วนที่เปลี่ยน */
export function PolicyContent({ sections, files, previous }: { sections: PolicySection[]; files: Pick<PolicyFile, "id" | "name" | "url">[]; previous?: PolicySection[] | null }) {
  const changes = sectionChanges(sections, previous);
  return (
    <div className="space-y-4">
      {sections.map((s, i) => (
        <section key={i}>
          <h3 className={`mb-1 flex flex-wrap items-center gap-2 font-semibold ${changes[i].titleChanged ? CHANGED_TEXT : ""}`}>
            <span>
              {i + 1}. {s.title}
            </span>
            {changes[i].status !== "same" && <NewBadge />}
          </h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
            <PolicyBody parts={changes[i].body} />
          </p>
        </section>
      ))}
      <PolicyAttachments files={files} />
    </div>
  );
}

/** หัวข้อแบบกดเปิดอ่าน (accordion) อ่านอย่างเดียว — นโยบายอื่นๆ / นโยบายที่ยอมรับแล้ว */
export function PolicySectionAccordion({ sections, changes, idPrefix }: { sections: PolicySection[]; changes?: SectionChange[]; idPrefix: string }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(sections.length === 1 ? [0] : []));
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    setSeen((s) => new Set(s).add(i));
  };
  return (
    <ol className="space-y-2">
      {sections.map((s, i) => {
        const isOpen = open.has(i);
        const change = changes?.[i];
        return (
          <li key={i} className="rounded-xl ring-1 ring-line">
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={isOpen}
              aria-controls={`${idPrefix}-${i}`}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-subtle"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">{i + 1}</span>
              <span className={`min-w-0 flex-1 text-sm font-medium ${change?.titleChanged ? CHANGED_TEXT : ""}`}>{s.title}</span>
              {change && change.status !== "same" && !seen.has(i) && <NewBadge />}
              <ChevronDownIcon width={16} height={16} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div id={`${idPrefix}-${i}`} className="border-t border-line px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                <PolicyBody parts={change?.body ?? [{ text: s.body, added: false }]} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
