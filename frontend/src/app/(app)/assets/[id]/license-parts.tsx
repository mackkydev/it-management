"use client";

import { useRef, useState, useTransition } from "react";
import { deleteAssetFile, revealLicenseKey, uploadAssetFiles } from "@/app/actions/assets";
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileTextIcon, SpinnerIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { AssetFile } from "@/lib/types";

const ICON_BTN =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** license key: แสดง •••• กดดูได้ (API ตรวจสิทธิ์ + จำกัดจำนวนครั้ง) และคัดลอก */
export function LicenseKey({ assetId }: { assetId: string }) {
  const { t } = useI18n();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const toggle = () => {
    if (key !== null) return setKey(null);
    start(async () => {
      const res = await revealLicenseKey(assetId);
      if (res.message) setError(res.message);
      else setKey(res.key ?? "");
    });
  };

  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="flex flex-wrap items-center gap-1">
      <code className="rounded-lg bg-subtle px-2 py-1 font-mono text-sm break-all">{key ?? "••••••••••••"}</code>
      <Tooltip label={key !== null ? t("assets.license.hideKey") : t("assets.license.showKey")}>
        <button type="button" onClick={toggle} disabled={pending} aria-label={key !== null ? t("assets.license.hideKey") : t("assets.license.showKey")} className={ICON_BTN}>
          {pending ? <SpinnerIcon width={15} height={15} /> : key !== null ? <EyeOffIcon width={15} height={15} /> : <EyeIcon width={15} height={15} />}
        </button>
      </Tooltip>
      {key && (
        <Tooltip label={copied ? t("assets.license.copied") : t("assets.license.copyKey")}>
          <button type="button" onClick={copy} aria-label={t("assets.license.copyKey")} className={ICON_BTN}>
            {copied ? <CheckIcon width={15} height={15} className="text-success-500" /> : <CopyIcon width={15} height={15} />}
          </button>
        </Tooltip>
      )}
      {error && <span className="w-full text-xs font-medium text-red-500">{error}</span>}
    </span>
  );
}

const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.txt,.lic,.key,.xml,.zip,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";
/** เปิดดูในเบราว์เซอร์ได้ — นอกนั้นดาวน์โหลด */
const previewable = (mime: string) => /^(application\/pdf|image\/|text\/plain)/.test(mime);
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** ไฟล์ license: รายการ + พรีวิว/ดาวน์โหลด, อัปโหลดหลายไฟล์ และลบ (ผู้จัดการสินทรัพย์) */
export function LicenseFiles({ assetId, files, canManage }: { assetId: string; files: AssetFile[]; canManage: boolean }) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pending, start] = useTransition();

  // อัปโหลดทีละไฟล์ — ไม่ชนขนาดสูงสุดของคำขอ และรู้ว่าไฟล์ไหนไม่ผ่าน
  const upload = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (picker.current) picker.current.value = "";
    if (chosen.length === 0) return;
    const tooBig = chosen.find((f) => f.size > MAX_SIZE);
    if (tooBig) return setMessage({ ok: false, text: t("assets.files.tooLarge", { name: tooBig.name }) });
    setMessage(null);
    start(async () => {
      for (const [i, file] of chosen.entries()) {
        setProgress(t("assets.files.uploading", { current: String(i + 1), total: String(chosen.length) }));
        const fd = new FormData();
        fd.append("files[]", file);
        const res = await uploadAssetFiles(assetId, fd);
        if (!res.ok) {
          const detail = Object.values(res.errors ?? {})[0] ?? res.message ?? "";
          setMessage({ ok: false, text: `${file.name}: ${detail}` });
          setProgress(null);
          return;
        }
      }
      setProgress(null);
      setMessage({ ok: true, text: t("assets.files.uploaded", { count: String(chosen.length) }) });
    });
  };

  const remove = (f: AssetFile) => {
    if (!confirm(t("assets.files.confirmDelete", { name: f.name }))) return;
    setDeleting(f.id);
    start(async () => {
      const res = await deleteAssetFile(assetId, f.id);
      setDeleting(null);
      setMessage(res.ok ? { ok: true, text: t("assets.files.deleted") } : { ok: false, text: res.message ?? "" });
    });
  };

  return (
    <div className="space-y-3">
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? alert.success : alert.error}>
          {message.ok ? <CheckIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {message.text}
        </p>
      )}
      {files.length === 0 ? (
        <p className="text-sm text-muted">{t("assets.files.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
              <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
              {previewable(f.mime) ? (
                <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                  {f.name}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
              )}
              <span className="shrink-0 text-xs text-muted">{sizeText(f.size)}</span>
              {previewable(f.mime) && (
                <Tooltip label={t("assets.files.preview")}>
                  <a href={`/files${f.url}`} target="_blank" rel="noreferrer" aria-label={t("assets.files.preview")} className={ICON_BTN}>
                    <EyeIcon width={15} height={15} />
                  </a>
                </Tooltip>
              )}
              <Tooltip label={t("assets.files.download")}>
                <a href={`/files${f.url}?download=1`} aria-label={t("assets.files.download")} className={ICON_BTN}>
                  <DownloadIcon width={15} height={15} />
                </a>
              </Tooltip>
              {canManage && (
                <Tooltip label={t("common.delete")}>
                  <button
                    type="button"
                    onClick={() => remove(f)}
                    disabled={pending}
                    aria-label={t("assets.files.deleteLabel", { name: f.name })}
                    className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}
                  >
                    {deleting === f.id ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
                  </button>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <input ref={picker} type="file" multiple accept={ACCEPT} onChange={(e) => upload(e.target.files)} className="hidden" />
          <button type="button" onClick={() => picker.current?.click()} disabled={pending} aria-busy={pending} className={btn.soft}>
            {pending && progress ? <SpinnerIcon /> : <UploadIcon />}
            {progress ?? t("assets.files.upload")}
          </button>
          <span className="text-xs text-muted">{t("assets.files.hint")}</span>
        </div>
      )}
    </div>
  );
}
