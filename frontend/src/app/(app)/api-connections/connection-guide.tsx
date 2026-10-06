"use client";

import { ChevronDownIcon, FileTextIcon } from "@/components/icons";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";

const STEPS = [1, 2, 3, 4, 5, 6] as const;
const NOTES = [1, 2, 3, 4, 5, 6] as const;
const ENDPOINTS = [
  ["POST", "/api/v1/auth/login", "login"],
  ["GET", "/api/v1/auth/permissions", "permissions"],
  ["POST", "/api/v1/auth/logout", "logout"],
  ["GET", "/health", "health"],
] as const;

/** วิธีเชื่อมต่อ STEC SyteLine API (ตามคู่มือ STEC API Portal — Part III / IV) — ย่อไว้ คลิกเพื่อขยาย */
export function ConnectionGuide() {
  const { t } = useI18n();
  const g = (key: string) => t(`apiConnections.guide.${key}` as MessageKey);

  return (
    <details className={`group p-4 sm:p-6 ${card}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <FileTextIcon width={18} height={18} className="shrink-0 text-accent-500" />
        {g("title")}
        <span className="ml-auto text-xs font-normal text-muted group-open:hidden">{g("show")}</span>
        <ChevronDownIcon width={16} height={16} className="shrink-0 text-muted transition-transform group-open:ml-auto group-open:rotate-180" />
      </summary>

      <div className="mt-4 space-y-5 text-sm">
        <p className="text-muted">{g("intro")}</p>

        <ol className="space-y-3">
          {STEPS.map((n) => (
            <li key={n} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">
                {n}
              </span>
              <div>
                <p className="font-medium">{g(`step${n}`)}</p>
                <p className="mt-0.5 text-muted">{g(`step${n}Detail`)}</p>
              </div>
            </li>
          ))}
        </ol>

        <div>
          <p className="mb-2 font-medium">{g("endpointsTitle")}</p>
          <ul className="space-y-1 rounded-xl bg-subtle p-3">
            {ENDPOINTS.map(([method, path, key]) => (
              <li key={path} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-12 font-mono text-xs font-semibold text-accent-700 dark:text-accent-300">{method}</span>
                <span className="font-mono text-xs">{path}</span>
                <span className="text-xs text-muted">— {g(`endpoints.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 font-medium">{g("notesTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {NOTES.map((n) => (
              <li key={n}>{g(`note${n}`)}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
