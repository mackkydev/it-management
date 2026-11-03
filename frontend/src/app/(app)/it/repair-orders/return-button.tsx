"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { returnRepairOrder } from "@/app/actions/repair-orders";
import { DocumentPicker, EVENT_FILE_ACCEPT, EVENT_FILE_MAX_BYTES, EVENT_FILES_MAX } from "@/components/file-pickers";
import { CheckCircleIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ปุ่ม "รับเครื่องซ่อมคืน" + กล่องแนบเอกสาร/รูป — ผูกใบแจ้งงาน = API ลงประวัติใบงานและแจ้งเตือนให้ */
export function ReturnButton({ id, item, full = false }: { id: string; item: string; full?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setNote("");
    setFiles([]);
    setError("");
    setOpen(true);
  };
  const save = () => {
    const fd = new FormData();
    if (note.trim()) fd.set("return_note", note.trim());
    files.forEach((f) => fd.append("files[]", f));
    start(async () => {
      const r = await returnRepairOrder(id, fd);
      if (r.ok) {
        setOpen(false);
        return router.refresh();
      }
      setError(Object.values(r.errors ?? {})[0] ?? r.message ?? t("common.saveFailed"));
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={full ? `${btn.primary} w-full` : `${btn.primary} ${btn.sm}`}>
        <CheckCircleIcon width={13} height={13} />
        {t("repairOrders.return.button")}
      </button>
      {open && (
        <ModalShell id="repair-return" title={t("repairOrders.return.title")} subtitle={item} onClose={() => setOpen(false)} busy={pending}>
          <div className="space-y-4">
            <div>
              <label htmlFor="return_note" className="mb-1 block text-sm font-medium">
                {t("repairOrders.return.note")}
              </label>
              <textarea id="return_note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("repairOrders.return.files")}</p>
              <DocumentPicker
                files={files}
                onChange={(f) => (setFiles(f), setError(""))}
                max={EVENT_FILES_MAX}
                maxBytes={EVENT_FILE_MAX_BYTES}
                accept={EVENT_FILE_ACCEPT}
                hint={t("upload.eventFileHint", { max: EVENT_FILES_MAX })}
                onError={setError}
              />
            </div>
            {error && (
              <p role="alert" className={alert.error}>
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
                <XIcon width={14} height={14} />
                {t("common.cancel")}
              </button>
              <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <CheckCircleIcon width={14} height={14} />}
                {t("repairOrders.return.submit")}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
