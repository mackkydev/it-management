"use client";

import { useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { PolicyContent } from "@/components/policy-content";
import { useI18n } from "@/i18n/client";
import type { PolicyFile, PolicySection } from "@/lib/types";

/** GET /policy/public — ทุกเรื่องที่แสดงอยู่ตามลำดับ */
export interface LoginPolicy {
  items: { version: number; title: string; sections: PolicySection[]; files: PolicyFile[] }[];
}

/** ช่องติ๊กยอมรับนโยบายในหน้า login (ตั้งแสดงที่หน้า login) — ส่ง policy_version (หลายเรื่องคั่นด้วย ,) ไปกับฟอร์ม ติ๊กแล้วจึงกดเข้าสู่ระบบได้ */
export function PolicyConsent({ policy, checked, onChange }: { policy: LoginPolicy; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const [reading, setReading] = useState(false);
  const many = policy.items.length > 1;
  return (
    <div>
      {checked && <input type="hidden" name="policy_version" value={policy.items.map((i) => i.version).join(",")} />}
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
          <div className="space-y-8">
            {policy.items.map((item, i) => (
              <section key={item.version} className="space-y-3">
                {(many || item.title) && (
                  <h2 className="border-b border-line pb-2 text-lg font-semibold">
                    {many ? `${i + 1}. ` : ""}
                    {item.title || t("login_policy.title")}
                  </h2>
                )}
                <PolicyContent sections={item.sections} files={item.files} />
              </section>
            ))}
          </div>
        </ModalShell>
      )}
    </div>
  );
}
