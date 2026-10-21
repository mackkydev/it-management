import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeftIcon, CheckCircleIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleTimeline } from "../../day/[date]/vehicle-timeline";
import { daysOf, periodText } from "../../vehicle-utils";
import { ApprovalPanel } from "./approval-panel";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.approval.title") };
}

/** หน้าอนุมัติการจองรถ (ผู้จัดคิว): รายละเอียดคำขอ + คิวรถทุกคันของวันที่จอง (รวมรายการรออนุมัติ) + เลือก/เปลี่ยนรถ อนุมัติ / ไม่อนุมัติ */
export default async function VehicleApprovalPage({ params, searchParams }: PageProps<"/vehicles/dispatch/[id]">) {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.dispatch")) redirect("/vehicles");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let booking: VehicleBooking;
  try {
    booking = (await apiFetch<{ data: VehicleBooking }>(`/vehicle-bookings/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  // การจองหลายวัน: เลือกดูคิวทีละวัน (ตั้งต้น = วันแรก)
  const days = daysOf(booking);
  const day = days.find((d) => d === sp.day) ?? days[0];
  const [{ t, fmt }, vehicles, bookings] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from: booking.start_on, to: booking.end_on, include_pending: "1" })}`).then((r) => r.data),
  ]);
  const ofDay = bookings.filter((b) => b.start_on <= day && b.end_on >= day);
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CheckCircleIcon}
        title={t("vehicle.approval.title")}
        subtitle={booking.details}
        actions={
          <Link href="/vehicles/dispatch" className={btn.secondary}>
            <ChevronLeftIcon width={16} height={16} />
            {t("vehicle.approval.back")}
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className={`p-4 sm:p-5 ${card}`}>
          <dl className="divide-y divide-line">
            {row(t("vehicle.detail.when"), periodText(booking, fmt.date))}
            {row(t("meeting.detail.booker"), booking.user.name)}
            {row(t("meeting.detail.department"), booking.department || "-")}
            {booking.branch && row(t("tickets.form.branch"), booking.branch.name)}
            {row(t("vehicle.detail.passengers"), t("vehicle.detail.passengersValue", { n: fmt.number(booking.passengers) }))}
            {row(t("vehicle.detail.purpose"), booking.purpose || "-")}
            {row(t("vehicle.detail.extras"), booking.extras.length ? booking.extras.join(", ") : "-")}
            {booking.note && row(t("vehicle.detail.note"), <span className="whitespace-pre-line">{booking.note}</span>)}
            {row(t("vehicle.detail.vehicle"), booking.vehicle ? `${booking.vehicle.name}${booking.vehicle.plate_no ? ` · ${booking.vehicle.plate_no}` : ""}` : t("vehicle.unassigned"))}
          </dl>
        </section>

        {booking.can_approve ? (
          <ApprovalPanel booking={booking} vehicles={vehicles} others={bookings.filter((b) => b.id !== booking.id)} />
        ) : (
          <section className={`space-y-2 p-4 ${card}`}>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${booking.status === "rejected" ? tone.danger.badge : booking.status === "confirmed" ? tone.success.badge : tone.idle.badge}`}>
              {booking.status === "pending" || booking.status === "rejected" ? t(`vehicle.booking.statuses.${booking.status}`) : t(`meeting.booking.statuses.${booking.status}`)}
            </span>
            <p className="text-sm text-muted">{t("vehicle.approval.notPending")}</p>
            {booking.approved_by && <p className="text-sm">{`${t("vehicle.approval.approvedBy")}: ${booking.approved_by}`}</p>}
            {booking.reject_reason && <p className="text-sm">{t("vehicle.approval.rejectedNote", { reason: booking.reject_reason })}</p>}
          </section>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("vehicle.approval.queueTitle", { date: fmt.date(day) })}</h2>
            <p className="text-xs text-muted">{t("vehicle.approval.queueHint")}</p>
          </div>
          {days.length > 1 && (
            <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
              {days.map((d) => (
                <Link
                  key={d}
                  href={`/vehicles/dispatch/${booking.id}?day=${d}`}
                  aria-current={d === day ? "page" : undefined}
                  className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${d === day ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}
                >
                  {fmt.date(d)}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <VehicleTimeline key={day} date={day} vehicles={vehicles} bookings={ofDay} canDispatch bookable={false} highlight={booking.id} />
      </section>
    </div>
  );
}
