import type { Metadata } from "next";
import Link from "next/link";
import { MeetingRoomIcon, PlusIcon } from "@/components/icons";
import { BranchFilter } from "@/components/branch-filter";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { branchQuery, getBookingScope, selectedBranch } from "@/lib/booking-scope";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { monthGrid } from "../calendar/calendar-grid";
import { MeetingCalendar } from "./meeting-calendar";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.title") };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ปฏิทินห้องประชุม (หน้าแรกของระบบจองห้อง) — ทุกคนเห็นการจองของทุกห้อง */
export default async function MeetingRoomsPage({ searchParams }: PageProps<"/meeting-rooms">) {
  const params = await searchParams;
  const month = typeof params.month === "string" && MONTH_RE.test(params.month) ? params.month : localToday().slice(0, 7);
  const { from, to } = monthGrid(month);
  // ขอบเขตตามสาขา (ตั้งต่อกลุ่มสิทธิ์) + สาขาที่เลือกดู — API กรองให้
  const scope = await getBookingScope("meeting");
  const branch = await selectedBranch("meeting", scope);
  const [{ t }, user, rooms, bookings, can] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: MeetingRoom[] }>(`/meeting-rooms?${new URLSearchParams(branchQuery(branch))}`).then((r) => r.data),
    apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings?${new URLSearchParams({ from, to, ...branchQuery(branch) })}`).then((r) => r.data),
    getAccess(),
  ]);
  const canBook = can("btn:meeting:book");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MeetingRoomIcon}
        title={t("meeting.title")}
        subtitle={t("meeting.subtitle")}
        actions={
          canBook && (
            <Link href="/meeting-rooms/book" className={btn.primary}>
              <PlusIcon />
      <BranchFilter kind="meeting" meta={scope} value={branch} />
              {t("meeting.book")}
            </Link>
          )
        }
      />
      {/* ยังไม่มีห้อง: แจ้งเป็นแถบด้านบน — ปฏิทินแสดงเสมอ */}
      {rooms.length === 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted ${card}`}>
          {t("meeting.noRooms")}
          {has(user, "meeting.rooms") && can("btn:meeting:room-create") && (
            <Link href="/meeting-rooms/rooms/new" className={`${btn.primary} ${btn.sm}`}>
              <PlusIcon width={14} height={14} />
              {t("meeting.noRoomsManage")}
            </Link>
          )}
        </div>
      )}
      <MeetingCalendar month={month} initialBookings={bookings} rooms={rooms} canBook={canBook} />
    </div>
  );
}
