import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CarIcon, CheckCircleIcon, GaugeIcon, ListIcon, MapPinIcon, PencilIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert, btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { Vehicle } from "@/lib/types";
import { imageUrl, primaryImage } from "../vehicle-utils";
import { DeleteVehicleButton } from "./vehicle-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.manage.title") };
}

/** จัดการรถ (สิทธิ์ vehicle.manage) — ประเภทการใช้งาน / รายการเพิ่มเติม อยู่ที่ ข้อมูล Drop Down */
export default async function VehicleManagePage({ searchParams }: PageProps<"/vehicles/manage">) {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.manage")) redirect("/vehicles");
  const [{ t, fmt }, sp, vehicles, can] = await Promise.all([getI18n(), searchParams, apiFetch<{ data: Vehicle[] }>("/vehicles?include_inactive=1").then((r) => r.data), getAccess()]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CarIcon}
        title={t("vehicle.manage.title")}
        subtitle={t("vehicle.manage.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dropdowns?tab=vehicle_purpose" className={btn.secondary}>
              <ListIcon />
              {t("vehicle.manage.options")}
            </Link>
            {can("btn:vehicles:create") && (
              <Link href="/vehicles/manage/new" className={btn.primary}>
                <PlusIcon />
                {t("vehicle.manage.add")}
              </Link>
            )}
          </div>
        }
      />
      {sp.done && (
        <p role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0" />
          {t("vehicle.manage.saved")}
        </p>
      )}
      {vehicles.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vehicle.manage.empty")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => {
            const img = primaryImage(v);
            return (
              <article key={v.id} className={`flex flex-col overflow-hidden ${card} ${v.is_active ? "" : "opacity-70"}`}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
                  <img src={imageUrl(v.id, img.id)} alt={v.name} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-subtle text-faint">
                    <CarIcon width={40} height={40} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">
                      {v.name}
                      {v.plate_no && <span className="ml-1.5 text-sm font-normal text-muted">{v.plate_no}</span>}
                    </h2>
                    {!v.is_active && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("meeting.rooms.inactive")}</span>}
                  </div>
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <UsersIcon width={14} height={14} className="shrink-0" />
                    {t("vehicle.seats", { n: v.seats })}
                  </p>
                  {(v.parking || v.branch) && (
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <MapPinIcon width={14} height={14} className="shrink-0" />
                      {[v.branch?.name, v.parking].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {v.mileage !== null && (
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <GaugeIcon width={14} height={14} className="shrink-0" />
                      {t("vehicle.mileageValue", { n: fmt.number(v.mileage) })}
                    </p>
                  )}
                  <p className="text-xs text-faint">{t("meeting.rooms.bookingsCount", { n: fmt.number(v.bookings_count ?? 0) })}</p>
                  <div className="mt-auto flex justify-end gap-2 pt-2">
                    <Link href={`/vehicles/manage/${v.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                      <PencilIcon width={14} height={14} />
                      {t("meeting.booking.edit")}
                    </Link>
                    {(v.bookings_count ?? 0) === 0 && <DeleteVehicleButton id={v.id} name={v.name} />}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
