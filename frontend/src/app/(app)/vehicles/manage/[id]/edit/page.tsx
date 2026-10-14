import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CarIcon, GaugeIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { getBookingScope } from "@/lib/booking-scope";
import type { Branch, BranchChoices, Vehicle, VehicleMileageEntry, VehicleTransfer } from "@/lib/types";
import { periodText } from "../../../vehicle-utils";
import { VehicleForm } from "../../vehicle-form";
import { VehicleTransferPanel } from "../../vehicle-transfer";

const vehicleOptions = (list: string) => apiFetch<{ data: { name: string }[] }>(`/dropdown-options/${list}`).then((r) => r.data.map((o) => o.name));

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicle.manage.editTitle") };
}

/** แก้ไขรถ + ย้ายสาขา (ประวัติการย้าย) + ประวัติเลขไมล์จากการจอง */
export default async function EditVehiclePage({ params }: PageProps<"/vehicles/manage/[id]/edit">) {
  const user = await getCurrentUser();
  if (!has(user, "vehicle.manage")) redirect("/vehicles");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [{ t, fmt }, vehicle, branches, history, transfers, scope, types, fuels] = await Promise.all([
    getI18n(),
    apiFetch<{ data: Vehicle }>(`/vehicles/${id}`)
      .then((r) => r.data)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      }),
    apiFetch<{ data: Branch[] }>("/branches").then((r) => r.data),
    apiFetch<{ data: VehicleMileageEntry[] }>(`/vehicles/${id}/mileage`).then((r) => r.data),
    apiFetch<{ data: VehicleTransfer[] }>(`/vehicles/${id}/transfers`).then((r) => r.data),
    getBookingScope("vehicle"),
    vehicleOptions("vehicle_type"),
    vehicleOptions("vehicle_fuel"),
  ]);
  // รถของสาขาที่อยู่นอกขอบเขตที่จัดการได้ — กลับไปหน้ารายการ
  if (vehicle.can_manage === false) redirect("/vehicles/manage");
  const all = branches.map((b) => ({ id: b.id, name: b.name }));
  // แก้ไขไม่ใช้ตัวเลือกสาขา (ย้ายสาขาแยกด้านล่าง) — ส่งไว้ตาม props ของฟอร์ม
  const choices: BranchChoices = { branches: all, allowShared: scope.scope === "all", defaultId: null };
  const km = (n: number | null) => (n === null ? "-" : fmt.number(n));

  return (
    <div className="space-y-5">
      <PageHeader icon={CarIcon} title={t("vehicle.manage.editTitle")} subtitle={vehicle.name} />
      <VehicleForm vehicle={vehicle} choices={choices} types={types} fuels={fuels} />
      <VehicleTransferPanel vehicle={vehicle} branches={all} allowShared={scope.scope === "all"} history={transfers} />
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <GaugeIcon className="text-accent-500" />
          {t("vehicle.mileage.history")}
        </h2>
        {history.length === 0 ? (
          <div className={`p-6 text-center text-sm text-muted ${card}`}>{t("vehicle.mileage.historyEmpty")}</div>
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("vehicle.detail.when")}</th>
                  <th className={table.th}>{t("meeting.detail.booker")}</th>
                  <th className={`${table.th} text-right`}>{t("vehicle.form.startMileage")}</th>
                  <th className={`${table.th} text-right`}>{t("vehicle.form.endMileage")}</th>
                  <th className={`${table.th} text-right`}>{t("vehicle.mileage.distance")}</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {history.map((h) => (
                  <tr key={h.booking_id} className={table.row}>
                    <td className={`${table.td} whitespace-nowrap`}>
                      <Link href={`/vehicles/day/${h.start_on}`} className="cursor-pointer hover:text-accent-600 dark:hover:text-accent-300">
                        {periodText(h, fmt.date)}
                      </Link>
                      <span className="block max-w-xs truncate text-xs text-muted">{h.details}</span>
                    </td>
                    <td className={table.td}>{h.user_name}</td>
                    <td className={`${table.td} text-right tabular-nums`}>{km(h.start_mileage)}</td>
                    <td className={`${table.td} text-right tabular-nums`}>{km(h.end_mileage)}</td>
                    <td className={`${table.td} text-right tabular-nums`}>{h.distance === null ? "-" : t("vehicle.mileageValue", { n: fmt.number(h.distance) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
