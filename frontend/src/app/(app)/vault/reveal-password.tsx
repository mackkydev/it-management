"use client";

import { useEffect, useState, useTransition } from "react";
import { revealCredential } from "@/app/actions/it-data";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";

const AUTO_HIDE_MS = 30_000;

/**
 * แสดงรหัสผ่านเมื่อกด (เรียก API ที่บันทึก log ทุกครั้ง) และซ่อนเองใน 30 วินาที
 * ค่าไม่ถูกส่งมากับหน้าเว็บตั้งแต่แรก
 */
export function RevealPassword({ id }: { id: number }) {
  const { t } = useI18n();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (value === null) return;
    const timer = window.setTimeout(() => setValue(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const reveal = () =>
    start(async () => {
      const res = await revealCredential(id);
      if ("error" in res) setError(res.error);
      else setValue(res.password ?? "");
    });

  const copy = async () => {
    if (value === null) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (error) return <span className="text-xs text-danger-600">{error}</span>;

  return (
    <div className="flex items-center gap-1">
      <code className="min-w-24 rounded-lg bg-subtle px-2 py-1 font-mono text-xs">{value === null ? "••••••••••" : value}</code>
      <Tooltip label={value === null ? t("vault.reveal") : t("vault.hide")} side="top">
        <button
          type="button"
          onClick={() => (value === null ? reveal() : setValue(null))}
          disabled={pending}
          aria-label={value === null ? t("vault.reveal") : t("vault.hide")}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
        >
          {pending ? <SpinnerIcon width={14} height={14} /> : value === null ? <EyeIcon width={15} height={15} /> : <EyeOffIcon width={15} height={15} />}
        </button>
      </Tooltip>
      {value !== null && (
        <Tooltip label={copied ? t("vault.copied") : t("vault.copy")} side="top">
          <button
            type="button"
            onClick={copy}
            aria-label={t("vault.copy")}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            {copied ? <CheckIcon width={15} height={15} className="text-success-500" /> : <CopyIcon width={15} height={15} />}
          </button>
        </Tooltip>
      )}
    </div>
  );
}
