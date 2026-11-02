"use client";

import { tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { statusKey } from "./zoom-utils";

const BADGE = {
  pending: tone.warning.badge,
  accepted: tone.info.badge,
  confirmed: tone.success.badge,
  over: tone.idle.badge,
  rejected: tone.danger.badge,
  cancelled: tone.idle.badge,
} as const;

/** ป้ายสถานะการจอง ZOOM */
export function ZoomStatusBadge({ booking }: { booking: ZoomBooking }) {
  const { t } = useI18n();
  const key = statusKey(booking);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[key]}`}>{t(`zoom.statuses.${key}`)}</span>;
}
