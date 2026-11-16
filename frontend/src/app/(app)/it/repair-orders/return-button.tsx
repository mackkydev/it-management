"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { returnRepairOrder } from "@/app/actions/repair-orders";
import { DocumentPicker, EVENT_FILE_ACCEPT, EVENT_FILE_MAX_BYTES, EVENT_FILES_MAX } from "@/components/file-pickers";
import { CheckCircleIcon, PlusIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";

type PartRow = { name: string; quantity: string };
const PARTS_MAX = 10;
const emptyPart = (): PartRow => ({ name: "", quantity: "1" });

/** ปุ่ม "รับเครื่องซ่อมคืน" + อะไหล่ที่ร้านเปลี่ยน (ตั้งต้น 1 แถว เพิ่มได้) + กล่องแนบเอกสาร/รูป — ผูกใบแจ้งงาน = API ลงประวัติใบงานและแจ้งเตือนให้ */
export function ReturnButton({ id, item, full = false }: { id: string; item: string; full?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [parts, setParts] = useState<PartRow[]>([emptyPart()]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setNote("");
    setFiles([]);
    setParts([emptyPart()]);
    setError("");
    setOpen(true);
  };
  const save = () => {
    const fd = new FormData();
    if (note.trim()) fd.set("return_note", note.trim());
    parts
      .filter((p) => p.name.trim())
      .forEach((p, i) => {
        fd.set(`parts[${i}][name]`, p.name.trim());
        fd.set(`parts[${i}][quantity]`, String(Math.min(999, Math.max(1, Number(p.quantity) || 1))));
      });
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
        <ModalShell id="repair-return" title={t("repairOrders.return.title")} subtitle={item} onClose={() => setOpen(false)} busy={pending} size="lg">
          <div className="space-y-4">
            <div>
              <label htmlFor="return_note" className="mb-1 block text-sm font-medium">
                {t("repairOrders.return.note")}
              </label>
              <textarea id="return_note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("repairOrders.return.parts")}</p>
              <div className="space-y-2">
                {parts.map((p, i) => (
                  <div key={i} className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <input
                        aria-label={t("repairOrders.return.partName")}
                        placeholder={t("repairOrders.return.partName")}
                        value={p.name}
                        maxLength={255}
                        onChange={(e) => setParts((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className={input}
                      />
                    </div>
                    <div className="w-20 shrink-0">
                      <input
                        aria-label={t("repairOrders.return.qty")}
                        type="number"
                        min={1}
                        max={999}
                        value={p.quantity}
                        onChange={(e) => setParts((list) => list.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                        className={`${input} text-center`}
                      />
                    </div>
                    <Tooltip label={t("repairOrders.return.removePart", { n: i + 1 })}>
                      <button
                        type="button"
                        aria-label={t("repairOrders.return.removePart", {
                          n: i + 1,
                        })}
                        onClick={() => setParts((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [emptyPart()]))}
                        className={`${btn.secondary} ${btn.icon} hover:text-danger-500`}
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
              {parts.length < PARTS_MAX && (
                <button type="button" onClick={() => setParts((list) => [...list, emptyPart()])} className={`${btn.secondary} ${btn.sm} mt-2`}>
                  <PlusIcon width={13} height={13} className="text-accent-500" />
                  {t("repairOrders.return.addPart")}
                </button>
              )}
              <p className="mt-1 text-xs text-muted">{t("repairOrders.return.partsHint")}</p>
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
