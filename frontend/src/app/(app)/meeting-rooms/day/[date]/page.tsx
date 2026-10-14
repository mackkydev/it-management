import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, MeetingRoomIcon, PlusIcon } from "@/components/icons";
import { BranchFilter } from "@/components/branch-filter";
import { PageHeader } from "@/components/page-header";
import { alert, btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { branchQuery, getBookingScope, selectedBranch } from "@/lib/booking-scope";
import { getAccess } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { shiftDay } from "../../meeting-utils";
import { DayTimeline } from "./day-timeline";

export async function generateMetadata({ params }: PageProps<"/meeting-rooms/day/[date]">): Promise<Metadata> {
  const [{ t, fmt }, { date }] = await Promise.all([getI18n(), params]);
  return { title: t("meeting.dayTitle", { date: DATE_RE.test(date) ? fmt.date(date) : date }) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DONE = ["created", "updated"] as const;

/** การจองของวัน — ไทม์ไลน์แถวละ 1 ห้อง */
export default async function MeetingDayPage({ params, searchParams }: PageProps<"/meeting-rooms/day/[date]">) {
  const [{ date }, sp] = await Promise.all([params, searchParams]);
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) notFound();
  // ขอบเขตตามสาขา (ตั้งต่อกลุ่มสิทธิ์) + สาขาที่เลือกดู — API กรองให้
  const scope = await getBookingScope("meeting");
  const branch = await selectedBranch("meeting", scope);
  const [{ t, fmt }, rooms, bookings, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: MeetingRoom[] }>(`/meeting-rooms?${new URLSearchParams(branchQuery(branch))}`).then((r) => r.data),
    apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings?${new URLSearchParams({ from: date, to: date, ...branchQuery(branch) })}`).then((r) => r.data),
    getAccess(),
  ]);
  const canBook = can("btn:meeting:book");
  const done = DONE.find((d) => d === sp.done);
  const past = date < localToday();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MeetingRoomIcon}
        title={t("meeting.dayTitle", { date: fmt.date(date) })}
        subtitle={t("meeting.daySubtitle")}
        actions={
          !past &&
          canBook && (
            <Link href={`/meeting-rooms/book?date=${date}`} className={btn.primary}>
              <PlusIcon />
      <BranchFilter kind="meeting" meta={scope} value={branch} />
              {t("meeting.book")}
            </Link>
          )
        }
      />
      {done && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t(done === "created" ? "meeting.booking.created" : "meeting.booking.updated")}
        </p>
      )}
      <div className={`flex flex-wrap items-center gap-2 p-3 ${card}`}>
        <Link href={`/meeting-rooms?month=${date.slice(0, 7)}`} className={`${btn.secondary} ${btn.sm}`}>
          <CalendarIcon width={14} height={14} />
          {t("meeting.backToMonth")}
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/meeting-rooms/day/${shiftDay(date, -1)}`} aria-label={t("meeting.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          <Link href={`/meeting-rooms/day/${localToday()}`} className={`${btn.secondary} ${btn.sm}`}>
            {t("meeting.today")}
          </Link>
          <Link href={`/meeting-rooms/day/${shiftDay(date, 1)}`} aria-label={t("meeting.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={16} height={16} />
          </Link>
        </div>
      </div>
      {rooms.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t("meeting.noRooms")}</div> : <DayTimeline key={date} date={date} rooms={rooms} bookings={bookings} bookable={canBook} />}
    </div>
  );
}
