"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { deleteLicenseIcon, uploadLicenseIcon } from "@/app/actions/licenses";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { KeyIcon, SpinnerIcon, UploadIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/i18n/client";

const MAX_BYTES = 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const SIZES = { md: { box: "h-12 w-12 rounded-xl", icon: 20 }, lg: { box: "h-14 w-14 rounded-2xl", icon: 26 } } as const;

/**
 * รูปโลโก้หน้าชื่อ License ซอฟต์แวร์ (แสดงตามสัดส่วนจริงในกรอบ) — ไม่มีรูป = ไอคอนกุญแจ
 * canEdit = คลิกเพื่ออัปโหลด/เปลี่ยน (รูป ≤ 1MB — API ย่อเป็น WebP 256px), removable = ปุ่ม × ลบไอคอน
 */
export function LicenseIcon({
  licenseId,
  iconId,
  name,
  canEdit = false,
  removable = false,
  size = "md",
}: {
  licenseId: string;
  iconId: number | null | undefined;
  name: string;
  canEdit?: boolean;
  removable?: boolean;
  size?: keyof typeof SIZES;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const showAlert = useAlert();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const s = SIZES[size];

  const face = iconId ? (
    // eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files (ไม่ใช้ next/image)
    <img src={`/files/licenses/${licenseId}/icon?v=${iconId}`} alt={name} className="h-full w-full object-contain p-1" />
  ) : (
    <KeyIcon width={s.icon} height={s.icon} />
  );
  const boxCls = `relative flex shrink-0 items-center justify-center overflow-hidden ${s.box} ${
    iconId ? "bg-surface ring-1 ring-line" : "bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300"
  }`;
  if (!canEdit) return <span className={boxCls}>{face}</span>;

  const onFile = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) return void showAlert(t("licenses.icon.invalid"));
    if (file.size > MAX_BYTES) return void showAlert(t("licenses.icon.tooLarge"));
    const form = new FormData();
    form.append("icon", file);
    start(async () => {
      const res = await uploadLicenseIcon(licenseId, form);
      if (!res.ok) return void (await showAlert(res.errors?.icon ?? res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };
  const remove = async () => {
    if (!(await confirm(t("licenses.icon.confirmDelete")))) return;
    start(async () => {
      const res = await deleteLicenseIcon(licenseId);
      if (!res.ok) return void (await showAlert(res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };

  return (
    <span className="relative shrink-0">
      <Tooltip label={t(iconId ? "licenses.icon.change" : "licenses.icon.upload")} side="top">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pending}
          aria-label={t(iconId ? "licenses.icon.change" : "licenses.icon.upload")}
          className={`group cursor-pointer disabled:cursor-not-allowed ${boxCls}`}
        >
          {face}
          <span
            className={`absolute inset-0 flex items-center justify-center bg-overlay text-white transition-opacity ${pending ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
          >
            {pending ? <SpinnerIcon /> : <UploadIcon width={16} height={16} />}
          </span>
        </button>
      </Tooltip>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {removable && iconId && (
        <Tooltip label={t("licenses.icon.delete")} side="top">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={t("licenses.icon.delete")}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-surface text-muted shadow ring-1 ring-line hover:text-danger-500 disabled:cursor-not-allowed"
          >
            <XIcon width={11} height={11} />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
