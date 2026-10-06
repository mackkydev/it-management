"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { importAssets, type ImportResult } from "@/app/actions/assets";
import { AlertIcon, CheckCircleIcon, DownloadIcon, SpinnerIcon, UploadIcon, XIcon } from "@/components/icons";
import { alert, btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ปุ่ม "นำเข้า Excel" → modal: ดาวน์โหลด template / เลือกไฟล์ / ผลการนำเข้า (สำเร็จ + แถวที่ควรตรวจ หรือแถวที่ต้องแก้) */
export function ImportAssets() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setFile(null);
    setResult(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  const submit = () => {
    if (!file) return setResult({ ok: false, message: t("assets.import.noFile"), rows: [] });
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const res = await importAssets(form);
      setResult(res);
      if (res.ok) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  };

  const issues = result ? (result.ok ? result.warnings : result.rows) : [];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn.secondary}>
        <UploadIcon className="text-accent-500" />
        {t("assets.import.button")}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-assets-title"
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line"
            >
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h2 id="import-assets-title" className="font-semibold">
                    {t("assets.import.title")}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{t("assets.import.hint")}</p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("assets.import.close")}
                  className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  <XIcon width={18} height={18} />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto px-5 py-4">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ดาวน์โหลดไฟล์จาก route handler (ไม่ใช่หน้าเว็บ) */}
                <a href="/files/assets/import-template?download=1" className={`${btn.secondary} ${btn.sm} w-fit`}>
                  <DownloadIcon width={14} height={14} className="text-accent-500" />
                  {t("assets.import.template")}
                </a>

                <div>
                  <label htmlFor="import-file" className="mb-1 block text-sm font-medium">
                    {t("assets.import.file")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={inputRef}
                    id="import-file"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={pending}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setResult(null);
                    }}
                    className="block w-full cursor-pointer text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-800 hover:file:bg-accent-200 dark:file:bg-accent-400/15 dark:file:text-accent-200"
                  />
                </div>

                {result && (
                  <div role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
                    {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
                    <span>{result.ok ? t("assets.import.success", { created: result.created, updated: result.updated }) : result.message}</span>
                  </div>
                )}
                {issues.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium">{result?.ok ? t("assets.import.warnings") : t("assets.import.errors")}</p>
                    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-subtle p-3 text-sm">
                      {issues.map((i, n) => (
                        <li key={n} className="flex gap-2">
                          {i.row > 0 && <span className="shrink-0 font-medium text-muted">{t("assets.import.row", { row: i.row })}</span>}
                          <span>{i.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
                <button type="button" onClick={close} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
                  {t("assets.import.close")}
                </button>
                <button type="button" onClick={submit} disabled={pending || !file} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
                  {pending ? <SpinnerIcon /> : <UploadIcon />}
                  {pending ? t("assets.import.submitting") : t("assets.import.submit")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
