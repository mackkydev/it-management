import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AlertIcon, VideoIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { ZoomBooking } from "@/lib/types";
import { ZoomForm } from "../../../zoom-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("zoom.form.editTitle") };
}

/** แก้ไขการจอง ZOOM — ผู้จองแก้ได้ก่อนฝ่าย IT รับงาน + เมื่อฝ่าย IT ส่งกลับให้แก้วันเวลา (บันทึก = ส่งกลับฝ่าย IT) */
export default async function EditZoomPage({ params }: PageProps<"/zoom/bookings/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let z: ZoomBooking;
  try {
    z = (await apiFetch<{ data: ZoomBooking }>(`/zoom-bookings/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  if (!z.can_edit) redirect(`/zoom/bookings/${id}`);
  const [{ t }, range] = await Promise.all([getI18n(), apiFetch<{ data: ZoomBooking[] }>(`/zoom-bookings?${new URLSearchParams({ from: z.start_on, to: z.end_on })}`).then((r) => r.data)]);

  return (
    <div className="space-y-5">
      <PageHeader icon={VideoIcon} title={t("zoom.form.editTitle")} subtitle={t("zoom.form.subtitle")} />
      {z.status === "needs_change" && (
        <p role="alert" className={alert.warning}>
          <AlertIcon className="shrink-0" />
          {t("zoom.detail.needsChange", { reason: z.reject_reason ?? "-" })}
        </p>
      )}
      <ZoomForm id={z.id} resubmit={z.status === "needs_change"} initial={{ title: z.title, details: z.details ?? "", start_on: z.start_on, start_time: z.start_time, end_on: z.end_on, end_time: z.end_time }} initialRange={range} />
    </div>
  );
}
