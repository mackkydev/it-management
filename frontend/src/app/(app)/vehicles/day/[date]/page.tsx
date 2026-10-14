import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarIcon, CarIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert, btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { shiftDay } from "../../vehicle-utils";
import { VehicleTimeline } from "./vehicle-timeline";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DONE = ["created", "updated"] as const;

export async function generateMetadata({ params }: PageProps<"/vehicles/day/[date]">): Promise<Metadata> {
  const [{ t, fmt }, { date }] = await Promise.all([getI18n(), params]);
  return { title: t("vehicle.dayTitle", { date: DATE_RE.test(date) ? fmt.date(date) : date }) };
}

/** การจองรถของวัน — ไทม์ไลน์ 00:00–24:00 แถวละ 1 คัน */
export default async function VehicleDayPage({ params, searchParams }: PageProps<"/vehicles/day/[date]">) {
  const [{ date }, sp] = await Promise.all([params, searchParams]);
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) notFound();
  const [{ t, fmt }, user, vehicles, bookings, can] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings?${new URLSearchParams({ from: date, to: date })}`).then((r) => r.data),
    getAccess(),
  ]);
  const canBook = can("btn:vehicles:book");
  const done = DONE.find((d) => d === sp.done);
  const past = date < localToday();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CarIcon}
        title={t("vehicle.dayTitle", { date: fmt.date(date) })}
        subtitle={t("vehicle.daySubtitle")}
        actions={
          !past &&
          canBook && (
            <Link href={`/vehicles/book?date=${date}`} className={btn.primary}>
              <PlusIcon />
              {t("vehicle.book")}
            </Link>
          )
        }
      />
      {done && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t(done === "created" ? "vehicle.booking.created" : "vehicle.booking.updated")}
        </p>
      )}
      <div className={`flex flex-wrap items-center gap-2 p-3 ${card}`}>
        <Link href={`/vehicles?month=${date.slice(0, 7)}`} className={`${btn.secondary} ${btn.sm}`}>
          <CalendarIcon width={14} height={14} />
          {t("meeting.backToMonth")}
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/vehicles/day/${shiftDay(date, -1)}`} aria-label={t("meeting.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          <Link href={`/vehicles/day/${localToday()}`} className={`${btn.secondary} ${btn.sm}`}>
            {t("meeting.today")}
          </Link>
          <Link href={`/vehicles/day/${shiftDay(date, 1)}`} aria-label={t("meeting.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={16} height={16} />
          </Link>
        </div>
      </div>
      {vehicles.length === 0 && bookings.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vehicle.noVehicles")}</div>
      ) : (
        <VehicleTimeline key={date} date={date} vehicles={vehicles} bookings={bookings} canDispatch={has(user, "vehicle.dispatch")} bookable={canBook} />
      )}
    </div>
  );
}
