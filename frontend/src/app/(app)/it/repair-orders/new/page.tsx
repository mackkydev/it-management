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

/**
 * ?ticket=<เลขที่ใบแจ้งงาน> (ปุ่ม "ส่งซ่อมภายนอก" ในหน้าใบแจ้งซ่อม) → เลือกใบนั้นไว้ให้ (ข้อมูลเครื่อง + อาการเสีย)
 * หาในรายการใบที่เลือกได้ก่อน ไม่พบ (ใบเก่ากว่ารายการ) = ค้นด้วยเลขที่ — ใบปิดแล้ว / ไม่พบ = ฟอร์มว่างตามเดิม
 */
async function ticketItem(no: string | undefined, tickets: RepairLookupItem[]): Promise<RepairLookupItem | null> {
  const value = no?.trim().slice(0, 50);
  if (!value) return null;
  const inList = tickets.find((x) => x.ticket_no === value);
  if (inList) return inList;
  const found = await apiFetch<{ data: RepairLookupItem[] }>(`/repair-orders/lookup?q=${encodeURIComponent(value)}`).then((r) => r.data, () => []);
  return found.find((x) => x.kind === "ticket" && x.ticket_no === value) ?? null;
}

export default async function NewRepairOrderPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const [user, { t }, { ticket }] = await Promise.all([getCurrentUser(), getI18n(), searchParams]);
  if (!has(user, "repair_orders.manage")) redirect("/it/repair-orders");
  const { data } = await apiFetch<{ data: { vendors: { id: number; name: string; vendor_type: string }[]; tickets: RepairLookupItem[] } }>("/repair-orders/form-options");
  const initialItem = await ticketItem(ticket, data.tickets);
  return (
    <div className="space-y-5">
      <PageHeader icon={TruckIcon} title={t("repairOrders.add")} subtitle={t("repairOrders.addSubtitle")} />
      <RepairForm vendors={data.vendors} tickets={data.tickets} defaults={{ ...nowInThailand(), recorder: user.name }} initialItem={initialItem} />
    </div>
  );
}
