"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DownloadIcon, FileTextIcon, XIcon } from "@/components/icons";
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

/** กล่องดูเอกสารเต็มจอ — Esc / คลิกนอกกล่อง = ปิด เฉพาะกล่องนี้ แม้เปิดซ้อนบน popup อื่น */
export function DocumentViewer({ href, title, name, kind = "file", onClose }: { href: string; title: string; name?: string; kind?: DocumentKind; onClose: () => void }) {
  const { t } = useI18n();
  const view = viewOf(kind, name);
  const download = `${href}${href.includes("?") ? "&" : "?"}download=1`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-2 backdrop-blur-sm sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate font-semibold">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {kind !== "page" && (
              <a href={download} download className={`${btn.secondary} ${btn.sm}`}>
                <DownloadIcon width={14} height={14} />
                {t("docViewer.download")}
              </a>
            )}
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink">
              <XIcon width={18} height={18} />
            </button>
          </div>
        </div>
        {view === "frame" && <iframe src={href} title={title} className="min-h-0 w-full flex-1 bg-white" />}
        {view === "image" && (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-subtle p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
            <img src={href} alt={title} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {view === "none" && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <FileTextIcon width={40} height={40} className="text-faint" />
            <p className="text-sm text-muted">{t("docViewer.noPreview")}</p>
            <a href={download} download className={btn.primary}>
              <DownloadIcon />
              {t("docViewer.download")}
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
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
