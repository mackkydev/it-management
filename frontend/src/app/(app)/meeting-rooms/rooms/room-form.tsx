"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveRoom, updateRoomImage, uploadRoomImages, type RoomValues } from "@/app/actions/meeting";
import { AppSelect } from "@/components/app-select";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { AlertIcon, ImageIcon, PlusIcon, SaveIcon, SpinnerIcon, StarIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { BranchChoices, MeetingRoom } from "@/lib/types";
import { imageUrl } from "../meeting-utils";

const MAX_IMAGES = 4;
const MAX_BYTES = 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

type Field = keyof RoomValues | "images";
interface Pending {
  file: File;
  url: string;
}

/** เพิ่ม / แก้ไขห้องประชุม — แถวที่นั่ง (เพิ่มแถวได้) + รูป ≤ 4 รูป ≤ 1MB (เลือกรูปหลักได้) */
export function RoomForm({ room: initialRoom, choices }: { room: MeetingRoom | null; choices: BranchChoices }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const fileRef = useRef<HTMLInputElement>(null);
  const [room, setRoom] = useState(initialRoom);
  const [v, setV] = useState<RoomValues>({
    name: initialRoom?.name ?? "",
    // เพิ่มใหม่ = สาขาของผู้เพิ่ม (ขอบเขตสาขาตัวเองเลือกได้เฉพาะสาขาตัวเอง)
    branch_id: initialRoom ? (initialRoom.branch ? String(initialRoom.branch.id) : "") : choices.defaultId ? String(choices.defaultId) : "",
    location: initialRoom?.location ?? "",
    room_no: initialRoom?.room_no ?? "",
    description: initialRoom?.description ?? "",
    seats: initialRoom?.seats.length ? initialRoom.seats : [{ label: t("meeting.rooms.seatDefault"), count: 10 }],
    is_active: initialRoom?.is_active ?? true,
    sort_order: String(initialRoom?.sort_order ?? 0),
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [saving, startSave] = useTransition();
  const [imaging, startImage] = useTransition();

  const set = <K extends keyof RoomValues>(k: K, value: RoomValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setSeat = (i: number, patch: Partial<RoomValues["seats"][number]>) => set("seats", v.seats.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const capacity = v.seats.reduce((n, s) => n + (Number(s.count) || 0), 0);
  const imageCount = (room?.images.length ?? 0) + pending.length;

  /** เลือกรูป: ตรวจชนิด/ขนาด/จำนวน — ห้องที่บันทึกแล้วอัปโหลดทันที, ห้องใหม่รออัปโหลดหลังบันทึก */
  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    const left = MAX_IMAGES - imageCount;
    const bad = list.find((f) => !TYPES.includes(f.type)) ?? list.find((f) => f.size > MAX_BYTES);
    if (fileRef.current) fileRef.current.value = "";
    if (bad) return setErrors((e) => ({ ...e, images: t(TYPES.includes(bad.type) ? "meeting.rooms.imageTooBig" : "meeting.rooms.imageType", { name: bad.name }) }));
    if (list.length > left) return setErrors((e) => ({ ...e, images: t("meeting.rooms.imagesMax", { n: Math.max(0, left), max: MAX_IMAGES }) }));
    setErrors((e) => ({ ...e, images: undefined }));
    if (room) return upload(room.id, list);
    setPending((p) => [...p, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const upload = (id: number, files: File[]) =>
    startImage(async () => {
      const form = new FormData();
      files.forEach((f) => form.append("images", f, f.name));
      const res = await uploadRoomImages(id, form);
      if (res.room) setRoom(res.room);
      else setErrors((e) => ({ ...e, images: res.errors?.images ?? res.errors?.["images.0"] ?? res.message }));
    });
  const imageAction = async (imageId: number, action: "primary" | "delete") => {
    if (!room || (action === "delete" && !(await confirm(t("meeting.rooms.confirmRemoveImage"))))) return;
    startImage(async () => {
      const res = await updateRoomImage(room.id, imageId, action);
      if (res.room) setRoom(res.room);
      else await showAlert(res.message ?? t("common.saveFailed"));
    });
  };

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.name.trim()) e.name = t("meeting.rooms.validate.name");
    if (!v.seats.length || v.seats.some((s) => !s.label.trim() || !(Number(s.count) >= 1 && Number(s.count) <= 9999) || !Number.isInteger(Number(s.count)))) e.seats = t("meeting.rooms.validate.seats");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    startSave(async () => {
      const res = await saveRoom(room?.id ?? null, v);
      if (!res.ok || !res.room) {
        setErrors(res.errors ?? {});
        setMessage(res.message ?? "");
        return;
      }
      // ห้องใหม่: อัปโหลดรูปที่เลือกไว้หลังได้ id
      if (pending.length) {
        const form = new FormData();
        pending.forEach((p) => form.append("images", p.file, p.file.name));
        const up = await uploadRoomImages(res.room.id, form);
        if (!up.ok) await showAlert(up.errors?.images ?? up.message ?? t("common.saveFailed"));
      }
      router.push("/meeting-rooms/rooms?done=1");
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={saving} className={`grid grid-cols-1 gap-4 p-5 disabled:opacity-60 sm:grid-cols-2 ${card}`}>
        <div>
          {label("name", t("meeting.rooms.name"), true)}
          <input id="name" maxLength={100} value={v.name} onChange={(e) => set("name", e.target.value)} className={cls("name")} />
          {err("name")}
        </div>
        <div>
          {label("branch_id", t("meeting.rooms.branch"))}
          <AppSelect id="branch_id" value={v.branch_id} onValueChange={(x) => set("branch_id", x)} className={cls("branch_id")}>
            {choices.allowShared && <option value="">{t("meeting.rooms.noBranch")}</option>}
            {choices.branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </AppSelect>
          {err("branch_id")}
        </div>
        <div>
          {label("location", t("meeting.rooms.location"))}
          <input id="location" maxLength={255} value={v.location} onChange={(e) => set("location", e.target.value)} placeholder={t("meeting.rooms.locationPlaceholder")} className={cls("location")} />
          {err("location")}
        </div>
        <div>
          {label("room_no", t("meeting.rooms.roomNo"))}
          <input id="room_no" maxLength={50} value={v.room_no} onChange={(e) => set("room_no", e.target.value)} className={cls("room_no")} />
          {err("room_no")}
        </div>

        {/* จำนวนที่นั่ง (หลายแถว) */}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 flex w-full flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
            <span>
              {t("meeting.rooms.seats")} <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-muted">{t("meeting.rooms.seatsHint")}</span>
            </span>
            <span className="text-xs font-normal text-muted">{t("meeting.rooms.capacity", { n: capacity })}</span>
          </legend>
          <div className="space-y-2">
            {v.seats.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* input เป็น w-full — ครอบด้วยกล่องกำหนดความกว้าง */}
                <div className="min-w-0 flex-1">
                  <input aria-label={t("meeting.rooms.seatLabel")} placeholder={t("meeting.rooms.seatLabel")} maxLength={50} value={s.label} onChange={(e) => setSeat(i, { label: e.target.value })} className={cls("seats")} />
                </div>
                <div className="w-28 shrink-0">
                  <input
                    aria-label={t("meeting.rooms.seatCount")}
                    placeholder={t("meeting.rooms.seatCount")}
                    type="number"
                    min={1}
                    max={9999}
                    inputMode="numeric"
                    value={s.count || ""}
                    onChange={(e) => setSeat(i, { count: Number(e.target.value) })}
                    className={cls("seats")}
                  />
                </div>
                <Tooltip label={t("meeting.rooms.removeSeat")} side="top">
                  <button type="button" disabled={v.seats.length === 1} onClick={() => set("seats", v.seats.filter((_, n) => n !== i))} aria-label={t("meeting.rooms.removeSeat")} className={`${btn.danger} ${btn.sm} px-2`}>
                    <TrashIcon width={14} height={14} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
          {err("seats")}
          {v.seats.length < 10 && (
            <button type="button" onClick={() => set("seats", [...v.seats, { label: v.seats.length === 1 ? t("meeting.rooms.seatSpare") : "", count: 0 }])} className={`${btn.secondary} ${btn.sm} mt-2`}>
              <PlusIcon width={14} height={14} />
              {t("meeting.rooms.addSeat")}
            </button>
          )}
        </fieldset>

        <div className="sm:col-span-2">
          {label("description", t("meeting.rooms.description"))}
          <textarea id="description" rows={3} maxLength={2000} value={v.description} onChange={(e) => set("description", e.target.value)} className={cls("description")} />
        </div>
        <div>
          {label("sort_order", t("meeting.rooms.sortOrder"))}
          <input id="sort_order" type="number" min={0} max={9999} value={v.sort_order} onChange={(e) => set("sort_order", e.target.value)} className={cls("sort_order")} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          {t("meeting.rooms.active")}
        </label>
      </fieldset>

      {/* รูปห้อง */}
      <section className={`space-y-3 p-5 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <ImageIcon className="text-accent-500" />
              {t("meeting.rooms.images")}
              {imaging && <SpinnerIcon width={14} height={14} className="text-accent-400" />}
            </h2>
            <p className="text-xs text-muted">{t("meeting.rooms.imagesHint", { max: MAX_IMAGES })}</p>
            {!room && pending.length > 0 && <p className="text-xs text-muted">{t("meeting.rooms.imagesAfterSave")}</p>}
          </div>
          <input ref={fileRef} type="file" accept={TYPES.join(",")} multiple hidden onChange={(e) => pick(e.target.files)} />
          <button type="button" disabled={imageCount >= MAX_IMAGES || imaging || saving} onClick={() => fileRef.current?.click()} className={`${btn.secondary} ${btn.sm}`}>
            <UploadIcon width={14} height={14} />
            {t("meeting.rooms.addImages")}
          </button>
        </div>
        {err("images")}
        {imageCount > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {room?.images.map((img) => (
              <figure key={img.id} className={`relative overflow-hidden rounded-xl ring-2 ${img.is_primary ? "ring-accent-400" : "ring-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้ */}
                <img src={imageUrl(room.id, img.id)} alt="" className="aspect-video w-full object-cover" />
                {img.is_primary && <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-medium text-white">{t("meeting.rooms.primary")}</figcaption>}
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  {!img.is_primary && (
                    <Tooltip label={t("meeting.rooms.setPrimary")} side="top">
                      <button type="button" disabled={imaging} onClick={() => imageAction(img.id, "primary")} aria-label={t("meeting.rooms.setPrimary")} className="cursor-pointer rounded-lg bg-surface/90 p-1.5 text-warning-600 shadow-sm hover:bg-surface disabled:cursor-not-allowed dark:text-warning-300">
                        <StarIcon width={14} height={14} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label={t("meeting.rooms.removeImage")} side="top">
                    <button type="button" disabled={imaging} onClick={() => imageAction(img.id, "delete")} aria-label={t("meeting.rooms.removeImage")} className="cursor-pointer rounded-lg bg-surface/90 p-1.5 text-danger-600 shadow-sm hover:bg-surface disabled:cursor-not-allowed dark:text-danger-300">
                      <TrashIcon width={14} height={14} />
                    </button>
                  </Tooltip>
                </div>
              </figure>
            ))}
            {pending.map((p, i) => (
              <figure key={p.url} className={`relative overflow-hidden rounded-xl ring-2 ${i === 0 ? "ring-accent-400" : "ring-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- พรีวิวไฟล์ในเครื่อง (blob:) */}
                <img src={p.url} alt="" className="aspect-video w-full object-cover opacity-80" />
                {i === 0 && <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-medium text-white">{t("meeting.rooms.primary")}</figcaption>}
                <div className="absolute right-1.5 top-1.5">
                  <Tooltip label={t("meeting.rooms.removeImage")} side="top">
                    <button
                      type="button"
                      onClick={() => (URL.revokeObjectURL(p.url), setPending((list) => list.filter((x) => x !== p)))}
                      aria-label={t("meeting.rooms.removeImage")}
                      className="cursor-pointer rounded-lg bg-surface/90 p-1.5 text-danger-600 shadow-sm hover:bg-surface dark:text-danger-300"
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </Tooltip>
                </div>
              </figure>
            ))}
          </div>
        )}
        {!room && pending.length > 0 && <p className="text-xs text-muted">{t("meeting.rooms.pendingImages", { n: pending.length })}</p>}
      </section>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.push("/meeting-rooms/rooms")} disabled={saving} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={saving || imaging} className={btn.primary}>
          {saving ? <SpinnerIcon /> : <SaveIcon />}
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}
