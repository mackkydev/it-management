"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { DocumentModal, DocumentToolbar } from "@/components/document-template";
import { DownloadIcon, FileTextIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** file = ไฟล์แนบ (เลือกวิธีแสดงจากชื่อ/ชนิดไฟล์, มีปุ่มดาวน์โหลด) / image = รูป / page = หน้าเอกสาร A4 ในระบบ (มีปุ่มพิมพ์ในหน้า) */
export type DocumentKind = "file" | "image" | "page";

const IMAGE = /\.(jpe?g|png|gif|webp)$/i;
const FRAME = /\.(pdf|txt)$/i;

/** แสดงอย่างไร: รูป / ฝังใน iframe / เปิดในระบบไม่ได้ (Word, Excel, ZIP — API ส่งเป็นไฟล์ดาวน์โหลด) */
function viewOf(kind: DocumentKind, name?: string): "image" | "frame" | "none" {
  if (kind === "image" || (name && IMAGE.test(name))) return "image";
  if (kind === "page") return "frame";
  // Chrome บน Android แสดง PDF ใน iframe ไม่ได้ (จอว่าง) — ให้ดาวน์โหลดแทน
  if (name && /\.pdf$/i.test(name) && /Android/i.test(navigator.userAgent)) return "none";
  return name && FRAME.test(name) ? "frame" : "none";
}

/** ดูเอกสารในเทมเพลตกลาง (components/document-template.tsx) */
export function DocumentViewer({ href, title, name, kind = "file", onClose }: { href: string; title: string; name?: string; kind?: DocumentKind; onClose: () => void }) {
  const { t } = useI18n();
  const view = viewOf(kind, name);
  const download = `${href}${href.includes("?") ? "&" : "?"}download=1`;

  return (
    <DocumentModal title={title} onClose={onClose}>
      {/* หน้าพิมพ์มีแถวเครื่องมือในตัว / ไฟล์ที่เปิดไม่ได้มีปุ่มดาวน์โหลดกลางกล่องแล้ว */}
      {kind !== "page" && view !== "none" && (
        <div className="shrink-0 bg-canvas pt-4">
          <DocumentToolbar hint={t("docViewer.downloadHint")}>
            <a href={download} download className={btn.primary}>
              <DownloadIcon />
              {t("docViewer.download")}
            </a>
          </DocumentToolbar>
        </div>
      )}
      {view === "frame" && <iframe src={href} title={title} className="min-h-0 w-full flex-1 bg-canvas" />}
      {view === "image" && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
          <img src={href} alt={title} className="max-h-full max-w-full object-contain shadow" />
        </div>
      )}
      {view === "none" && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
          <FileTextIcon width={40} height={40} className="text-faint" />
          <p className="text-sm text-muted">{t("docViewer.noPreview")}</p>
          <a href={download} download className={btn.primary}>
            <DownloadIcon />
            {t("docViewer.download")}
          </a>
        </div>
      )}
    </DocumentModal>
  );
}

/**
 * ลิงก์เปิดเอกสาร — เปิดใน modal เสมอ ไม่เปิด tab ใหม่ (PWA ไม่มีแถบ tab จึงกลับไม่ได้) ดูกฎใน CLAUDE.md
 * name = ชื่อไฟล์ ใช้เลือกวิธีแสดงและเป็นหัวกล่อง, title = หัวกล่องเมื่อไม่มีชื่อไฟล์
 */
export function DocumentLink({
  href,
  name,
  title,
  kind = "file",
  className,
  children,
  "aria-label": ariaLabel,
}: {
  href: string;
  name?: string;
  title?: string;
  kind?: DocumentKind;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/Shift + คลิก = ให้เบราว์เซอร์จัดการตามปกติ
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    setOpen(true);
  };
  return (
    <>
      <a href={href} onClick={onClick} aria-haspopup="dialog" aria-label={ariaLabel} className={className}>
        {children}
      </a>
      {open && <DocumentViewer href={href} name={name} kind={kind} title={title ?? name ?? t("docViewer.title")} onClose={() => setOpen(false)} />}
    </>
  );
}
