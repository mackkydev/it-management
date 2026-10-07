"use client";

import { useState, useTransition } from "react";
import { deleteInstallation, uninstallInstallation } from "@/app/actions/license-installations";
import { ResetIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";
import { useConfirm } from "@/components/dialog-provider";

const ICON_BTN =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** ถอนการติดตั้ง (คืน seat) / ลบรายการที่บันทึกผิด */
export function RowActions({ id, licenseId, active, label }: { id: number; licenseId: string; active: boolean; label: string }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"uninstall" | "delete" | null>(null);
  const [pending, start] = useTransition();

  const run = async (kind: "uninstall" | "delete") => {
    if (!(await confirm(kind === "uninstall" ? t("installations.confirmUninstall", { name: label }) : t("installations.confirmDelete", { name: label })))) return;
    setBusy(kind);
    start(async () => {
      const res = kind === "uninstall" ? await uninstallInstallation(id, licenseId) : await deleteInstallation(id, licenseId);
      setBusy(null);
      setError(res.ok ? "" : (res.message ?? ""));
    });
  };

  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      {active && (
        <Tooltip label={t("installations.uninstall")}>
          <button type="button" onClick={() => run("uninstall")} disabled={pending} aria-label={t("installations.uninstall")} className={ICON_BTN}>
            {busy === "uninstall" ? <SpinnerIcon width={15} height={15} /> : <ResetIcon width={15} height={15} />}
          </button>
        </Tooltip>
      )}
      <Tooltip label={t("installations.delete")}>
        <button
          type="button"
          onClick={() => run("delete")}
          disabled={pending}
          aria-label={t("installations.delete")}
          className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}
        >
          {busy === "delete" ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
        </button>
      </Tooltip>
      {error && <span className="ml-1 text-xs font-medium text-red-500">{error}</span>}
    </span>
  );
}
