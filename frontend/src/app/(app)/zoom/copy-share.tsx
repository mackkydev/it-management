"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { zoomShareText } from "./zoom-utils";

/** คัดลอกข้อความเชิญประชุม (หัวข้อ / วันเวลา / ลิงก์ / Meeting ID / Passcode) ไว้ส่งต่อ — ผู้จองและฝ่าย IT */
export function CopyShare({ booking, small = false }: { booking: ZoomBooking; small?: boolean }) {
  const { t, fmt } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!booking.meeting_link) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(zoomShareText(booking, fmt.date, t));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={`${small ? `${btn.secondary} ${btn.sm}` : btn.primary} whitespace-nowrap`}
    >
      {copied ? <CheckIcon width={small ? 14 : 16} height={small ? 14 : 16} /> : <CopyIcon width={small ? 14 : 16} height={small ? 14 : 16} />}
      {copied ? t("zoom.share.copied") : t("zoom.share.copy")}
    </button>
  );
}
