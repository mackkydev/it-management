/**
 * เทียบข้อความนโยบายฉบับเก่า → ฉบับใหม่ เพื่อทำสีส่วนที่เพิ่ม/แก้ (ส่วนที่ถูกลบไม่แสดง)
 * เทียบทีละบรรทัดก่อน แล้วเทียบทีละคำเฉพาะช่วงบรรทัดที่เปลี่ยน — ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงตัดคำด้วย Intl.Segmenter
 */
import type { PolicySection } from "@/lib/types";

export interface DiffPart {
  text: string;
  added: boolean;
}

/** ตาราง LCS ใหญ่เกินนี้ = ถือว่าทั้งช่วงเป็นข้อความใหม่ (กันหน้าค้างเมื่อเนื้อหายาวมาก) */
const MAX_CELLS = 1_500_000;

/** ลำดับการเปลี่ยนแปลงจาก a → b: "=" เหมือนกัน, "-" ลบจาก a, "+" เพิ่มใน b (null = ใหญ่เกิน) */
function diffOps(a: string[], b: string[]): ("=" | "-" | "+")[] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops: ("=" | "-" | "+")[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push("=");
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push("-");
      i++;
    } else {
      ops.push("+");
      j++;
    }
  }
  while (i++ < n) ops.push("-");
  while (j++ < m) ops.push("+");
  return ops;
}

let segmenter: Intl.Segmenter | null | undefined;
function words(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("th", { granularity: "word" }) : null;
  if (!segmenter) return text.split(/(\s+)/).filter(Boolean);
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function push(out: DiffPart[], text: string, added: boolean) {
  if (!text) return;
  // ช่องว่างล้วนไม่ต้องทำสี
  const flag = added && /\S/.test(text);
  const last = out.at(-1);
  if (last && last.added === flag) last.text += text;
  else out.push({ text, added: flag });
}

/** เทียบทีละคำ: คำที่ไม่มีในข้อความเดิม = added */
function wordDiff(before: string, after: string, out: DiffPart[]) {
  const a = words(before);
  const b = words(after);
  const ops = diffOps(a, b);
  if (!ops) return push(out, after, true);
  let j = 0;
  for (const op of ops) {
    if (op === "-") continue;
    push(out, b[j], op === "+");
    j++;
  }
}

/** แบ่งบรรทัดโดยเก็บตัวขึ้นบรรทัดไว้กับบรรทัดนั้น (ต่อกลับได้ตรงเดิม) */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+/g) ?? [];

/** ข้อความใหม่แบ่งเป็นส่วน: added = ส่วนที่เพิ่ม/แก้จากข้อความเดิม */
export function diffAdded(before: string, after: string): DiffPart[] {
  if (before === after) return [{ text: after, added: false }];
  if (!before.trim()) return [{ text: after, added: true }];
  const a = lines(before);
  const b = lines(after);
  const key = (l: string) => l.replace(/\n$/, "");
  const ops = diffOps(a.map(key), b.map(key));
  const out: DiffPart[] = [];
  if (!ops) {
    wordDiff(before, after, out);
    return out;
  }
  let i = 0;
  let j = 0;
  let removed = "";
  let added = "";
  const flush = () => {
    if (added) {
      if (removed) wordDiff(removed, added, out);
      else push(out, added, true);
    }
    removed = "";
    added = "";
  };
  for (const op of ops) {
    if (op === "=") {
      flush();
      push(out, b[j], false);
      i++;
      j++;
    } else if (op === "-") {
      removed += a[i++];
    } else {
      added += b[j++];
    }
  }
  flush();
  return out;
}

export interface SectionChange {
  /** same = ไม่เปลี่ยน, changed = แก้ไข, new = หัวข้อใหม่ */
  status: "same" | "changed" | "new";
  /** ชื่อหัวข้อเปลี่ยน (เนื้อหาเดิม) */
  titleChanged: boolean;
  body: DiffPart[];
}

/** เทียบแต่ละหัวข้อกับฉบับก่อนหน้า: จับคู่ด้วยชื่อหัวข้อ → ไม่เจอ = จับคู่ด้วยเนื้อหาที่เหมือนกัน (เปลี่ยนชื่อ) → ไม่เจอ = หัวข้อใหม่ */
export function sectionChanges(sections: PolicySection[], previous: PolicySection[] | null | undefined): SectionChange[] {
  if (!previous) return sections.map((s) => ({ status: "same", titleChanged: false, body: [{ text: s.body, added: false }] }));
  const norm = (v: string) => v.trim();
  return sections.map((s) => {
    const byTitle = previous.find((p) => norm(p.title) === norm(s.title));
    if (byTitle) {
      const same = norm(byTitle.body) === norm(s.body);
      return { status: same ? "same" : "changed", titleChanged: false, body: same ? [{ text: s.body, added: false }] : diffAdded(byTitle.body, s.body) };
    }
    if (previous.some((p) => norm(p.body) === norm(s.body))) return { status: "changed", titleChanged: true, body: [{ text: s.body, added: false }] };
    return { status: "new", titleChanged: true, body: [{ text: s.body, added: true }] };
  });
}
