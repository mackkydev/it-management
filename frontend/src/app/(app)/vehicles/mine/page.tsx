import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { btn, card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleBookingList } from "../vehicle-booking-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.mine.title") };
}

const TABS = ["upcoming", "past", "cancelled"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** การจองรถของฉัน — แท็บ กำลังจะถึง / ผ่านไปแล้ว (บันทึกเลขไมล์) / ยกเลิกแล้ว */
export default async function MyVehicleBookingsPage({ searchParams }: PageProps<"/vehicles/mine">) {
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.status) ?? "upcoming";
  const [{ t }, items, vehicles, can] = await Promise.all([
    getI18n(),
    apiFetch<{ data: VehicleBooking[] }>(`/vehicle-bookings/mine?status=${status}`).then((r) => r.data),
    apiFetch<{ data: Vehicle[] }>("/vehicles").then((r) => r.data),
    getAccess(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={InboxIcon}
        title={t("vehicle.mine.title")}
        subtitle={t("vehicle.mine.subtitle")}
        actions={
          can("btn:vehicles:book") && (
            <Link href="/vehicles/book" className={btn.primary}>
              <PlusIcon />
              {t("vehicle.book")}
            </Link>
          )
        }
      />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {TABS.map((s) => (
          <Link key={s} href={`/vehicles/mine?status=${s}`} aria-current={s === status ? "page" : undefined} className={`cursor-pointer ${TAB_CLS(s === status)}`}>
            {t(`meeting.mine.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <div className={`p-10 text-center text-muted ${card}`}>{t(`meeting.mine.empty.${status}`)}</div> : <VehicleBookingList items={items} vehicles={vehicles} mode="mine" />}
    </div>
  );
}
