"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** คัดลอกลิงก์ประชุม ZOOM */
export function CopyLink({ link }: { link: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={`${btn.secondary} ${btn.sm}`}
    >
      {copied ? <CheckIcon width={14} height={14} className="text-success-500" /> : <CopyIcon width={14} height={14} />}
      {copied ? t("zoom.detail.copied") : t("zoom.detail.copy")}
    </button>
  );
}
