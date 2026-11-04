import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, VideoIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/toast";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { shiftDay } from "../../zoom-utils";
import { ZoomTimeline } from "./zoom-timeline";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: PageProps<"/zoom/day/[date]">): Promise<Metadata> {
  const [{ t, fmt }, { date }] = await Promise.all([getI18n(), params]);
  return { title: t("zoom.dayTitle", { date: DATE_RE.test(date) ? fmt.date(date) : date }) };
}

/** การใช้ ZOOM ของวัน — ไทม์ไลน์ 00:00–24:00 */
export default async function ZoomDayPage({ params, searchParams }: PageProps<"/zoom/day/[date]">) {
  const [{ date }, sp] = await Promise.all([params, searchParams]);
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) notFound();
  const [{ t, fmt }, bookings, accounts] = await Promise.all([
    getI18n(),
    apiFetch<{ data: ZoomBooking[] }>(`/zoom-bookings?${new URLSearchParams({ from: date, to: date })}`).then((r) => r.data),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/zoom_account").then((r) => r.data.map((o) => o.name)),
  ]);
  const past = date < localToday();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={VideoIcon}
        title={t("zoom.dayTitle", { date: fmt.date(date) })}
        subtitle={t("zoom.daySubtitle")}
        actions={
          !past && (
            <Link href={`/zoom/book?date=${date}`} className={btn.primary}>
              <PlusIcon />
              {t("zoom.book")}
            </Link>
          )
        }
      />
      {sp.done === "created" && <FlashToast param="done" message={t("zoom.done.created")} />}
      <div className={`flex flex-wrap items-center gap-2 p-3 ${card}`}>
        <Link href={`/zoom?month=${date.slice(0, 7)}`} className={`${btn.secondary} ${btn.sm}`}>
          <CalendarIcon width={14} height={14} />
          {t("meeting.backToMonth")}
        </Link>
        <span className="text-sm text-muted">{t("zoom.dayCount", { n: bookings.length })}</span>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/zoom/day/${shiftDay(date, -1)}`} aria-label={t("meeting.prev")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          <Link href={`/zoom/day/${localToday()}`} className={`${btn.secondary} ${btn.sm}`}>
            {t("meeting.today")}
          </Link>
          <Link href={`/zoom/day/${shiftDay(date, 1)}`} aria-label={t("meeting.next")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <ChevronRightIcon width={16} height={16} />
          </Link>
        </div>
      </div>
      <ZoomTimeline key={date} date={date} bookings={bookings} accounts={accounts} />
    </div>
  );
}
