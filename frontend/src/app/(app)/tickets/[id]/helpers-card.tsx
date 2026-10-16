"use client";

import { useState, useTransition } from "react";
import { saveTicketHelpers } from "@/app/actions/tickets";
import { PencilIcon, SaveIcon, SpinnerIcon, UsersIcon } from "@/components/icons";
import { btn, card, input, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { TicketDetail } from "@/lib/types";

type Option = NonNullable<TicketDetail["helper_options"]>[number];

/** เลือกผู้ร่วมดำเนินการ (เจ้าหน้าที่ IT) — ค้นหาชื่อ + ติ๊กเลือกหลายคน, ไม่รวมผู้รับงานเอง */
export function HelperPicker({
  options,
  value,
  onChange,
  exclude,
  searchLabel,
  noMatchLabel,
}: {
  options: Option[];
  value: number[];
  onChange: (ids: number[]) => void;
  exclude?: number | null;
  /** ข้อความช่องค้นหา / ไม่พบ (ค่าตั้งต้น = เจ้าหน้าที่ IT) — ใช้ซ้ำเลือกผู้ใช้อื่นได้ */
  searchLabel?: string;
  noMatchLabel?: string;
}) {
  const { t } = useI18n();
  const search = searchLabel ?? t("ticketHelpers.search");
  const [q, setQ] = useState("");
  const list = options.filter((o) => o.id !== exclude);
  const shown = list.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list
            .filter((o) => value.includes(o.id))
            .map((o) => (
              <button key={o.id} type="button" onClick={() => toggle(o.id)} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.info.badge}`}>
                {o.name} ×
              </button>
            ))}
        </div>
      )}
      {list.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} aria-label={search} className={input} />}
      <div className="max-h-48 overflow-y-auto rounded-xl p-1 ring-1 ring-line">
        {shown.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted">{noMatchLabel ?? t("ticketHelpers.noMatch")}</p>
        ) : (
          shown.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle/60">
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} className="h-4 w-4 accent-[var(--accent-500)]" />
              <span className="flex-1">{o.name}</span>
              {o.busy && <span className={`rounded-full px-2 py-0.5 text-xs ${tone.warning.badge}`}>{t(`ticketHelpers.busy.${o.busy}`)}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/** การ์ด "ผู้ร่วมดำเนินการ" ในหน้ารายละเอียดใบแจ้งงาน — ผู้รับงานแก้รายชื่อได้ระหว่างงานยังไม่ปิด */
export function HelpersCard({ ticket }: { ticket: TicketDetail }) {
  const { t } = useI18n();
  const helpers = ticket.helpers ?? [];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number[]>(helpers.map((h) => h.id));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!helpers.length && !ticket.can_edit_helpers) return null;

  const save = () =>
    start(async () => {
      const res = await saveTicketHelpers(ticket.id, value);
      if (res.ok) {
        setEditing(false);
        setError("");
      } else setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
    });

  return (
    <section className={`space-y-3 p-4 sm:p-5 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <UsersIcon width={16} height={16} className="text-info-500" />
          {t("ticketHelpers.title")}
        </h2>
        {ticket.can_edit_helpers && !editing && (
          <button type="button" onClick={() => {
              setValue(helpers.map((h) => h.id));
              setEditing(true);
            }} className={`${btn.soft} ${btn.sm}`}>
            <PencilIcon width={13} height={13} />
            {helpers.length ? t("ticketHelpers.edit") : t("ticketHelpers.add")}
          </button>
        )}
      </div>
      {!editing &&
        (helpers.length ? (
          <div className="flex flex-wrap gap-1.5">
            {helpers.map((h) => (
              <span key={h.id} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.info.badge}`}>
                {h.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("ticketHelpers.none")}</p>
        ))}
      {editing && (
        <div className="space-y-3">
          <HelperPicker options={ticket.helper_options ?? []} value={value} onChange={setValue} exclude={ticket.assignee?.id} />
          <p className="text-xs text-muted">{t("ticketHelpers.hint")}</p>
          {error && <p className="text-xs font-medium text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={btn.secondary}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={save} disabled={pending} className={btn.primary}>
              {pending ? <SpinnerIcon /> : <SaveIcon />}
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
