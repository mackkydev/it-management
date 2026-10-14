import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import type { MeetingBooking } from "@/lib/types";
import { MyBookings } from "./my-bookings";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meeting.mine.title") };
}

const TABS = ["upcoming", "past", "cancelled"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** การจองของฉัน — แท็บ กำลังจะถึง / ผ่านไปแล้ว / ยกเลิกแล้ว */
export default async function MyMeetingBookingsPage({ searchParams }: PageProps<"/meeting-rooms/mine">) {
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "upcoming";
  const [{ t }, items, can] = await Promise.all([getI18n(), apiFetch<{ data: MeetingBooking[] }>(`/meeting-bookings/mine?status=${status}`).then((r) => r.data), getAccess()]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={InboxIcon}
        title={t("meeting.mine.title")}
        subtitle={t("meeting.mine.subtitle")}
        actions={
          can("btn:meeting:book") && (
            <Link href="/meeting-rooms/book" className={btn.primary}>
              <PlusIcon />
              {t("meeting.book")}
            </Link>
          )
        }
      />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/meeting-rooms/mine?status=${s}`} aria-current={s === status ? "page" : undefined} className={`cursor-pointer ${TAB_CLS(s === status)}`}>
            {t(`meeting.mine.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t(`meeting.mine.empty.${status}`)}</div> : <MyBookings items={items} />}
    </div>
  );
}
