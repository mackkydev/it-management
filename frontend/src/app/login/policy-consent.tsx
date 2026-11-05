"use client";

import { useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { PolicyContent } from "@/components/policy-content";
import { useI18n } from "@/i18n/client";
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
        <ModalShell id="login-policy" size="policy" title={t("login_policy.title")} onClose={() => setReading(false)}>
          <PolicyContent sections={policy.sections} files={policy.files} />
        </ModalShell>
      )}
    </div>
  );
}
