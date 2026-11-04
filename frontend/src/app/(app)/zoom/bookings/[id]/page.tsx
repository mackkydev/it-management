import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AlertIcon, CalendarIcon, ChevronLeftIcon, ExternalLinkIcon, VideoIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/toast";
import { alert, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { ApiError, apiFetch } from "@/lib/api";
import type { ZoomBooking } from "@/lib/types";
import { periodText } from "../../zoom-utils";
import { ZoomStatusBadge } from "../../zoom-ui";
import { CopyShare } from "../../copy-share";
import { CopyLink } from "./copy-link";
import { ZoomActions } from "./zoom-actions";

const DONE = ["created", "updated", "resubmitted", "accepted", "linked", "link_updated", "busy", "acknowledged", "cancelled"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("zoom.detail.title") };
}

function Item({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line font-medium text-ink">{children || "-"}</dd>
    </div>
  );
}

/** รายละเอียดการจอง ZOOM — สถานะ / ลิงก์ประชุม (ผู้จอง + ฝ่าย IT) / เหตุผลที่แจ้งกลับ + ปุ่มตามสิทธิ์ */
export default async function ZoomBookingPage({ params, searchParams }: PageProps<"/zoom/bookings/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let z: ZoomBooking;
  try {
    z = (await apiFetch<{ data: ZoomBooking }>(`/zoom-bookings/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [{ t, fmt }, accounts] = await Promise.all([
    getI18n(),
    // ตัวเลือกบัญชี ZOOM (ข้อมูล Drop Down) — โหลดเมื่อส่งลิงก์ได้
    z.can_link ? apiFetch<{ data: { name: string }[] }>("/dropdown-options/zoom_account").then((r) => r.data.map((o) => o.name)) : Promise.resolve([] as string[]),
  ]);
  const done = DONE.find((d) => d === sp.done);

  return (
    <div className="space-y-5">
      <Link href={`/zoom/day/${z.start_on}`} className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeftIcon width={14} height={14} />
        {t("zoom.detail.backToDay")}
      </Link>
      <PageHeader icon={VideoIcon} title={z.title} subtitle={periodText(z, fmt.date)} actions={<ZoomStatusBadge booking={z} />} />
      {done && <FlashToast param="done" message={t(`zoom.done.${done}` as MessageKey)} />}

      {/* ลิงก์ประชุม (ส่งแล้ว) / ฝ่าย IT แจ้งว่ามีการใช้งานแล้ว */}
      {z.status === "confirmed" && z.meeting_link && (
        <section className={`space-y-2 p-4 sm:p-5 ${card}`}>
          <h2 className="flex items-center gap-2 font-semibold">
            <VideoIcon width={16} height={16} className="text-success-500" />
            {t("zoom.detail.link")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <a href={z.meeting_link} target="_blank" rel="noopener noreferrer" className="min-w-0 cursor-pointer break-all font-medium text-accent-600 underline-offset-2 hover:underline dark:text-accent-300">
              {z.meeting_link}
            </a>
            <a href={z.meeting_link} target="_blank" rel="noopener noreferrer" className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${tone.success.badge}`}>
              <ExternalLinkIcon width={13} height={13} />
              {t("zoom.detail.open")}
            </a>
            <CopyLink link={z.meeting_link} />
          </div>
          <dl className="grid grid-cols-1 gap-3 rounded-lg bg-subtle px-3 py-2.5 text-sm sm:grid-cols-3">
            <Item label={t("zoom.actions.topic")}>{z.meeting_topic || z.title}</Item>
            <Item label={t("zoom.actions.meetingId")}>{z.meeting_id}</Item>
            <Item label={t("zoom.actions.passcode")}>{z.passcode}</Item>
          </dl>
          {/* คัดลอกข้อความเชิญ (หัวข้อ / วันเวลา / ลิงก์ / Meeting ID / Passcode) ไว้ส่งต่อ */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <CopyShare booking={z} />
            <p className="text-xs text-muted">{t("zoom.share.hint")}</p>
          </div>
        </section>
      )}
      {z.status === "rejected" && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {t("zoom.detail.rejected", { reason: z.reject_reason ?? "-" })}
        </p>
      )}

      {z.status === "needs_change" && (
        <p role="alert" className={alert.warning}>
          <AlertIcon className="shrink-0" />
          {t(z.can_edit ? "zoom.detail.needsChange" : "zoom.detail.needsChangeIt", { reason: z.reject_reason ?? "-" })}
        </p>
      )}

      <section className={`p-4 sm:p-5 ${card}`}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Item label={t("zoom.detail.when")}>
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon width={14} height={14} className="text-accent-500" />
              {periodText(z, fmt.date)}
            </span>
          </Item>
          <Item label={t("zoom.detail.booker")}>{[z.user.name, z.department].filter(Boolean).join(" · ")}</Item>
          <Item label={t("zoom.detail.details")} wide>
            {z.details}
          </Item>
          <Item label={t("zoom.detail.createdAt")}>{z.created_at ? fmt.dateTime(z.created_at) : "-"}</Item>
          <Item label={t("zoom.detail.assignee")}>{z.assignee ? `${z.assignee.name}${z.accepted_at ? ` (${fmt.dateTime(z.accepted_at)})` : ""}` : t("zoom.detail.waiting")}</Item>
          {z.zoom_account && <Item label={t("zoom.actions.account")}>{z.zoom_account}</Item>}
          {z.confirmed_at && <Item label={t("zoom.detail.confirmedAt")}>{`${fmt.dateTime(z.confirmed_at)}${z.confirmed_by ? ` · ${z.confirmed_by}` : ""}`}</Item>}
          {z.rejected_at && <Item label={t("zoom.detail.rejectedAt")}>{`${fmt.dateTime(z.rejected_at)}${z.rejected_by ? ` · ${z.rejected_by}` : ""}`}</Item>}
          {z.cancelled_at && <Item label={t("zoom.detail.cancelledAt")}>{fmt.dateTime(z.cancelled_at)}</Item>}
          {z.ticket && (
            <Item label={t("zoom.detail.ticket")}>
              <Link href={`/tickets/${z.ticket.id}`} className="cursor-pointer text-accent-600 hover:underline dark:text-accent-300">
                {z.ticket.ticket_no}
              </Link>
              <span className="ml-2 text-xs font-normal text-muted">{t(`zoom.ticketStatus.${z.ticket.status}` as MessageKey)}</span>
            </Item>
          )}
          {z.head_approval && (
            <Item label={t("zoom.detail.headApproved")}>
              <span className="block">{`${z.head_approval.name}${z.head_approval.at ? ` · ${fmt.dateTime(z.head_approval.at)}` : ""}`}</span>
              {z.head_approval.signature_url && (
                // eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
                <img src={z.head_approval.signature_url} alt={z.head_approval.name} className="mt-1 h-12 w-auto rounded bg-white p-1 ring-1 ring-line" />
              )}
            </Item>
          )}
        </dl>
      </section>

      <ZoomActions key={`${z.status}-${z.updated_at}`} booking={z} accounts={accounts} />
    </div>
  );
}
