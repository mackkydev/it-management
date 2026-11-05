import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { localToday } from "@/lib/date";
import type { ZoomBooking } from "@/lib/types";
import { getAccess } from "@/lib/auth";
import { BookZoomModal } from "../book-zoom-modal";
import { ZoomList } from "../zoom-list";
import { TIME_OPTIONS } from "../zoom-utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("zoom.mine.title") };
}

const TABS = ["upcoming", "todo", "past", "cancelled"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * รายการจอง ZOOM (เมนูเดียว = จอง + การจองของฉัน) — แท็บ กำลังจะถึง / รอฉันจัดการ (แก้วันเวลา + กดรับ — ตัวเลขเดียวกับเมนู) / ผ่านไปแล้ว / ยกเลิก, ปุ่ม "จองใช้ ZOOM" เปิดฟอร์มใน modal
 * ปฏิทิน/ไทม์ไลน์ส่ง ?book=1&date=&start=&end= มา = เปิด modal พร้อมเติมวันเวลา
 */
export default async function ZoomBookingsPage({ searchParams }: PageProps<"/zoom/mine">) {
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "upcoming";
  const today = localToday();
  const date = DATE_RE.test(str(sp.date)) && str(sp.date) >= today ? str(sp.date) : "";
  const start = TIME_OPTIONS.includes(str(sp.start)) ? str(sp.start) : "09:00";
  const end = TIME_OPTIONS.includes(str(sp.end)) && str(sp.end) > start ? str(sp.end) : "10:00" > start ? "10:00" : "23:59";
  const [{ t }, res, range, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: ZoomBooking[]; meta: { counts: { todo: number } } }>(`/zoom-bookings/mine?status=${status}`),
    date ? apiFetch<{ data: ZoomBooking[] }>(`/zoom-bookings?${new URLSearchParams({ from: date, to: date })}`).then((r) => r.data) : Promise.resolve([] as ZoomBooking[]),
    getAccess(),
  ]);
  const items = res.data;
  const todo = res.meta.counts.todo;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={InboxIcon}
        title={t("zoom.mine.title")}
        subtitle={t("zoom.mine.subtitle")}
        actions={can("btn:zoom:book") && <BookZoomModal key={`${date}-${start}-${end}`} autoOpen={sp.book === "1"} initial={{ title: "", details: "", start_on: date, start_time: start, end_on: date, end_time: end }} initialRange={range} />}
      />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/zoom/mine?status=${s}`} aria-current={s === status ? "page" : undefined} className={`inline-flex cursor-pointer items-center gap-2 ${TAB_CLS(s === status)}`}>
            {t(`zoom.mine.tabs.${s}`)}
            {s === "todo" && todo > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-500 px-1.5 text-2xs font-semibold text-white">{todo > 99 ? "99+" : todo}</span>}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t(`zoom.mine.empty.${status}`)}</div> : <ZoomList items={items} mode="mine" />}
    </div>
  );
}
