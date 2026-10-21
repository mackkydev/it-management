import type { Metadata } from "next";
import Link from "next/link";
import { MeetingRoomIcon, PlusIcon } from "@/components/icons";
import { BranchFilter } from "@/components/branch-filter";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { branchQuery, getBookingScope, selectedBranch } from "@/lib/booking-scope";
import { getCurrentUser, has } from "@/lib/auth";
import { localToday } from "@/lib/date";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { BookingForm } from "../booking-form";
import { fromMin, TIME_OPTIONS, toMin } from "../meeting-utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.form.newTitle") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** จองห้องประชุม — เปิดจากปฏิทิน/ไทม์ไลน์ส่ง ?date=&room=&start=&end= มาเติมให้ */
export default async function BookMeetingRoomPage({ searchParams }: PageProps<"/meeting-rooms/book">) {
  const sp = await searchParams;
  const today = localToday();
  const date = DATE_RE.test(str(sp.date)) && str(sp.date) >= today ? str(sp.date) : today;
  const start = TIME_OPTIONS.includes(str(sp.start)) ? str(sp.start) : "09:00";
  // ไม่ระบุเวลาสิ้นสุด = เริ่ม + 1 ชม.
  const end = TIME_OPTIONS.includes(str(sp.end)) && str(sp.end) > start ? str(sp.end) : fromMin(Math.min(toMin(start) + 60, 22 * 60));
  // ขอบเขตตามสาขา (ตั้งต่อกลุ่มสิทธิ์) + สาขาที่เลือกดู — API กรองให้
  const scope = await getBookingScope("meeting");
  const branch = await selectedBranch("meeting", scope);
  const [{ t }, user, rooms, purposes, equipment, day] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: MeetingRoom[] }>(`/meeting-rooms?${new URLSearchParams(branchQuery(branch))}`).then((r) => r.data),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/meeting_purpose").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/meeting_equipment").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings?${new URLSearchParams({ from: date, to: date, ...branchQuery(branch) })}`).then((r) => r.data),
  ]);
  const room = rooms.some((r) => String(r.id) === str(sp.room)) ? str(sp.room) : rooms.length === 1 ? String(rooms[0].id) : "";

  return (
    <div className="space-y-5">
      <PageHeader icon={MeetingRoomIcon} title={t("meeting.form.newTitle")} subtitle={t("meeting.form.subtitle")} />
      <BranchFilter kind="meeting" meta={scope} value={branch} />
      {rooms.length === 0 ? (
        <div className={`space-y-3 p-10 text-center text-muted ${card}`}>
          <p>{t("meeting.noRooms")}</p>
          {has(user, "meeting.rooms") && (
            <Link href="/meeting-rooms/rooms/new" className={btn.primary}>
              <PlusIcon />
              {t("meeting.noRoomsManage")}
            </Link>
          )}
        </div>
      ) : (
        <BookingForm
          id={null}
          initial={{ room_id: room, title: "", attendees: "", purpose: purposes.length === 1 ? purposes[0] : "", equipment: [], note: "", date, end_date: date, start_time: start, end_time: end }}
          initialDay={day}
          rooms={rooms}
          purposes={purposes}
          equipment={equipment}
          booker={{ name: user?.name ?? "", department: user?.department ?? null }}
        />
      )}
    </div>
  );
}
