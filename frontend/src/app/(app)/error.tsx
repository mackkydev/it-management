"use client";

import { AlertIcon, ResetIcon } from "@/components/icons";
import { btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className={`p-8 text-center ${card}`}>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 text-danger-500 dark:bg-danger-400/15 dark:text-danger-300">
        <AlertIcon width={24} height={24} />
      </span>
      <p className="mt-3 font-medium text-danger-700 dark:text-danger-300">{t("common.loadError")}</p>
      <p className="mt-1 text-sm text-muted">{t("common.loadErrorHint")}</p>
      <button onClick={reset} className={`${btn.primary} mt-4`}>
        <ResetIcon />
        {t("common.retry")}
      </button>
    </div>
  );
}
