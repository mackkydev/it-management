import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MeetingRoomIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { branchChoices } from "@/lib/booking-scope";
import { getCurrentUser, has } from "@/lib/auth";
import type { MeetingRoom } from "@/lib/types";
import { RoomForm } from "../../room-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.rooms.editTitle") };
}

export default async function EditMeetingRoomPage({ params }: PageProps<"/meeting-rooms/rooms/[id]/edit">) {
  const user = await getCurrentUser();
  if (!has(user, "meeting.rooms")) redirect("/meeting-rooms");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [{ t }, room, branches] = await Promise.all([
    getI18n(),
    apiFetch<{ data: MeetingRoom }>(`/meeting-rooms/${id}`)
      .then((r) => r.data)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      }),
    branchChoices("meeting"),
  ]);
  // ห้องของสาขาที่อยู่นอกขอบเขตที่จัดการได้ (เช่น ห้องใช้ร่วมกัน สำหรับผู้ดูแลเฉพาะสาขา) — ดูได้แต่แก้ไม่ได้
  if (room.can_manage === false) redirect("/meeting-rooms/rooms");
  return (
    <div className="space-y-5">
      <PageHeader icon={MeetingRoomIcon} title={t("meeting.rooms.editTitle")} subtitle={room.name} />
      <RoomForm room={room} choices={branches} />
    </div>
  );
}
