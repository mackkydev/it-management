"use client";

import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

/**
 * ช่องรหัสผ่านมาตรฐานของระบบ (ใช้แทน <input type="password"> ทุกที่) — มีปุ่มรูปตาสำหรับกดดู / ซ่อนรหัสที่พิมพ์
 * รับ props ของ <input> ได้ทั้งหมด (name, value, onChange, autoComplete ฯลฯ) — className ใช้กับช่องกรอก
 */
export function PasswordInput({
  className = "",
  wrapperClassName = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { /** class ของกล่องที่ครอบ (เช่น flex-1 เมื่ออยู่ในแถว flex) */ wrapperClassName?: string }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const label = show ? t("common.hidePassword") : t("common.showPassword");
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={label}
        aria-pressed={show}
        title={label}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted transition-colors hover:text-ink"
      >
        {show ? <EyeOffIcon width={16} height={16} /> : <EyeIcon width={16} height={16} />}
      </button>
    </div>
  );
}
