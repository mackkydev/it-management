import Link from "next/link";
import { AlertIcon } from "@/components/icons";
import { alert } from "@/components/ui";
import type { TFunction } from "@/i18n/types";
import type { User } from "@/lib/types";

/**
 * เปิดบังคับลายเซ็น (ตั้งค่าระบบ) แต่ผู้ใช้ยังไม่มีลายเซ็นในโปรไฟล์ → แถบเตือนพร้อมลิงก์ไปตั้งลายเซ็น
 * ใช้ในหน้าแจ้งงาน / ยื่นใบลา / อนุมัติ (API ตอบ 422 eam.signature.required อยู่แล้ว — แถบนี้บอกล่วงหน้า)
 */
export function SignatureNotice({ user, t }: { user: User; t: TFunction }) {
  if (!user.signature_required || user.has_signature) return null;
  return (
    <p role="alert" className={`${alert.warning} flex-wrap`}>
      <AlertIcon className="shrink-0" />
      <span className="flex-1">{t("signatureNotice.text")}</span>
      <Link href="/profile" className="cursor-pointer font-medium underline underline-offset-2">
        {t("signatureNotice.link")}
      </Link>
    </p>
  );
}
