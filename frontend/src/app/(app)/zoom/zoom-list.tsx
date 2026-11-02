"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptZoomBooking } from "@/app/actions/zoom";
import { useAlert } from "@/components/dialog-provider";
import { CheckCircleIcon, ExternalLinkIcon, EyeIcon, SpinnerIcon } from "@/components/icons";
import { btn, card, table } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { periodText } from "./zoom-utils";
import { ZoomStatusBadge } from "./zoom-ui";
import { CopyShare } from "./copy-share";

/**
 * รายการการจอง ZOOM — mode mine = การจองของฉัน (รายละเอียด / ผู้รับงาน / ลิงก์ / เหตุผลที่แจ้งกลับ),
 * mode manage = ฝ่าย IT (ผู้จอง + ปุ่มรับงานในแถว) — กดแถวไปหน้ารายละเอียด (ส่งลิงก์ / แจ้งกลับ)
 */
export function ZoomList({ items, mode }: { items: ZoomBooking[]; mode: "mine" | "manage" }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const showAlert = useAlert();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [, start] = useTransition();

  const accept = (z: ZoomBooking) => {
    setAccepting(z.id);
    start(async () => {
      const res = await acceptZoomBooking(z.id);
      setAccepting(null);
      if (!res.ok) return void (await showAlert(res.message ?? t("common.saveFailed")));
      router.push(`/zoom/bookings/${z.id}?done=accepted`);
    });
  };

  /** ผลของการจอง: ลิงก์ (ส่งแล้ว) / เหตุผล (แจ้งกลับ) / ผู้รับงาน */
  const outcome = (z: ZoomBooking) => (
    <div className="space-y-1 text-xs">
      {z.assignee && <p className="text-muted">{t("zoom.list.assignee", { name: z.assignee.name })}</p>}
      {z.status === "confirmed" && z.meeting_link && (
        <a href={z.meeting_link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-72 cursor-pointer items-center gap-1 truncate font-medium text-accent-600 hover:underline dark:text-accent-300">
          <ExternalLinkIcon width={12} height={12} className="shrink-0" />
          <span className="truncate">{z.meeting_link}</span>
        </a>
      )}
      {z.status === "rejected" && z.reject_reason && <p className="max-w-72 whitespace-normal text-danger-700 dark:text-danger-300">{z.reject_reason}</p>}
      {z.status === "pending" && <p className="text-muted">{t("zoom.detail.waiting")}</p>}
    </div>
  );
  const actions = (z: ZoomBooking) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {/* ส่งลิงก์แล้ว: คัดลอกข้อความเชิญไว้ส่งต่อ */}
      {z.status === "confirmed" && <CopyShare booking={z} small />}
      {mode === "manage" && z.can_accept && (
        <button type="button" onClick={() => accept(z)} disabled={accepting !== null} className={`${btn.primary} ${btn.sm} whitespace-nowrap`}>
          {accepting === z.id ? <SpinnerIcon width={14} height={14} /> : <CheckCircleIcon width={14} height={14} />}
          {t("zoom.actions.accept")}
        </button>
      )}
      <Link href={`/zoom/bookings/${z.id}`} className={`${mode === "manage" && z.can_link ? btn.primary : btn.secondary} ${btn.sm} whitespace-nowrap`}>
        <EyeIcon width={14} height={14} />
        {mode === "manage" && z.can_link && z.status === "accepted" ? t("zoom.actions.sendLink") : t("zoom.list.view")}
      </Link>
    </div>
  );

  return (
    <>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("zoom.detail.when")}</th>
              <th className={table.th}>{t("zoom.form.title")}</th>
              {mode === "manage" && <th className={table.th}>{t("zoom.detail.booker")}</th>}
              <th className={table.th}>{t("zoom.list.outcome")}</th>
              <th className={table.th} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((z) => (
              <tr key={z.id} className={table.row}>
                <td className={`${table.td} whitespace-nowrap`}>
                  <Link href={`/zoom/day/${z.start_on}`} className="cursor-pointer font-medium hover:text-accent-600 dark:hover:text-accent-300">
                    {periodText(z, fmt.date)}
                  </Link>
                  <span className="mt-1 block">
                    <ZoomStatusBadge booking={z} />
                  </span>
                </td>
                <td className={table.td}>
                  <span className="block font-medium">{z.title}</span>
                  {z.details && <span className="line-clamp-2 block max-w-md text-xs text-muted">{z.details}</span>}
                </td>
                {mode === "manage" && (
                  <td className={table.td}>
                    {z.user.name}
                    {z.department && <span className="block text-xs text-muted">{z.department}</span>}
                  </td>
                )}
                <td className={table.td}>{outcome(z)}</td>
                <td className={table.td}>{actions(z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map((z) => (
          <li key={z.id} className={`space-y-2 p-4 ${card}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-medium">{z.title}</p>
              <ZoomStatusBadge booking={z} />
            </div>
            <p className="text-sm">{periodText(z, fmt.date)}</p>
            {mode === "manage" && <p className="text-xs text-muted">{[z.user.name, z.department].filter(Boolean).join(" · ")}</p>}
            {z.details && <p className="line-clamp-3 text-xs text-muted">{z.details}</p>}
            {outcome(z)}
            {actions(z)}
          </li>
        ))}
      </ul>
    </>
  );
}
