import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TruckIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { RepairOrder } from "@/lib/types";
import { RepairForm } from "../../repair-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("repairOrders.editTitle") };
}

/** แก้ไขรายการที่ส่งซ่อมอยู่ — จบแล้ว (รับคืน / ยกเลิก) กลับไปหน้ารายละเอียด */
export default async function EditRepairOrderPage({ params }: PageProps<"/it/repair-orders/[id]/edit">) {
  const [{ id }, user, { t }] = await Promise.all([params, getCurrentUser(), getI18n()]);
  if (!has(user, "repair_orders.manage")) redirect("/it/repair-orders");
  const [order, options] = await Promise.all([
    apiFetch<{ data: RepairOrder }>(`/repair-orders/${encodeURIComponent(id)}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<{ data: { vendors: { id: number; name: string; vendor_type: string }[] } }>("/repair-orders/form-options"),
  ]);
  const r = order.data;
  if (r.status !== "sent") redirect(`/it/repair-orders/${r.id}`);
  // ค่าเดิมที่ถูกปิดใช้งานไปแล้วยังเลือกค้างไว้ได้
  const vendors = options.data.vendors.some((v) => v.id === r.vendor.id) ? options.data.vendors : [{ id: r.vendor.id, name: r.vendor.name, vendor_type: r.vendor.vendor_type }, ...options.data.vendors];
  return (
    <div className="space-y-5">
      <PageHeader icon={TruckIcon} title={t("repairOrders.editTitle")} subtitle={r.item_name} />
      <RepairForm vendors={vendors} defaults={{ sent_on: r.sent_on, sent_time: r.sent_time, recorder: r.created_by.name }} order={r} />
    </div>
  );
}
