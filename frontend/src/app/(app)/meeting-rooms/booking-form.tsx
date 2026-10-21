"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { loadBookings, saveBooking, type BookingValues } from "@/app/actions/meeting";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, CheckCircleIcon, MapPinIcon, MeetingRoomIcon, SaveIcon, SpinnerIcon, UsersIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { imageUrl, primaryImage, TIME_OPTIONS, timelineHours, toMin, toneOf } from "./meeting-utils";

type Field = keyof BookingValues;

/**
 * ฟอร์มจอง / แก้ไขการจองห้องประชุม — ผู้จอง + แผนก = ผู้ที่ login (แก้ไขของคนอื่น = คงผู้จองเดิม)
 * ตรวจห้อง/เวลาชนกับการจองอื่นทันทีที่เลือก (API ตรวจซ้ำตอนบันทึกเสมอ)
 */
export function BookingForm({
  id,
  initial,
  initialDay,
  rooms,
  purposes,
  equipment,
  booker,
}: {
  /** แก้ไข = uuid ของการจอง */
  id: string | null;
  initial: BookingValues;
  /** การจองของวันที่เริ่มต้น (ตรวจเวลาว่าง) */
  initialDay: MeetingBooking[];
  rooms: MeetingRoom[];
  purposes: string[];
  equipment: string[];
  booker: { name: string; department: string | null };
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<BookingValues>(initial);
  const [day, setDay] = useState(initialDay);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [checking, startCheck] = useTransition();
  const [pending, start] = useTransition();
  const today = localToday();

  const set = <K extends Field>(k: K, value: BookingValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  // วันเริ่ม/วันสิ้นสุด: วันสิ้นสุดก่อนวันเริ่ม = ขยับตาม (จองวันเดียว) — โหลดการจองของทุกวันในช่วงไว้ตรวจเวลาว่าง
  const loadRange = (from: string, to: string) => startCheck(async () => setDay(await loadBookings(from, to)));
  const setDate = (d: string) => {
    const end = !v.end_date || v.end_date < d ? d : v.end_date;
    setV((p) => ({ ...p, date: d, end_date: end }));
    setErrors((e) => ({ ...e, date: undefined, end_date: undefined }));
    if (d) loadRange(d, end);
  };
  const setEndDate = (d: string) => {
    const end = d && d >= v.date ? d : v.date;
    set("end_date", end);
    if (v.date) loadRange(v.date, end);
  };
  const multiDay = Boolean(v.end_date && v.end_date > v.date);

  const room = rooms.find((r) => String(r.id) === v.room_id) ?? null;
  // การจองอื่นของวันนั้น (ไม่นับตัวเอง)
  const others = day.filter((b) => b.id !== id);
  const timesOk = Boolean(v.start_time && v.end_time && v.end_time > v.start_time);
  const clashOf = (roomId: number) => (timesOk ? others.find((b) => b.room.id === roomId && b.start_time < v.end_time && b.end_time > v.start_time) : undefined);
  const clash = room ? clashOf(room.id) : undefined;
  const roomDay = room ? others.filter((b) => b.room.id === room.id) : [];
  const over = room && Number(v.attendees) > room.capacity;

  // เวลาที่มีอยู่แล้วแต่ไม่อยู่ในตัวเลือก (เช่น 09:15 จากข้อมูลเดิม) ยังเลือกค้างไว้ได้
  const timeOptions = [...new Set([...TIME_OPTIONS, initial.start_time, initial.end_time].filter(Boolean))].sort();

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.room_id) e.room_id = t("meeting.form.validate.room");
    if (!v.title.trim()) e.title = t("meeting.form.validate.title");
    if (!(Number(v.attendees) >= 1)) e.attendees = t("meeting.form.validate.attendees");
    if (!v.date) e.date = t("meeting.form.validate.date");
    if (v.end_date && v.end_date < v.date) e.end_date = t("meeting.form.validate.endDate");
    if (!v.start_time || !v.end_time) e.end_time = t("meeting.form.validate.time");
    else if (v.end_time <= v.start_time) e.end_time = t("meeting.form.validate.timeOrder");
    if (!v.purpose) e.purpose = t("meeting.form.validate.purpose");
    if (clash) e.start_time = t("meeting.form.validate.conflict");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveBooking(id, v);
      if (res.ok) return router.push(`/meeting-rooms/day/${v.date}?done=${id ? "updated" : "created"}`);
      setErrors(res.errors ?? {});
      setMessage(res.message ?? "");
      // อาจมีคนจองช่วงนี้ไปก่อน — โหลดการจองของวันนั้นใหม่
      startCheck(async () => setDay(await loadBookings(v.date, v.date)));
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;

  // แถบเวลาของห้องที่เลือกในวันนั้น + ช่วงที่กำลังจะจอง
  const [hFrom, hTo] = timelineHours([...roomDay, ...(timesOk ? [{ start_time: v.start_time, end_time: v.end_time }] : [])]);
  const span = (hTo - hFrom) * 60;
  const pct = (hm: string) => ((toMin(hm) - hFrom * 60) / span) * 100;
  const width = (s: string, e: string) => ((toMin(e) - toMin(s)) / span) * 100;

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={pending} className="grid grid-cols-1 gap-5 disabled:opacity-60 lg:grid-cols-[1fr_20rem]">
        <div className={`space-y-4 p-5 ${card}`}>
          {/* ห้อง + วันเวลา */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {label("room_id", t("meeting.form.room"), true)}
              <AppSelect id="room_id" value={v.room_id} onValueChange={(x) => set("room_id", x)} className={cls("room_id")}>
                <option value="">{t("meeting.form.roomPlaceholder")}</option>
                {rooms.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {`${r.name} · ${t("meeting.seats", { n: r.capacity })}${clashOf(r.id) ? ` — ${t("meeting.form.roomBusy")}` : ""}`}
                  </option>
                ))}
              </AppSelect>
              {err("room_id")}
            </div>
            <div>
              {label("date", t("meeting.form.date"), true)}
              <DateInput id="date" value={v.date} min={id ? undefined : today} onChange={setDate} className={cls("date")} />
              {err("date")}
            </div>
            <div>
              {label("end_date", t("meeting.form.endDate"))}
              <DateInput id="end_date" value={v.end_date} min={v.date || today} onChange={setEndDate} className={cls("end_date")} />
              {err("end_date")}
              {!errors.end_date && <p className="mt-1 text-xs text-muted">{t(multiDay ? "meeting.form.endDateMulti" : "meeting.form.endDateHint")}</p>}
            </div>
            <div>
              {label("start_time", t("meeting.form.start"), true)}
              <AppSelect
                id="start_time"
                value={v.start_time}
                onValueChange={(x) => {
                  set("start_time", x);
                  // เลื่อนเวลาเริ่ม → เวลาสิ้นสุดที่อยู่ก่อนเวลาเริ่มขยับตามเป็น +1 ชม.
                  if (!v.end_time || v.end_time <= x) set("end_time", timeOptions.find((o) => toMin(o) >= toMin(x) + 60) ?? timeOptions[timeOptions.length - 1]);
                }}
                className={cls("start_time")}
                options={timeOptions.map((o) => ({ value: o, label: o }))}
              />
              {err("start_time")}
            </div>
            <div>
              {label("end_time", t("meeting.form.end"), true)}
              <AppSelect id="end_time" value={v.end_time} onValueChange={(x) => set("end_time", x)} className={cls("end_time")} options={timeOptions.filter((o) => !v.start_time || o > v.start_time).map((o) => ({ value: o, label: o }))} />
              {err("end_time")}
            </div>
          </div>

          {/* เวลาว่างของห้องที่เลือก */}
          {room && v.date && (
            <div className="space-y-2 rounded-xl bg-subtle/60 p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-muted">
                {t(multiDay ? "meeting.form.rangeBookings" : "meeting.form.dayBookings")}
                {checking && <SpinnerIcon width={12} height={12} className="text-accent-400" />}
              </p>
              <div className="relative h-9 rounded-lg bg-surface ring-1 ring-line">
                {/* เส้นทุกครึ่งชั่วโมง (ชั่วโมงเต็มเข้มกว่า) */}
                {Array.from({ length: (hTo - hFrom) * 2 - 1 }, (_, i) => i + 1).map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`absolute inset-y-0 border-l ${i % 2 === 0 ? "border-line" : "border-dashed border-line-soft"}`}
                    style={{ left: `${((i * 30) / span) * 100}%` }}
                  />
                ))}
                {roomDay.map((b) => (
                  <span
                    key={b.id}
                    className={`absolute inset-y-1 truncate rounded px-1.5 text-[10px] font-medium leading-7 ring-1 ring-inset ${toneOf(rooms, room.id).bar}`}
                    style={{ left: `${pct(b.start_time)}%`, width: `${width(b.start_time, b.end_time)}%` }}
                  >
                    {b.start_time}–{b.end_time} {b.title}
                  </span>
                ))}
                {timesOk && (
                  <span
                    className={`absolute inset-y-0 rounded-lg border-2 border-dashed ${clash ? "border-danger-400 bg-danger-400/10" : "border-success-400 bg-success-400/10"}`}
                    style={{ left: `${pct(v.start_time)}%`, width: `${width(v.start_time, v.end_time)}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              {/* เวลาทุก 1 ชั่วโมง */}
              <div className="relative h-3 text-[10px] tabular-nums text-faint">
                {Array.from({ length: hTo - hFrom + 1 }, (_, i) => hFrom + i).map((h, i, all) => (
                  <span
                    key={h}
                    className={`absolute top-0 ${i === 0 ? "" : i === all.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                    style={{ left: `${((h - hFrom) * 60 * 100) / span}%` }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {checking ? (
                <p className="text-xs text-muted">{t("meeting.form.checking")}</p>
              ) : clash ? (
                <p role="alert" className={alert.warning}>
                  <AlertIcon className="shrink-0" />
                  {t("meeting.form.conflict", { room: room.name, start: clash.start_time, end: clash.end_time, title: clash.title, name: clash.user.name })}
                </p>
              ) : timesOk ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-success-700 dark:text-success-300">
                  <CheckCircleIcon width={14} height={14} />
                  {t("meeting.form.available")}
                </p>
              ) : roomDay.length === 0 ? (
                <p className="text-xs text-muted">{t("meeting.form.dayFree")}</p>
              ) : null}
            </div>
          )}

          {/* รายละเอียดการประชุม */}
          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {label("title", t("meeting.form.title"), true)}
              <input id="title" maxLength={255} value={v.title} onChange={(e) => set("title", e.target.value)} className={cls("title")} />
              {err("title")}
            </div>
            <div>
              {label("attendees", t("meeting.form.attendees"), true)}
              <input id="attendees" type="number" min={1} max={9999} inputMode="numeric" value={v.attendees} onChange={(e) => set("attendees", e.target.value)} className={cls("attendees")} />
              {err("attendees")}
              {over && <p className="mt-1 text-xs font-medium text-warning-700 dark:text-warning-300">{t("meeting.form.overCapacity", { n: v.attendees, seats: room!.capacity })}</p>}
            </div>
            <div>
              {label("purpose", t("meeting.form.purpose"), true)}
              <AppSelect id="purpose" value={v.purpose} onValueChange={(x) => set("purpose", x)} className={cls("purpose")}>
                <option value="">{t("meeting.form.purposePlaceholder")}</option>
                {[...new Set([...purposes, ...(initial.purpose ? [initial.purpose] : [])])].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </AppSelect>
              {err("purpose")}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">{t("meeting.form.booker")}</span>
              <p className={`${input} bg-subtle text-muted`}>{booker.name}</p>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">{t("meeting.form.department")}</span>
              <p className={`${input} bg-subtle text-muted`}>{booker.department || "-"}</p>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-sm font-medium">{t("meeting.form.equipment")}</legend>
              {equipment.length === 0 && initial.equipment.length === 0 ? (
                <p className="text-xs text-muted">{t("meeting.form.noEquipment")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...equipment, ...initial.equipment])].map((e) => {
                    const on = v.equipment.includes(e);
                    return (
                      <label
                        key={e}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm ring-1 transition-colors ${on ? "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/15 dark:text-accent-200 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set("equipment", on ? v.equipment.filter((x) => x !== e) : [...v.equipment, e])}
                          className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                        />
                        {e}
                      </label>
                    );
                  })}
                </div>
              )}
              {err("equipment")}
            </fieldset>
            <div className="sm:col-span-2">
              {label("note", t("meeting.form.note"))}
              <textarea id="note" rows={3} maxLength={2000} value={v.note} onChange={(e) => set("note", e.target.value)} placeholder={t("meeting.form.notePlaceholder")} className={cls("note")} />
            </div>
          </div>
        </div>

        {/* ข้อมูลห้องที่เลือก */}
        <aside className={`h-fit space-y-3 overflow-hidden ${card}`}>
          {room ? (
            <>
              {primaryImage(room) ? (
                // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
                <img src={imageUrl(room.id, primaryImage(room)!.id)} alt={room.name} className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-subtle text-faint">
                  <MeetingRoomIcon width={40} height={40} />
                </div>
              )}
              <div className="space-y-1.5 px-4 pb-4 text-sm">
                <p className="font-semibold">{room.name}</p>
                {(room.location || room.room_no) && (
                  <p className="flex items-center gap-1.5 text-muted">
                    <MapPinIcon width={14} height={14} className="shrink-0" />
                    {[room.location, room.room_no].filter(Boolean).join(" · ")}
                  </p>
                )}
                {room.seats.map((s) => (
                  <p key={s.label} className="flex items-center gap-1.5 text-muted">
                    <UsersIcon width={14} height={14} className="shrink-0" />
                    {s.label}: {fmt.number(s.count)}
                  </p>
                ))}
                {room.description && <p className="whitespace-pre-line pt-1 text-xs text-muted">{room.description}</p>}
              </div>
            </>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-subtle text-sm text-faint">
              <MeetingRoomIcon width={36} height={36} />
              {t("meeting.form.roomPlaceholder")}
            </div>
          )}
        </aside>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("meeting.form.save")}
        </button>
      </div>
    </form>
  );
}
