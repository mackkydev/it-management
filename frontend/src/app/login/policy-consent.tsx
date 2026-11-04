"use client";

import { useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { useI18n } from "@/i18n/client";
import { FileTextIcon } from "@/components/icons";
import type { PolicyFile, PolicySection } from "@/lib/types";

export interface LoginPolicy {
  version: number;
  sections: PolicySection[];
  files: PolicyFile[];
}

/** ช่องติ๊กยอมรับนโยบายในหน้า login (ตั้งแสดงที่หน้า login) — ส่ง policy_version ไปกับฟอร์ม ติ๊กแล้วจึงกดเข้าสู่ระบบได้ */
export function PolicyConsent({ policy, checked, onChange }: { policy: LoginPolicy; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const [reading, setReading] = useState(false);
  return (
    <div>
      {checked && <input type="hidden" name="policy_version" value={policy.version} />}
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
        <span>
          {t("login_policy.agree")}{" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setReading(true);
            }}
            className="cursor-pointer font-medium text-accent-300 underline hover:no-underline"
          >
            {t("login_policy.read")}
          </button>
        </span>
      </label>
      {reading && (
        <ModalShell id="login-policy" size="wide" title={t("login_policy.title")} onClose={() => setReading(false)}>
          <div className="space-y-4">
            {policy.sections.map((s, i) => (
              <section key={i}>
                <h3 className="mb-1 font-semibold">
                  {i + 1}. {s.title}
                </h3>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{s.body}</p>
              </section>
            ))}
            {policy.files.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold">{t("login_policy.files")}</h3>
                <ul className="space-y-1.5">
                  {policy.files.map((f) => (
                    <li key={f.id}>
                      <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
                        <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}
