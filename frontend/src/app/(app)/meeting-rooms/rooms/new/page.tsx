import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MeetingRoomIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { branchChoices } from "@/lib/booking-scope";
import { getCurrentUser, has } from "@/lib/auth";
import { RoomForm } from "../room-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.rooms.newTitle") };
}

export default async function NewMeetingRoomPage() {
  const user = await getCurrentUser();
  if (!has(user, "meeting.rooms")) redirect("/meeting-rooms");
  const [{ t }, branches] = await Promise.all([getI18n(), branchChoices("meeting")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={MeetingRoomIcon} title={t("meeting.rooms.newTitle")} subtitle={t("meeting.rooms.subtitle")} />
      <RoomForm room={null} choices={branches} />
    </div>
  );
}
