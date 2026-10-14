"use client";

import type { ReactNode } from "react";
import { useConfirm } from "@/components/dialog-provider";
import { useI18n } from "@/i18n/client";

/**
 * ลิงก์ส่งออกไฟล์ (Excel) ที่ถามยืนยันก่อนดาวน์โหลด — ใช้กับทุกปุ่ม export (ไฟล์ template ไม่ต้องถาม ใช้ <a> ปกติ)
 * กดยืนยันแล้วจึงไปที่ href (route handler ส่งไฟล์กลับมาเป็น attachment หน้าเดิมไม่เปลี่ยน)
 */
export function ConfirmDownload({ href, className, children, message }: { href: string; className?: string; children: ReactNode; message?: string }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  return (
    <a
      href={href}
      className={className}
      onClick={async (e) => {
        e.preventDefault();
        if (await confirm(message ?? t("common.confirmExport"), { title: t("common.confirmExportTitle"), confirmText: t("common.exportConfirm"), danger: false })) {
          window.location.assign(href);
        }
      }}
    >
      {children}
    </a>
  );
}
