import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, ListIcon, MapPinIcon, MeetingRoomIcon, PencilIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert, btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { MeetingRoom } from "@/lib/types";
import { imageUrl, primaryImage } from "../meeting-utils";
import { DeleteRoomButton } from "./room-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.rooms.title") };
}

/** จัดการห้องประชุม (สิทธิ์ meeting.rooms) — ประเภทการใช้งาน / อุปกรณ์ อยู่ที่ ข้อมูล Drop Down */
export default async function MeetingRoomsManagePage({ searchParams }: PageProps<"/meeting-rooms/rooms">) {
  const user = await getCurrentUser();
  if (!has(user, "meeting.rooms")) redirect("/meeting-rooms");
  const [{ t, fmt }, sp, rooms, can] = await Promise.all([getI18n(), searchParams, apiFetch<{ data: MeetingRoom[] }>("/meeting-rooms?include_inactive=1").then((r) => r.data), getAccess()]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MeetingRoomIcon}
        title={t("meeting.rooms.title")}
        subtitle={t("meeting.rooms.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dropdowns?tab=meeting_purpose" className={btn.secondary}>
              <ListIcon />
              {t("meeting.rooms.options")}
            </Link>
            {can("btn:meeting:room-create") && (
              <Link href="/meeting-rooms/rooms/new" className={btn.primary}>
                <PlusIcon />
                {t("meeting.rooms.add")}
              </Link>
            )}
          </div>
        }
      />
      {sp.done && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t("meeting.rooms.saved")}
        </p>
      )}
      {rooms.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("meeting.rooms.empty")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.map((r) => {
            const img = primaryImage(r);
            return (
              <article key={r.id} className={`flex flex-col overflow-hidden ${card} ${r.is_active ? "" : "opacity-70"}`}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
                  <img src={imageUrl(r.id, img.id)} alt={r.name} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-subtle text-faint">
                    <MeetingRoomIcon width={40} height={40} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{r.name}</h2>
                    {!r.is_active && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("meeting.rooms.inactive")}</span>}
                  </div>
                  {(r.location || r.room_no || r.branch) && (
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <MapPinIcon width={14} height={14} className="shrink-0" />
                      {[r.branch?.name, r.location, r.room_no].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                    <UsersIcon width={14} height={14} className="shrink-0" />
                    {r.seats.map((s) => `${s.label} ${fmt.number(s.count)}`).join(" · ")}
                  </p>
                  <p className="text-xs text-faint">{t("meeting.rooms.bookingsCount", { n: fmt.number(r.bookings_count ?? 0) })}</p>
                  {r.can_manage !== false && (
                  <div className="mt-auto flex justify-end gap-2 pt-2">
                    <Link href={`/meeting-rooms/rooms/${r.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                      <PencilIcon width={14} height={14} />
                      {t("meeting.booking.edit")}
                    </Link>
                    {(r.bookings_count ?? 0) === 0 && <DeleteRoomButton id={r.id} name={r.name} />}
                  </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
