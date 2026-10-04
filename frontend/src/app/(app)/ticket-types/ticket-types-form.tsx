"use client";

import { useState, useTransition } from "react";
import { saveTicketOtherTypes } from "@/app/actions/it-data";
import { ChipList } from "@/components/chip-list";
import { AlertIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ตัวเลือกเรื่อง "อื่นๆ" ในใบแจ้งงาน — ผู้แจ้งเลือกจากรายการนี้ หรือพิมพ์เรื่องเองได้ */
export function TicketTypesForm({ initial }: { initial: string[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await saveTicketOtherTypes(items);
      const firstError = res.errors ? Object.values(res.errors)[0] : undefined;
      setFeedback({ ok: Boolean(res.ok), text: firstError ?? res.message ?? "" });
    });

  return (
    <div className="space-y-5">
      {feedback?.text && (
        <div role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </div>
      )}
      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="mb-1 font-semibold">{t("ticketTypes.section")}</h2>
        <p className="mb-3 text-sm text-muted">{t("ticketTypes.hint")}</p>
        <fieldset disabled={pending} className="disabled:opacity-60">
          <ChipList
            items={items}
            onChange={(next) => (setItems(next), setFeedback(null))}
            placeholder={t("ticketTypes.placeholder")}
            addLabel={t("ticketTypes.add")}
            emptyText={t("ticketTypes.empty")}
            validate={(o) => (items.some((x) => x.toLowerCase() === o.toLowerCase()) ? t("ticketTypes.duplicate") : o.length > 100 ? t("ticketTypes.tooLong") : null)}
          />
        </fieldset>
      </section>
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
