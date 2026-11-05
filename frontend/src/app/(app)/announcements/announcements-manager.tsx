"use client";

import { useState, useTransition } from "react";
import { deleteAnnouncement, saveAnnouncement, type AnnouncementPayload } from "@/app/actions/announcements";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { DocumentPicker, PhotoPicker } from "@/components/file-pickers";
import { ChevronDownIcon, EyeIcon, FileTextIcon, PencilIcon, PlusIcon, ResetIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { NewsReader } from "@/components/news-reader";
import { RichText } from "@/components/rich-text";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Tooltip } from "@/components/tooltip";
import { ResultToast } from "@/components/toast";
import { btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey, TFunction } from "@/i18n/types";
import { localToday } from "@/lib/date";
import { ANNOUNCEMENT_LEVELS, ANNOUNCEMENT_REPEATS, type Announcement } from "@/lib/types";

const EMPTY: AnnouncementPayload = { title: "", body: "", level: "info", is_active: true, starts_on: "", ends_on: "", sort_order: "", repeat_mode: "none", repeat_weekday: "", repeat_day: "", repeat_month: "" };
const LEVEL_TONE = { info: tone.info, warning: tone.warning, danger: tone.danger } as const;
const ICON_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const BODY_MAX = 5000;
const FILES_MAX = 10;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** สถานะการแสดงตอนนี้: กำลังแสดง / ตั้งเวลาไว้ (รวมทำซ้ำที่ยังไม่ถึงวัน) / หมดเวลา / ปิด */
function showState(a: Announcement, today: string): "live" | "scheduled" | "ended" | "off" {
  if (!a.is_active) return "off";
  if (a.ends_on && a.ends_on < today) return "ended";
  return a.is_showing ? "live" : "scheduled";
}
const STATE_TONE = { live: tone.success, scheduled: tone.info, ended: tone.idle, off: tone.idle } as const;
/** แท็บ: กำลังจะมาถึง (กำลังแสดง / ตั้งเวลาไว้ / ปิดอยู่) กับ ผ่านไปแล้ว (เลยวันสิ้นสุด) */
type Tab = "current" | "past";
const TAB_CLS = (active: boolean) =>
  `flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

const weekdayName = (t: TFunction, n: number | string) => t(`announcements.weekdays.${n}` as MessageKey);
const monthName = (t: TFunction, n: number | string) => t(`announcements.months.${n}` as MessageKey);

/** ข้อความการทำซ้ำ — ไม่ทำซ้ำ = null */
function repeatLabel(a: Announcement, t: TFunction): string | null {
  if (a.repeat_mode === "daily") return t("announcements.repeatLabel.daily");
  if (a.repeat_mode === "weekly") return t("announcements.repeatLabel.weekly", { day: weekdayName(t, a.repeat_weekday ?? 0) });
  if (a.repeat_mode === "monthly") return t("announcements.repeatLabel.monthly", { day: String(a.repeat_day) });
  if (a.repeat_mode === "yearly") return t("announcements.repeatLabel.yearly", { day: String(a.repeat_day), month: monthName(t, a.repeat_month ?? 1) });
  return null;
}

/** จัดการประกาศข่าวสาร (แสดงที่หน้าภาพรวม) — ฟอร์มเพิ่ม/แก้ไขด้านบน รายการแบบย่อด้านล่าง (กดหัวข้อเพื่อขยาย; แท็บผ่านไปแล้ว = เปิดกล่องอ่านฉบับเต็ม) */
export function AnnouncementsManager({ items }: { items: Announcement[] }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<AnnouncementPayload>(EMPTY);
  const [cover, setCover] = useState<File[]>([]);
  const [removeCover, setRemoveCover] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [removedFiles, setRemovedFiles] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [reading, setReading] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const today = localToday();
  const [tab, setTab] = useState<Tab>("current");
  const past = items.filter((a) => showState(a, today) === "ended");
  const current = items.filter((a) => showState(a, today) !== "ended");
  const shown = tab === "past" ? past : current;

  const set = <K extends keyof AnnouncementPayload>(k: K, value: AnnouncementPayload[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const openForm = (a?: Announcement) => {
    setEditing(a ?? null);
    setV(
      a
        ? {
            title: a.title,
            body: a.body ?? "",
            level: a.level,
            is_active: a.is_active,
            starts_on: a.starts_on ?? "",
            ends_on: a.ends_on ?? "",
            sort_order: String(a.sort_order),
            repeat_mode: a.repeat_mode,
            repeat_weekday: a.repeat_weekday === null ? "" : String(a.repeat_weekday),
            repeat_day: a.repeat_day === null ? "" : String(a.repeat_day),
            repeat_month: a.repeat_month === null ? "" : String(a.repeat_month),
          }
        : EMPTY,
    );
    setCover([]);
    setRemoveCover(false);
    setFiles([]);
    setRemovedFiles([]);
    setErrors({});
    setFeedback(null);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!v.title.trim()) e.title = t("announcements.validate.title");
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) e.ends_on = t("announcements.validate.endsBeforeStarts");
    if (v.repeat_mode === "weekly" && !v.repeat_weekday) e.repeat_weekday = t("announcements.validate.repeat");
    if ((v.repeat_mode === "monthly" || v.repeat_mode === "yearly") && !v.repeat_day) e.repeat_day = t("announcements.validate.repeat");
    if (v.repeat_mode === "yearly" && !v.repeat_month) e.repeat_month = t("announcements.validate.repeat");
    setErrors(e);
    if (Object.keys(e).length) return;
    const fd = new FormData();
    fd.set("title", v.title.trim());
    fd.set("body", v.body.trim());
    fd.set("level", v.level);
    fd.set("is_active", v.is_active ? "1" : "0");
    fd.set("starts_on", v.starts_on);
    fd.set("ends_on", v.ends_on);
    fd.set("sort_order", v.sort_order || "0");
    fd.set("repeat_mode", v.repeat_mode);
    fd.set("repeat_weekday", v.repeat_weekday);
    fd.set("repeat_day", v.repeat_day);
    fd.set("repeat_month", v.repeat_month);
    if (cover[0]) fd.set("cover", cover[0]);
    else if (removeCover) fd.set("remove_cover", "1");
    files.forEach((f) => fd.append("files[]", f));
    removedFiles.forEach((id) => fd.append("remove_file_ids[]", String(id)));
    start(async () => {
      const res = await saveAnnouncement(editing?.id ?? null, fd);
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
  const onFileError = (message: string) => setFeedback({ ok: false, text: message });
  const label = (id: string, text: string, required = false) => (
    <label htmlFor={id} className="mb-1 block text-sm font-medium">
      {text}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );
  const existingCover = editing?.cover_url && !removeCover && cover.length === 0 ? editing.cover_url : null;
  const existingFiles = editing?.files.filter((f) => !removedFiles.includes(f.id)) ?? [];
  /** ช่วงที่แสดง · การทำซ้ำ · ลำดับ · ผู้สร้าง */
  const metaOf = (a: Announcement) =>
    [
      a.starts_on || a.ends_on ? t("announcements.period", { from: a.starts_on ? fmt.date(a.starts_on) : "–", to: a.ends_on ? fmt.date(a.ends_on) : "–" }) : t("announcements.noPeriod"),
      repeatLabel(a, t),
      t("announcements.order", { n: String(a.sort_order) }),
      a.created_by?.name,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-5">
      {feedback?.text && <ResultToast result={feedback} />}
      {reading && <NewsReader title={reading.title} body={reading.body} cover={reading.cover_url} files={reading.files} meta={metaOf(reading)} onClose={() => setReading(null)} />}

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
              {label("title", t("announcements.form.title"), true)}
              <input id="title" maxLength={200} value={v.title} placeholder={t("announcements.form.titlePlaceholder")} onChange={(e) => set("title", e.target.value)} className={cls("title")} />
              {err("title")}
            </div>
            <div className="sm:col-span-2">
              {label("body", t("announcements.form.body"))}
              <RichTextEditor id="body" value={v.body} maxLength={BODY_MAX} onChange={(x) => set("body", x)} className={cls("body")} />
              {err("body")}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("announcements.form.cover")}</p>
              {existingCover ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
                  <img src={`/files${existingCover}`} alt="" className="h-24 w-40 rounded-xl object-cover ring-1 ring-line" />
                  <button type="button" onClick={() => setRemoveCover(true)} aria-label={t("announcements.form.removeCover")} className="absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-surface text-muted shadow ring-1 ring-line hover:text-danger-500">
                    <XIcon width={12} height={12} />
                  </button>
                </div>
              ) : (
                <PhotoPicker files={cover} onChange={setCover} max={1} onError={onFileError} />
              )}
              <p className="mt-1 text-xs text-muted">{t("announcements.form.coverHint")}</p>
              {err("cover")}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("announcements.form.files")}</p>
              {existingFiles.length > 0 && (
                <ul className="mb-2 space-y-1.5">
                  {existingFiles.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                      <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                        {f.name}
                      </a>
                      <button type="button" onClick={() => setRemovedFiles((x) => [...x, f.id])} aria-label={t("announcements.form.removeFile", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500">
                        <XIcon width={14} height={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DocumentPicker files={files} onChange={setFiles} max={FILES_MAX} onError={onFileError} />
              {err("files")}
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">{t("announcements.form.level")}</legend>
              <div className="flex flex-wrap gap-2">
                {ANNOUNCEMENT_LEVELS.map((l) => (
                  <label
                    key={l}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${v.level === l ? "bg-subtle ring-accent-300" : "ring-line hover:bg-subtle"}`}
                  >
                    <input type="radio" name="level" value={l} checked={v.level === l} onChange={() => set("level", l)} className="cursor-pointer accent-[var(--accent-500)]" />
                    <span className={`h-2.5 w-2.5 rounded-full ${LEVEL_TONE[l].dot}`} aria-hidden="true" />
                    {t(`announcements.levels.${l}`)}
                  </label>
                ))}
              </div>
              {err("level")}
            </fieldset>
            <div>
              {label("repeat_mode", t("announcements.form.repeat"))}
              <AppSelect id="repeat_mode" value={v.repeat_mode} onValueChange={(x) => set("repeat_mode", x as AnnouncementPayload["repeat_mode"])} className={cls("repeat_mode")}>
                {ANNOUNCEMENT_REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {t(`announcements.repeatModes.${r}`)}
                  </option>
                ))}
              </AppSelect>
              <p className="mt-1 text-xs text-muted">{t(v.repeat_mode === "none" ? "announcements.form.repeatNoneHint" : "announcements.form.repeatHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 self-start">
              {v.repeat_mode === "weekly" && (
                <div className="col-span-2">
                  {label("repeat_weekday", t("announcements.form.weekday"), true)}
                  <AppSelect id="repeat_weekday" value={v.repeat_weekday} onValueChange={(x) => set("repeat_weekday", x)} className={cls("repeat_weekday")}>
                    <option value="">{t("announcements.form.choose")}</option>
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {weekdayName(t, d)}
                      </option>
                    ))}
                  </AppSelect>
                  {err("repeat_weekday")}
                </div>
              )}
              {(v.repeat_mode === "monthly" || v.repeat_mode === "yearly") && (
                <div>
                  {label("repeat_day", t("announcements.form.day"), true)}
                  <AppSelect id="repeat_day" value={v.repeat_day} onValueChange={(x) => set("repeat_day", x)} className={cls("repeat_day")}>
                    <option value="">{t("announcements.form.choose")}</option>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </AppSelect>
                  {err("repeat_day")}
                </div>
              )}
              {v.repeat_mode === "yearly" && (
                <div>
                  {label("repeat_month", t("announcements.form.month"), true)}
                  <AppSelect id="repeat_month" value={v.repeat_month} onValueChange={(x) => set("repeat_month", x)} className={cls("repeat_month")}>
                    <option value="">{t("announcements.form.choose")}</option>
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {monthName(t, m)}
                      </option>
                    ))}
                  </AppSelect>
                  {err("repeat_month")}
                </div>
              )}
            </div>
            <div>
              {label("starts_on", t("announcements.form.startsOn"))}
              <DateInput id="starts_on" value={v.starts_on} onChange={(d) => set("starts_on", d)} className={cls("starts_on")} />
              {err("starts_on") ?? <p className="mt-1 text-xs text-muted">{t("announcements.form.dateHint")}</p>}
            </div>
            <div>
              {label("ends_on", t("announcements.form.endsOn"))}
              <DateInput id="ends_on" value={v.ends_on} min={v.starts_on || undefined} onChange={(d) => set("ends_on", d)} className={cls("ends_on")} />
              {err("ends_on")}
            </div>
            <div>
              {label("sort_order", t("announcements.form.sortOrder"))}
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
      ) : null}

      {/* แท็บ (ซ้าย) + ปุ่มเพิ่มประกาศ (ขวา) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex gap-1 rounded-xl bg-subtle p-1">
          {(["current", "past"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={TAB_CLS(tab === k)}>
              {t(`announcements.tabs.${k}`)}
              <span className="rounded-full bg-line/70 px-1.5 text-xs tabular-nums text-muted">{(k === "past" ? past : current).length}</span>
            </button>
          ))}
        </div>
        {!open && (
          <button type="button" onClick={() => openForm()} className={btn.primary}>
            <PlusIcon />
            {t("announcements.add")}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t(tab === "past" ? "announcements.emptyPast" : "announcements.empty")}</div>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((a) => {
            const state = showState(a, today);
            const ended = state === "ended";
            const isOpen = !ended && expanded === a.id;
            return (
              <li key={a.id} className={`relative overflow-hidden ${card}`}>
                <span className={`absolute inset-y-0 left-0 w-1 ${LEVEL_TONE[a.level].dot}`} aria-hidden="true" />
                <div className="flex items-center gap-2 py-2 pl-4 pr-3">
                  <button
                    type="button"
                    onClick={() => (ended ? setReading(a) : setExpanded(isOpen ? null : a.id))}
                    aria-expanded={ended ? undefined : isOpen}
                    aria-haspopup={ended ? "dialog" : undefined}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-1 text-left"
                  >
                    {!ended && <ChevronDownIcon width={16} height={16} className={`shrink-0 text-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />}
                    <span className="min-w-0 truncate font-medium">{a.title}</span>
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[state].badge}`}>{t(`announcements.states.${state}`)}</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {ended ? (
                      <>
                        <button type="button" onClick={() => setReading(a)} aria-label={t("announcements.viewDetails")} aria-haspopup="dialog" className={`${btn.secondary} ${btn.sm}`}>
                          <EyeIcon width={13} height={13} />
                          <span className="hidden sm:inline">{t("announcements.viewDetails")}</span>
                        </button>
                        <button type="button" onClick={() => openForm(a)} disabled={pending} className={`${btn.soft} ${btn.sm} disabled:cursor-not-allowed`}>
                          <ResetIcon width={13} height={13} />
                          {t("announcements.reuse")}
                        </button>
                      </>
                    ) : (
                      <Tooltip label={t("common.edit")}>
                        <button type="button" onClick={() => openForm(a)} disabled={pending} aria-label={t("common.edit")} className={ICON_BTN}>
                          <PencilIcon width={15} height={15} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip label={t("common.delete")}>
                      <button type="button" onClick={() => remove(a)} disabled={pending} aria-label={t("common.delete")} className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}>
                        {deleting === a.id ? <SpinnerIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
                      </button>
                    </Tooltip>
                  </span>
                </div>
                {isOpen && (
                  <div className="space-y-3 border-t border-line py-4 pl-5 pr-4">
                    {a.cover_url && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files */}
                        <img src={`/files${a.cover_url}`} alt="" className="aspect-video w-full max-w-md rounded-xl object-cover ring-1 ring-line" />
                      </>
                    )}
                    {a.body && <RichText text={a.body} className="text-sm text-muted" />}
                    {a.files.length > 0 && (
                      <ul className="space-y-1.5">
                        {a.files.map((f) => (
                          <li key={f.id}>
                            <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full cursor-pointer items-center gap-2 text-sm text-accent-700 hover:underline dark:text-accent-300">
                              <FileTextIcon width={15} height={15} className="shrink-0" />
                              <span className="truncate">{f.name}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-faint">{metaOf(a)}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
