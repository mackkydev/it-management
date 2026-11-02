"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { acceptPolicy } from "@/app/actions/policy";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, ChevronDownIcon, LogoutIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { PolicySection } from "@/lib/types";

/**
 * หัวข้อนโยบายแบบกดเปิดอ่าน (accordion) ในกล่องเลื่อน — ติ๊กยอมรับได้เมื่อเปิดอ่านครบทุกหัวข้อ และเลื่อนลงจนสุดกล่อง
 * accepted = ยอมรับแล้ว (อ่านอย่างเดียว ไม่มีช่องยอมรับ)
 */
export function PolicyAcceptForm({ sections, version, accepted }: { sections: PolicySection[]; version: number; accepted: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Set<number>>(() => new Set(sections.length === 1 ? [0] : []));
  const [read, setRead] = useState<Set<number>>(() => new Set(sections.length === 1 ? [0] : []));
  const [atEnd, setAtEnd] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // เปิดอ่านครบแล้วหรือยัง — ใช้ใน callback ของ observer (ตั้งตอนกดเปิดหัวข้อ)
  const allReadRef = useRef(sections.length === 1);

  // ปลายกล่องเลื่อนอยู่ในจอหรือยัง (เนื้อหาสั้น = เห็นทันที)
  useEffect(() => {
    const box = boxRef.current;
    const end = endRef.current;
    if (!box || !end) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setAtEnd(e.isIntersecting);
        // เลื่อนถึงท้ายหลังจากเปิดอ่านครบแล้ว (จำไว้ — เลื่อนกลับขึ้นไปทวนได้)
        if (e.isIntersecting && allReadRef.current) setReachedEnd(true);
      },
      { root: box, threshold: 1 },
    );
    io.observe(end);
    return () => io.disconnect();
  }, []);

  const allRead = read.size === sections.length;
  // ติ๊กได้เมื่อเปิดอ่านครบ และเลื่อนถึงท้ายกล่อง (เนื้อหาสั้น = ท้ายกล่องอยู่ในจออยู่แล้ว)
  const canTick = allRead && (reachedEnd || atEnd);

  const toggle = (i: number) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    const nextRead = read.has(i) ? read : new Set(read).add(i);
    allReadRef.current = nextRead.size === sections.length;
    setRead(nextRead);
  };

  const submit = () =>
    start(async () => {
      const res = await acceptPolicy(version);
      if (res && !res.ok) setMessage(res.message ?? Object.values(res.errors ?? {})[0] ?? "");
    });

  const decline = async () => {
    if (!(await confirm(t("policyAccept.declineConfirm")))) return;
    await logout();
  };

  return (
    <div className="space-y-4">
      <div ref={boxRef} className={`max-h-[60vh] overflow-y-auto p-2 sm:p-3 ${card}`}>
        <ol className="space-y-2">
          {sections.map((s, i) => {
            const isOpen = open.has(i);
            return (
              <li key={i} className="rounded-xl ring-1 ring-line">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  aria-controls={`policy-section-${i}`}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-subtle"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-medium">{s.title}</span>
                  {read.has(i) && !accepted && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-success-700 dark:text-success-300">
                      <CheckCircleIcon width={14} height={14} />
                      {t("policyAccept.read")}
                    </span>
                  )}
                  <ChevronDownIcon width={16} height={16} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div id={`policy-section-${i}`} className="border-t border-line px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {s.body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div ref={endRef} className="h-1" aria-hidden="true" />
      </div>

      {!accepted && (
        <>
          <p className="text-xs text-muted">
            {t("policyAccept.readHint", { read: read.size, total: sections.length })}
            {!canTick && ` · ${t(allRead ? "policyAccept.scrollHint" : "policyAccept.openAllFirst")}`}
          </p>
          <label className={`flex items-start gap-2 text-sm ${canTick ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
            <input
              type="checkbox"
              checked={checked}
              disabled={!canTick || pending}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)] disabled:cursor-not-allowed"
            />
            {t("policyAccept.checkbox")}
          </label>
          {message && (
            <p role="alert" className={alert.error}>
              <AlertIcon className="shrink-0" />
              {message}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={decline} disabled={pending} className={btn.secondary}>
              <LogoutIcon width={16} height={16} />
              {t("policyAccept.decline")}
            </button>
            <button type="button" onClick={submit} disabled={!checked || pending} className={btn.primary}>
              {pending ? <SpinnerIcon width={16} height={16} /> : <CheckCircleIcon width={16} height={16} />}
              {t("policyAccept.accept")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
