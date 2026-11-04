import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TruckIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { RepairLookupItem } from "@/lib/types";
import { RepairForm } from "../repair-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("repairOrders.add") };
}

/** วันที่ + เวลาปัจจุบันเวลาไทย (ปัดลงเป็นช่วง 30 นาที ตามตัวเลือกเวลา) */
function nowInThailand() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { sent_on: `${parts.year}-${parts.month}-${parts.day}`, sent_time: `${parts.hour}:${Number(parts.minute) < 30 ? "00" : "30"}` };
}

export default async function NewRepairOrderPage() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getI18n()]);
  if (!has(user, "repair_orders.manage")) redirect("/it/repair-orders");
  const { data } = await apiFetch<{ data: { vendors: { id: number; name: string; vendor_type: string }[]; staff: { id: number; name: string }[]; tickets: RepairLookupItem[] } }>("/repair-orders/form-options");
  // ผู้บันทึกที่ไม่ได้อยู่ฝ่าย IT (เช่น ผู้ดูแลระบบสูงสุด) ยังเลือกตัวเองเป็นผู้ส่งซ่อมได้
  const staff = data.staff.some((s) => s.id === user.id) ? data.staff : [{ id: user.id, name: user.name }, ...data.staff];
  return (
    <div className="space-y-5">
      <PageHeader icon={TruckIcon} title={t("repairOrders.add")} subtitle={t("repairOrders.addSubtitle")} />
      <RepairForm vendors={data.vendors} staff={staff} tickets={data.tickets} defaults={{ sent_by_id: user.id, ...nowInThailand() }} />
    </div>
  );
}
