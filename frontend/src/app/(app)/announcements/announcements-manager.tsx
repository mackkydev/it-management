"use client";

import { useState, useTransition } from "react";
import { deleteAnnouncement, saveAnnouncement, type AnnouncementPayload } from "@/app/actions/announcements";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import { ANNOUNCEMENT_LEVELS, type Announcement } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";

const EMPTY: AnnouncementPayload = { title: "", body: "", level: "info", is_active: true, starts_on: "", ends_on: "", sort_order: "" };
const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;
const ICON_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** สถานะการแสดงตอนนี้: กำลังแสดง / ตั้งเวลาไว้ / หมดเวลา / ปิด */
function showState(a: Announcement, today: string): "live" | "scheduled" | "ended" | "off" {
  if (!a.is_active) return "off";
  if (a.starts_on && a.starts_on > today) return "scheduled";
  if (a.ends_on && a.ends_on < today) return "ended";
  return "live";
}
const STATE_TONE = { live: tone.success, scheduled: tone.info, ended: tone.idle, off: tone.idle } as const;

/** จัดการประกาศหน้า login — ฟอร์มเพิ่ม/แก้ไขด้านบน รายการด้านล่าง */
export function AnnouncementsManager({ items }: { items: Announcement[] }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<AnnouncementPayload>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const today = localToday();

  const set = <K extends keyof AnnouncementPayload>(k: K, value: AnnouncementPayload[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const openForm = (a?: Announcement) => {
    setEditing(a?.id ?? null);
    setV(
      a
        ? { title: a.title, body: a.body ?? "", level: a.level, is_active: a.is_active, starts_on: a.starts_on ?? "", ends_on: a.ends_on ?? "", sort_order: String(a.sort_order) }
        : EMPTY,
    );
    setErrors({});
    setFeedback(null);
    setOpen(true);
  };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!v.title.trim()) e.title = t("announcements.validate.title");
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) e.ends_on = t("announcements.validate.endsBeforeStarts");
    setErrors(e);
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveAnnouncement(editing, v);
      if (res.ok) {
        setOpen(false);
        setFeedback({ ok: true, text: res.message ?? "" });
      } else {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, m ?? ""])));
        setFeedback({ ok: false, text: res.message ?? "" });
      }
    });
  };

  const remove = async (a: Announcement) => {
    if (!(await confirm(t("announcements.confirmDelete", { title: a.title })))) return;
    setDeleting(a.id);
    start(async () => {
      const res = await deleteAnnouncement(a.id);
      setDeleting(null);
      setFeedback({ ok: Boolean(res.ok), text: res.message ?? "" });
    });
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;

  return (
    <div className="space-y-5">
      {feedback?.text && (
        <p role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </p>
      )}

      {open ? (
        <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{editing ? t("announcements.editTitle") : t("announcements.newTitle")}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className={ICON_BTN}>
              <XIcon width={16} height={16} />
            </button>
          </div>
          <fieldset disabled={pending} className="grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="title" className="mb-1 block text-sm font-medium">
                {t("announcements.form.title")} <span className="text-red-500">*</span>
              </label>
              <input id="title" maxLength={200} value={v.title} placeholder={t("announcements.form.titlePlaceholder")} onChange={(e) => set("title", e.target.value)} className={cls("title")} />
              {err("title")}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="body" className="mb-1 block text-sm font-medium">
                {t("announcements.form.body")}
              </label>
              <textarea id="body" rows={3} maxLength={2000} value={v.body} onChange={(e) => set("body", e.target.value)} className={cls("body")} />
              {err("body")}
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">{t("announcements.form.level")}</legend>
              <div className="flex flex-wrap gap-2">
                {ANNOUNCEMENT_LEVELS.map((l) => (
                  <label
                    key={l}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${v.level === l ? "bg-subtle ring-accent-300" : "ring-line hover:bg-subtle"}`}
                  >
                    <input type="radio" name="level" value={l} checked={v.level === l} onChange={() => set("level", l)} className="accent-[var(--accent-500)]" />
                    <span className={`h-2.5 w-2.5 rounded-full ${LEVEL_TONE[l].dot}`} aria-hidden="true" />
                    {t(`announcements.levels.${l}`)}
                  </label>
                ))}
              </div>
              {err("level")}
            </fieldset>
            <div>
              <label htmlFor="starts_on" className="mb-1 block text-sm font-medium">
                {t("announcements.form.startsOn")}
              </label>
              <DateInput id="starts_on" value={v.starts_on} onChange={(d) => set("starts_on", d)} className={cls("starts_on")} />
              {err("starts_on") ?? <p className="mt-1 text-xs text-muted">{t("announcements.form.dateHint")}</p>}
            </div>
            <div>
              <label htmlFor="ends_on" className="mb-1 block text-sm font-medium">
                {t("announcements.form.endsOn")}
              </label>
              <DateInput id="ends_on" value={v.ends_on} min={v.starts_on || undefined} onChange={(d) => set("ends_on", d)} className={cls("ends_on")} />
              {err("ends_on")}
            </div>
            <div>
              <label htmlFor="sort_order" className="mb-1 block text-sm font-medium">
                {t("announcements.form.sortOrder")}
              </label>
              <input id="sort_order" type="number" min={0} max={999} inputMode="numeric" value={v.sort_order} onChange={(e) => set("sort_order", e.target.value)} className={cls("sort_order")} />
              {err("sort_order") ?? <p className="mt-1 text-xs text-muted">{t("announcements.form.sortHint")}</p>}
            </div>
            <label className="flex cursor-pointer items-center gap-2 self-center text-sm">
              <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
              {t("announcements.form.active")}
            </label>
          </fieldset>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btn.secondary}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={btn.primary}>
              {pending ? <SpinnerIcon /> : <SaveIcon />}
              {t("common.save")}
            </button>
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => openForm()} className={btn.primary}>
          <PlusIcon />
          {t("announcements.add")}
        </button>
      )}

      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("announcements.empty")}</div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => {
            const state = showState(a, today);
            return (
              <li key={a.id} className={`relative flex items-start gap-3 overflow-hidden py-4 pl-5 pr-3 ${card}`}>
                <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level].dot}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[state].badge}`}>{t(`announcements.states.${state}`)}</span>
                  </p>
                  {a.body && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{a.body}</p>}
                  <p className="mt-1 text-xs text-faint">
                    {a.starts_on || a.ends_on
                      ? t("announcements.period", { from: a.starts_on ? fmt.date(a.starts_on) : "–", to: a.ends_on ? fmt.date(a.ends_on) : "–" })
                      : t("announcements.noPeriod")}
                    {` · ${t("announcements.order", { n: String(a.sort_order) })}`}
                    {a.created_by && ` · ${a.created_by.name}`}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Tooltip label={t("common.edit")}>
                    <button type="button" onClick={() => openForm(a)} disabled={pending} aria-label={t("common.edit")} className={ICON_BTN}>
                      <PencilIcon width={15} height={15} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t("common.delete")}>
                    <button type="button" onClick={() => remove(a)} disabled={pending} aria-label={t("common.delete")} className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}>
                      {deleting === a.id ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
                    </button>
                  </Tooltip>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
