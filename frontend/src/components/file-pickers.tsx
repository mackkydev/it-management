"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CameraIcon, FileTextIcon, PaperclipIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export const PHOTO_MAX_BYTES = 1024 * 1024; // 1MB ต่อรูป (ตรงกับ Laravel max:1024)
export const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5MB ต่อไฟล์
export const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.jpg,.jpeg,.png";

/**
 * ย่อรูปให้ไม่เกิน 1MB (รูปจากกล้องมือถือมักใหญ่ 3–8MB)
 * ลดขนาดด้านยาวสุด 1920px แล้วลดคุณภาพ JPEG ทีละขั้นจนไม่เกินกำหนด
 */
export async function compressImage(file: File, maxBytes = PHOTO_MAX_BYTES): Promise<File> {
  if (file.size <= maxBytes && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  let maxSide = 1920;
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= maxBytes) {
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    }
    quality = Math.max(0.5, quality - 0.1);
    maxSide = Math.round(maxSide * 0.8);
  }
  throw new Error("too-big");
}

/** แสดงตัวอย่างรูปจาก File (สร้าง/ยกเลิก object URL ให้อัตโนมัติ) */
function Thumb({ file, onRemove, label }: { file: File; onRemove: () => void; label: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="group relative h-24 w-24 overflow-hidden rounded-xl ring-1 ring-line">
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL ของไฟล์ในเครื่อง */}
      <img src={url} alt={file.name} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="absolute right-1 top-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
      >
        <XIcon width={13} height={13} />
      </button>
      <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5 text-center text-[10px] text-white">
        {Math.round(file.size / 1024)} KB
      </span>
    </div>
  );
}

/**
 * เลือก/ถ่ายรูป: บนมือถือเปิดกล้องได้ทันที (capture), ย่อรูปให้อัตโนมัติ, จำกัดจำนวนรูป
 */
export function PhotoPicker({
  files,
  onChange,
  max,
  onError,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  onError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [busy, setBusy] = useState(false);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    if (files.length + incoming.length > max) {
      onError?.(t("upload.tooMany", { max }));
      incoming.splice(max - files.length);
    }
    setBusy(true);
    const ready: File[] = [];
    for (const f of incoming) {
      if (!f.type.startsWith("image/")) {
        onError?.(t("upload.badType", { name: f.name }));
        continue;
      }
      try {
        ready.push(await compressImage(f));
      } catch {
        onError?.(t("upload.tooBig", { name: f.name }));
      }
    }
    setBusy(false);
    onChange([...files, ...ready].slice(0, max));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <Thumb key={`${f.name}-${i}`} file={f} label={t("upload.remove")} onRemove={() => onChange(files.filter((_, j) => j !== i))} />
        ))}
        {files.length < max && (
          <label
            htmlFor={id}
            className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-accent-200 text-accent-600 transition-colors hover:bg-accent-50 dark:border-accent-400/30 dark:text-accent-300 dark:hover:bg-accent-400/10"
          >
            {busy ? <SpinnerIcon /> : <CameraIcon width={20} height={20} />}
            <span className="px-1 text-center text-[11px] leading-tight">{busy ? t("upload.processing") : t("upload.takePhoto")}</span>
          </label>
        )}
      </div>
      {/* accept=image/* + capture: มือถือแสดงตัวเลือกถ่ายรูปจากกล้อง */}
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={max > 1}
        className="sr-only"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="mt-1.5 text-xs text-muted">{t("upload.photoHint", { max })}</p>
    </div>
  );
}

/** แนบเอกสาร (PDF/Office/ZIP) ไม่เกินจำนวนและขนาดที่กำหนด */
export function DocumentPicker({
  files,
  onChange,
  max,
  onError,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  onError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= max) {
        onError?.(t("upload.tooMany", { max }));
        break;
      }
      if (f.size > DOC_MAX_BYTES) {
        onError?.(t("upload.tooBig", { name: f.name }));
        continue;
      }
      next.push(f);
    }
    onChange(next);
  };

  return (
    <div>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
              <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={t("upload.remove")}
                className="cursor-pointer rounded-lg p-1 text-muted transition-colors hover:bg-surface hover:text-danger-500"
              >
                <XIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <label htmlFor={id} className={`${btn.secondary} ${btn.sm}`}>
          <PaperclipIcon width={14} height={14} className="text-accent-500" />
          {t("upload.addDocument")}
        </label>
      )}
      <input
        id={id}
        type="file"
        accept={DOC_ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="mt-1.5 text-xs text-muted">{t("upload.documentHint", { max })}</p>
    </div>
  );
}
