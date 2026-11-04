import { Fragment, type ReactNode } from "react";

/**
 * ข้อความจัดรูปแบบของประกาศ — เก็บเป็นข้อความล้วนที่มีเครื่องหมาย แล้วแปลงเป็น React element ตอนแสดง (ไม่ใช้ HTML จึงฝังสคริปต์ไม่ได้)
 *   **หนา**  *เอียง*  __ขีดเส้นใต้__  [ข้อความ](https://...)  https://... (ลิงก์อัตโนมัติ — http/https เท่านั้น)
 *   ต้นบรรทัด: "## " หัวข้อ, "- " รายการ, "1. " รายการลำดับเลข
 * ข้อความเดิมที่ไม่มีเครื่องหมายแสดงเหมือนเดิม — ตัวช่วยพิมพ์อยู่ที่ rich-text-editor.tsx
 */
const INLINE = /\*\*(\S(?:.*?\S)?)\*\*|__(\S(?:.*?\S)?)__|\*(\S(?:.*?\S)?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
const LINK = "cursor-pointer break-all text-accent-700 underline hover:no-underline dark:text-accent-300";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1]) out.push(<strong key={key}>{inline(m[1])}</strong>);
    else if (m[2]) out.push(<u key={key}>{inline(m[2])}</u>);
    else if (m[3]) out.push(<em key={key}>{inline(m[3])}</em>);
    else {
      const href = m[5] ?? m[6];
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className={LINK}>
          {m[4] ?? href}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "heading"; text: string } | { kind: "text"; text: string } | { kind: "blank"; text: string } | { kind: "bullet"; items: string[] } | { kind: "number"; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split(/\r?\n/)) {
    const prev = out[out.length - 1];
    const bullet = /^- (.*)$/.exec(line);
    const number = /^\d+\. (.*)$/.exec(line);
    if (bullet) {
      if (prev?.kind === "bullet") prev.items.push(bullet[1]);
      else out.push({ kind: "bullet", items: [bullet[1]] });
    } else if (number) {
      if (prev?.kind === "number") prev.items.push(number[1]);
      else out.push({ kind: "number", items: [number[1]] });
    } else if (line.startsWith("## ")) out.push({ kind: "heading", text: line.slice(3) });
    else if (!line.trim()) out.push({ kind: "blank", text: "" });
    else out.push({ kind: "text", text: line });
  }
  return out;
}

/** แสดงข้อความจัดรูปแบบ */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`break-words ${className}`}>
      {blocks(text).map((b, i) => {
        if (b.kind === "heading") return <p key={i} className="mb-1 mt-2 text-base font-semibold text-ink first:mt-0">{inline(b.text)}</p>;
        if (b.kind === "blank") return <div key={i} className="h-3" aria-hidden="true" />;
        if (b.kind === "text") return <p key={i}>{inline(b.text)}</p>;
        const List = b.kind === "bullet" ? "ul" : "ol";
        return (
          <List key={i} className={`pl-5 ${b.kind === "bullet" ? "list-disc" : "list-decimal"}`}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Fragment>{inline(item)}</Fragment>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** ตัดเครื่องหมายออก สำหรับข้อความย่อ (เช่น การ์ดข่าว) */
export const plainText = (text: string) =>
  text
    .replace(/^(## |- |\d+\. )/gm, "")
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, "$1")
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "$1")
    .replace(/__(\S(?:.*?\S)?)__/g, "$1")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1");
