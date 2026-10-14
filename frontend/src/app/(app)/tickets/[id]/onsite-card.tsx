"use client";

import { useEffect, useState, useTransition } from "react";
import { loadBusy, saveTicketOnsite } from "@/app/actions/calendar";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CalendarIcon, PencilIcon, SaveIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { TicketDetail } from "@/lib/types";

export interface OnsiteValue {
  start_on: string;
  end_on: string;
  note: string;
}

/** ช่องเลือกช่วงวันไปทำงานหน้างาน + เตือนถ้าทับวันลา/หน้างานอื่นของตัวเอง — ใช้ทั้งตอนรับงานและแก้ภายหลัง */
export function OnsiteFields({ value, onChange }: { value: OnsiteValue; onChange: (v: OnsiteValue) => void }) {
  const { t, fmt } = useI18n();
  const [busy, setBusy] = useState<{ kind: "leave" | "onsite"; start: string; end: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    if (value.start_on) loadBusy(null, value.start_on, value.end_on || value.start_on).then((b) => alive && setBusy(b));
    return () => {
      alive = false;
    };
  }, [value.start_on, value.end_on]);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr]">
        <div>
          <label htmlFor="onsite-start" className="mb-1 block text-sm font-medium">{t("calendar.start")}</label>
          <DateInput id="onsite-start" value={value.start_on} onChange={(d) => onChange({ ...value, start_on: d, end_on: value.end_on < d ? d : value.end_on })} className={input} />
        </div>
        <div>
          <label htmlFor="onsite-end" className="mb-1 block text-sm font-medium">{t("calendar.end")}</label>
          <DateInput id="onsite-end" value={value.end_on} min={value.start_on || undefined} onChange={(d) => onChange({ ...value, end_on: d })} className={input} />
        </div>
        <div>
          <label htmlFor="onsite-note" className="mb-1 block text-sm font-medium">{t("calendar.note")}</label>
          <input id="onsite-note" maxLength={1000} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} className={input} />
        </div>
      </div>
      {busy.length > 0 && (
        <p className={alert.warning}>
          <AlertIcon className="shrink-0 text-warning-500" />
          {t("calendar.busyWarn", {
            items: busy
              .map((b) => `${b.kind === "leave" ? t(`leave.types.${b.label as "sick"}`) : b.label} (${b.start === b.end ? fmt.date(b.start) : `${fmt.date(b.start)} – ${fmt.date(b.end)}`})`)
              .join(", "),
          })}
        </p>
      )}
    </div>
  );
}

/** การ์ด "ไปทำงานหน้างาน (ปฏิทิน)" ในหน้ารายละเอียดใบแจ้งงาน — ผู้รับงานเพิ่ม/แก้/เอาออกได้ */
export function OnsiteCard({ ticket }: { ticket: TicketDetail }) {
  const { t, fmt } = useI18n();
  const event = ticket.calendar_event ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<OnsiteValue>({ start_on: event?.start_on ?? localToday(), end_on: event?.end_on ?? localToday(), note: event?.note ?? "" });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!event && !ticket.can_edit_calendar) return null;

  const save = (remove = false) => {
    if (!remove && (!value.start_on || !value.end_on)) return setError(t("calendar.onsiteRequired"));
    start(async () => {
      const res = await saveTicketOnsite(ticket.id, remove ? null : value);
      if (res.ok) {
        setEditing(false);
        setError("");
      }
      else setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
    });
  };

  return (
    <section className={`space-y-3 p-4 sm:p-5 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarIcon width={16} height={16} className="text-info-500" />
          {t("calendar.onsiteTitle")}
        </h2>
        {ticket.can_edit_calendar && !editing && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setEditing(true)} className={`${btn.soft} ${btn.sm}`}>
              <PencilIcon width={13} height={13} />
              {event ? t("calendar.onsiteEdit") : t("calendar.onsiteAdd")}
            </button>
            {event && (
              <button type="button" onClick={() => save(true)} disabled={pending} className={`${btn.danger} ${btn.sm}`}>
                <TrashIcon width={13} height={13} />
                {t("calendar.onsiteRemove")}
              </button>
            )}
          </div>
        )}
      </div>
      {!editing &&
        (event ? (
          <p className="text-sm">
            {event.start_on === event.end_on ? fmt.date(event.start_on) : `${fmt.date(event.start_on)} – ${fmt.date(event.end_on)}`}
            {event.note && <span className="text-muted"> · {event.note}</span>}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("calendar.onsiteNone")}</p>
        ))}
      {editing && (
        <div className="space-y-3">
          <OnsiteFields value={value} onChange={setValue} />
          {error && <p className="text-xs font-medium text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={btn.secondary}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => save()} disabled={pending} className={btn.primary}>
              {pending ? <SpinnerIcon /> : <SaveIcon />}
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
