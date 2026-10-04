"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { removeLogo, uploadLogo } from "@/app/actions/branding";
import { AlertIcon, CheckCircleIcon, MonitorIcon, SpinnerIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** โลโก้ระบบ: แสดงหน้าชื่อ IT-SYSTEM ในเมนู — ไม่มีรูป = icon เดิม */
export function LogoCard({ version }: { version: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) return setResult({ ok: false, text: t("logo.tooLarge") });
    const fd = new FormData();
    fd.append("logo", file);
    start(async () => {
      const res = await uploadLogo(fd);
      setResult({ ok: Boolean(res.ok), text: res.errors?.logo ?? res.message ?? "" });
      if (fileRef.current) fileRef.current.value = "";
      if (res.ok) router.refresh();
    });
  };

  const onRemove = () => {
    if (!confirm(t("logo.confirmRemove"))) return;
    start(async () => {
      const res = await removeLogo();
      setResult({ ok: Boolean(res.ok), text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  };

  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="font-semibold">{t("logo.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("logo.hint")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-line">
          {version ? (
            // eslint-disable-next-line @next/next/no-img-element -- ไฟล์ผ่าน /files (ไม่ผ่าน next/image)
            <img src={`/files/branding/logo?v=${encodeURIComponent(version)}`} alt={t("logo.title")} className="h-9 w-9 rounded-xl object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-200 text-accent-700 dark:bg-accent-400/20 dark:text-accent-300">
              <MonitorIcon width={19} height={19} />
            </span>
          )}
          <span className="font-semibold">{t("app.name")}</span>
          {!version && <span className="text-xs text-muted">({t("logo.none")})</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <UploadIcon />}
          {version ? t("logo.change") : t("logo.upload")}
        </button>
        {version && (
          <button type="button" onClick={onRemove} disabled={pending} className={`${btn.danger} disabled:cursor-not-allowed`}>
            <TrashIcon />
            {t("logo.remove")}
          </button>
        )}
      </div>
      {result && (
        <p role="status" className={`mt-3 ${result.ok ? alert.success : alert.error}`}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.text}
        </p>
      )}
    </section>
  );
}
