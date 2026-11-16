"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { receiveZoomLink } from "@/app/actions/zoom";
import { CheckCircleIcon, CheckIcon, CopyIcon, SpinnerIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { zoomShareText } from "./zoom-utils";

/**
 * ผู้จอง: ปุ่ม "กดรับ" อย่างเดียวก่อน (รับลิงก์ → แจ้งฝ่าย IT; ผู้จัดการ IT อนุมัติแล้ว = ปิดใบงานด้วย) — กดแล้วจึงเหลือปุ่ม "คัดลอกข้อความเชิญ"
 * ฝ่าย IT / ผู้จองที่กดรับแล้ว: คัดลอกข้อความเชิญประชุม (หัวข้อ / วันเวลา / ลิงก์ / Meeting ID / Passcode) ไว้ส่งต่อ
 */
export function CopyShare({ booking, small = false }: { booking: ZoomBooking; small?: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  if (!booking.meeting_link) return null;
  const size = small ? 14 : 16;
  const receive = Boolean(booking.can_receive_link && (!booking.link_received_at || booking.can_acknowledge));

  if (receive) {
    return (
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            const res = await receiveZoomLink(booking.id);
            toast(res.ok ? "success" : "error", res.ok ? t(booking.can_acknowledge ? "zoom.done.acknowledged" : "zoom.share.received") : (res.message ?? t("common.saveFailed")));
            if (res.ok) router.refresh();
          })
        }
        className={`${btn.primary} ${small ? btn.sm : ""} whitespace-nowrap disabled:cursor-not-allowed`}
      >
        {pending ? <SpinnerIcon width={size} height={size} /> : <CheckCircleIcon width={size} height={size} />}
        {t("zoom.actions.acknowledge")}
      </button>
    );
  }

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
      {copied ? <CheckIcon width={size} height={size} /> : <CopyIcon width={size} height={size} />}
      {copied ? t("zoom.share.copied") : t("zoom.share.copy")}
    </button>
  );
}
