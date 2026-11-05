"use client";

import { useRef, useState, type ReactNode } from "react";
import { ExternalLinkIcon } from "@/components/icons";
import { RichText } from "@/components/rich-text";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";

const TOOL = "flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function Tool({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={TOOL}>
        {children}
      </button>
    </Tooltip>
  );
}

/** กล่องข้อความพร้อมแถบเครื่องมือจัดรูปแบบ + ดูตัวอย่าง — รูปแบบที่บันทึกดู components/rich-text.tsx */
export function RichTextEditor({ id, value, onChange, maxLength, rows = 8, className }: { id: string; value: string; onChange: (value: string) => void; maxLength: number; rows?: number; className: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  /** เปลี่ยนข้อความแล้วเลือกช่วงใหม่ (รอ React อัปเดตค่าในกล่องก่อน) */
  const apply = (next: string, from: number, to: number) => {
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(from, to);
    });
  };

  /** ครอบข้อความที่เลือก — ไม่ได้เลือก = ใส่ข้อความตัวอย่างให้พิมพ์ทับ */
  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const inner = value.slice(s, e) || t("richText.sample");
    apply(value.slice(0, s) + mark + inner + mark + value.slice(e), s + mark.length, s + mark.length + inner.length);
  };

  /** ใส่/เอาออก เครื่องหมายต้นบรรทัดของทุกบรรทัดที่เลือก */
  const prefix = (make: (index: number) => string, pattern: RegExp) => {
    const el = ref.current;
    if (!el) return;
    const start = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", el.selectionEnd);
    const end = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(start, end).split("\n");
    const off = lines.every((l) => pattern.test(l));
    const replaced = lines.map((l, i) => (off ? l.replace(pattern, "") : make(i) + l.replace(/^(## |- |\d+\. )/, ""))).join("\n");
    apply(value.slice(0, start) + replaced + value.slice(end), start, start + replaced.length);
  };

  /** ลิงก์: ข้อความที่เลือก = ชื่อลิงก์ แล้วเลือกช่อง URL ให้วางทับ */
  const link = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const label = value.slice(s, e) || t("richText.linkLabel");
    const url = "https://";
    const urlAt = s + label.length + 3;
    apply(`${value.slice(0, s)}[${label}](${url})${value.slice(e)}`, urlAt, urlAt + url.length);
  };

  return (
    <div>
      <div role="toolbar" aria-label={t("richText.toolbar")} className="mb-1 flex flex-wrap items-center gap-0.5 rounded-xl bg-subtle/60 p-1 ring-1 ring-line">
        <Tool label={t("richText.bold")} disabled={preview} onClick={() => wrap("**")}>
          <b>B</b>
        </Tool>
        <Tool label={t("richText.italic")} disabled={preview} onClick={() => wrap("*")}>
          <i className="font-serif">I</i>
        </Tool>
        <Tool label={t("richText.underline")} disabled={preview} onClick={() => wrap("__")}>
          <u>U</u>
        </Tool>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <Tool label={t("richText.heading")} disabled={preview} onClick={() => prefix(() => "## ", /^## /)}>
          <b>H</b>
        </Tool>
        <Tool label={t("richText.bullet")} disabled={preview} onClick={() => prefix(() => "- ", /^- /)}>
          <span aria-hidden="true">•≡</span>
        </Tool>
        <Tool label={t("richText.number")} disabled={preview} onClick={() => prefix((i) => `${i + 1}. `, /^\d+\. /)}>
          <span aria-hidden="true">1.</span>
        </Tool>
        <Tool label={t("richText.link")} disabled={preview} onClick={link}>
          <ExternalLinkIcon width={14} height={14} />
        </Tool>
        <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className={`ml-auto cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${preview ? "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-200" : "text-muted hover:bg-subtle hover:text-ink"}`}>
          {t(preview ? "richText.edit" : "richText.preview")}
        </button>
      </div>
      {preview ? (
        <div className="min-h-32 rounded-xl p-3 text-sm ring-1 ring-line">{value.trim() ? <RichText text={value} /> : <p className="text-muted">{t("richText.empty")}</p>}</div>
      ) : (
        <textarea id={id} ref={ref} rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} className={className} />
      )}
    </div>
  );
}
