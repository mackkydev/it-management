"use client";

import { PermissionRequestPaper } from "@/components/permission-request-paper";
import { PrintModal } from "@/components/print-modal";
import { useI18n } from "@/i18n/client";
import type { PermissionCatalog } from "@/lib/types";

/** ปุ่ม "พิมพ์แบบฟอร์มขอสิทธิ์" (หน้าสิทธิ์ตามกลุ่ม / ตรวจสอบสิทธิ์) → A4 หน้าเดียวให้ผู้ใช้เลือกสิทธิ์แล้วส่งฝ่าย IT */
export function PermissionRequestPrint({ catalog }: { catalog: PermissionCatalog }) {
  const { t } = useI18n();
  return (
    <PrintModal label={t("permRequest.print")} title={t("permRequest.title")} fileName={t("permRequest.fileName")}>
      <PermissionRequestPaper catalog={catalog} />
    </PrintModal>
  );
}
