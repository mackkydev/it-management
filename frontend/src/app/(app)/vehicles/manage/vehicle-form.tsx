"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveVehicle, updateVehicleImage, uploadVehicleImages, type VehicleValues } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { AlertIcon, ImageIcon, SaveIcon, SpinnerIcon, StarIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vehicle } from "@/lib/types";
import { imageUrl } from "../vehicle-utils";

const MAX_IMAGES = 4;
const MAX_BYTES = 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

type Field = keyof VehicleValues | "images";
interface Pending {
  file: File;
  url: string;
}

/** เพิ่ม / แก้ไขรถ — รูป ≤ 4 รูป ≤ 1MB (เลือกรูปหลักได้), เลขไมล์ล่าสุด (อัปเดตอัตโนมัติจากการจอง) */
export function VehicleForm({ vehicle: initialVehicle, branches }: { vehicle: Vehicle | null; branches: { id: number; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const fileRef = useRef<HTMLInputElement>(null);
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [v, setV] = useState<VehicleValues>({
    name: initialVehicle?.name ?? "",
    plate_no: initialVehicle?.plate_no ?? "",
    branch_id: initialVehicle?.branch ? String(initialVehicle.branch.id) : "",
    seats: initialVehicle ? String(initialVehicle.seats) : "",
    parking: initialVehicle?.parking ?? "",
    description: initialVehicle?.description ?? "",
    mileage: initialVehicle?.mileage != null ? String(initialVehicle.mileage) : "",
    is_active: initialVehicle?.is_active ?? true,
    sort_order: String(initialVehicle?.sort_order ?? 0),
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [saving, startSave] = useTransition();
  const [imaging, startImage] = useTransition();

  const set = <K extends keyof VehicleValues>(k: K, value: VehicleValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const imageCount = (vehicle?.images.length ?? 0) + pending.length;

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    const left = MAX_IMAGES - imageCount;
    const bad = list.find((f) => !TYPES.includes(f.type)) ?? list.find((f) => f.size > MAX_BYTES);
    if (fileRef.current) fileRef.current.value = "";
    if (bad) return setErrors((e) => ({ ...e, images: t(TYPES.includes(bad.type) ? "meeting.rooms.imageTooBig" : "meeting.rooms.imageType", { name: bad.name }) }));
    if (list.length > left) return setErrors((e) => ({ ...e, images: t("meeting.rooms.imagesMax", { n: Math.max(0, left), max: MAX_IMAGES }) }));
    setErrors((e) => ({ ...e, images: undefined }));
    if (vehicle) return upload(vehicle.id, list);
    setPending((p) => [...p, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const upload = (id: number, files: File[]) =>
    startImage(async () => {
      const form = new FormData();
      files.forEach((f) => form.append("images", f, f.name));
      const res = await uploadVehicleImages(id, form);
      if (res.vehicle) setVehicle(res.vehicle);
      else setErrors((e) => ({ ...e, images: res.errors?.images ?? res.errors?.["images.0"] ?? res.message }));
    });
  const imageAction = async (imageId: number, action: "primary" | "delete") => {
    if (!vehicle || (action === "delete" && !(await confirm(t("meeting.rooms.confirmRemoveImage"))))) return;
    startImage(async () => {
      const res = await updateVehicleImage(vehicle.id, imageId, action);
      if (res.vehicle) setVehicle(res.vehicle);
      else await showAlert(res.message ?? t("common.saveFailed"));
    });
  };

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.name.trim()) e.name = t("vehicle.manage.validate.name");
    if (!(Number(v.seats) >= 1 && Number(v.seats) <= 99)) e.seats = t("vehicle.manage.validate.seats");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    startSave(async () => {
      const res = await saveVehicle(vehicle?.id ?? null, v);
      if (!res.ok || !res.vehicle) {
        setErrors(res.errors ?? {});
        setMessage(res.message ?? "");
        return;
      }
      if (pending.length) {
        const form = new FormData();
        pending.forEach((p) => form.append("images", p.file, p.file.name));
        const up = await uploadVehicleImages(res.vehicle.id, form);
        if (!up.ok) await showAlert(up.errors?.images ?? up.message ?? t("common.saveFailed"));
      }
      router.push("/vehicles/manage?done=1");
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;
  const photoButton = (labelKey: "meeting.rooms.setPrimary" | "meeting.rooms.removeImage", onClick: () => void, danger = false) => (
    <Tooltip label={t(labelKey)} side="top">
      <button
        type="button"
        disabled={imaging}
        onClick={onClick}
        aria-label={t(labelKey)}
        className={`cursor-pointer rounded-lg bg-surface/90 p-1.5 shadow-sm hover:bg-surface disabled:cursor-not-allowed ${danger ? "text-danger-600 dark:text-danger-300" : "text-warning-600 dark:text-warning-300"}`}
      >
        {danger ? <TrashIcon width={14} height={14} /> : <StarIcon width={14} height={14} />}
      </button>
    </Tooltip>
  );

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
          {label("name", t("vehicle.manage.name"), true)}
          <input id="name" maxLength={100} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder={t("vehicle.manage.namePlaceholder")} className={cls("name")} />
          {err("name")}
        </div>
        <div>
          {label("plate_no", t("vehicle.manage.plateNo"))}
          <input id="plate_no" maxLength={30} value={v.plate_no} onChange={(e) => set("plate_no", e.target.value)} className={cls("plate_no")} />
          {err("plate_no")}
        </div>
        <div>
          {label("seats", t("vehicle.manage.seats"), true)}
          <input id="seats" type="number" min={1} max={99} inputMode="numeric" value={v.seats} onChange={(e) => set("seats", e.target.value)} className={cls("seats")} />
          {err("seats")}
        </div>
        <div>
          {label("branch_id", t("meeting.rooms.branch"))}
          <AppSelect id="branch_id" value={v.branch_id} onValueChange={(x) => set("branch_id", x)} className={cls("branch_id")}>
            <option value="">{t("meeting.rooms.noBranch")}</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </AppSelect>
        </div>
        <div className="sm:col-span-2">
          {label("parking", t("vehicle.manage.parking"))}
          <input id="parking" maxLength={255} value={v.parking} onChange={(e) => set("parking", e.target.value)} placeholder={t("vehicle.manage.parkingPlaceholder")} className={cls("parking")} />
          {err("parking")}
        </div>
        <div>
          {label("mileage", t("vehicle.manage.mileage"))}
          <input id="mileage" type="number" min={0} inputMode="numeric" value={v.mileage} onChange={(e) => set("mileage", e.target.value)} className={cls("mileage")} />
          {err("mileage")}
          <p className="mt-1 text-xs text-muted">{t("vehicle.manage.mileageHint")}</p>
        </div>
        <div>
          {label("sort_order", t("meeting.rooms.sortOrder"))}
          <input id="sort_order" type="number" min={0} max={9999} value={v.sort_order} onChange={(e) => set("sort_order", e.target.value)} className={cls("sort_order")} />
        </div>
        <div className="sm:col-span-2">
          {label("description", t("vehicle.manage.description"))}
          <textarea id="description" rows={3} maxLength={2000} value={v.description} onChange={(e) => set("description", e.target.value)} className={cls("description")} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          {t("meeting.rooms.active")}
        </label>
      </fieldset>

      {/* รูปรถ */}
      <section className={`space-y-3 p-5 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <ImageIcon className="text-accent-500" />
              {t("vehicle.manage.images")}
              {imaging && <SpinnerIcon width={14} height={14} className="text-accent-400" />}
            </h2>
            <p className="text-xs text-muted">{t("meeting.rooms.imagesHint", { max: MAX_IMAGES })}</p>
            {!vehicle && pending.length > 0 && <p className="text-xs text-muted">{t("meeting.rooms.imagesAfterSave")}</p>}
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
            {vehicle?.images.map((img) => (
              <figure key={img.id} className={`relative overflow-hidden rounded-xl ring-2 ${img.is_primary ? "ring-accent-400" : "ring-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้ */}
                <img src={imageUrl(vehicle.id, img.id)} alt="" className="aspect-video w-full object-cover" />
                {img.is_primary && <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-medium text-white">{t("meeting.rooms.primary")}</figcaption>}
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  {!img.is_primary && photoButton("meeting.rooms.setPrimary", () => imageAction(img.id, "primary"))}
                  {photoButton("meeting.rooms.removeImage", () => imageAction(img.id, "delete"), true)}
                </div>
              </figure>
            ))}
            {pending.map((p, i) => (
              <figure key={p.url} className={`relative overflow-hidden rounded-xl ring-2 ${i === 0 ? "ring-accent-400" : "ring-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- พรีวิวไฟล์ในเครื่อง (blob:) */}
                <img src={p.url} alt="" className="aspect-video w-full object-cover opacity-80" />
                {i === 0 && <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-medium text-white">{t("meeting.rooms.primary")}</figcaption>}
                <div className="absolute right-1.5 top-1.5">{photoButton("meeting.rooms.removeImage", () => (URL.revokeObjectURL(p.url), setPending((list) => list.filter((x) => x !== p))), true)}</div>
              </figure>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.push("/vehicles/manage")} disabled={saving} className={btn.secondary}>
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
