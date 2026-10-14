import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MeetingRoomIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import type { MeetingBooking, MeetingRoom } from "@/lib/types";
import { BookingForm } from "../../../booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.form.editTitle") };
}

/** แก้ไขการจอง — เจ้าของ หรือผู้มีสิทธิ์ meeting.manage_any (ยกเลิกแล้ว / เลยเวลา = แก้ไม่ได้) */
export default async function EditMeetingBookingPage({ params }: PageProps<"/meeting-rooms/bookings/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const booking = await apiFetch<{ data: MeetingBooking }>(`/meeting-bookings/${id}`)
    .then((r) => r.data)
    .catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  if (!booking.can_edit) redirect(`/meeting-rooms/day/${booking.date}`);
  const [{ t }, rooms, purposes, equipment, day] = await Promise.all([
    getI18n(),
    apiFetch<{ data: MeetingRoom[] }>("/meeting-rooms").then((r) => r.data),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/meeting_purpose").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/meeting_equipment").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings?${new URLSearchParams({ from: booking.date, to: booking.date })}`).then((r) => r.data),
  ]);
  // ห้องที่ถูกปิดใช้งานภายหลัง — ยังแสดงห้องเดิมของการจองนี้ให้เลือกค้างไว้
  const roomList = rooms.some((r) => r.id === booking.room.id)
    ? rooms
    : [...rooms, { id: booking.room.id, name: booking.room.name, branch: null, location: null, room_no: null, description: null, seats: [], capacity: 0, is_active: false, sort_order: 0, images: [] }];

  return (
    <div className="space-y-5">
      <PageHeader icon={MeetingRoomIcon} title={t("meeting.form.editTitle")} subtitle={t("meeting.form.subtitle")} />
      <BookingForm
        id={booking.id}
        initial={{
          room_id: String(booking.room.id),
          title: booking.title,
          attendees: String(booking.attendees),
          purpose: booking.purpose ?? "",
          equipment: booking.equipment,
          note: booking.note ?? "",
          date: booking.date,
          start_time: booking.start_time,
          end_time: booking.end_time,
        }}
        initialDay={day}
        rooms={roomList}
        purposes={purposes}
        equipment={equipment}
        booker={{ name: booking.user.name, department: booking.department }}
      />
    </div>
  );
}
