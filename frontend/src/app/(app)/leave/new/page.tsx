import type { Metadata } from "next";
import { PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { LeaveOptions } from "@/lib/types";
import { LeaveForm } from "./leave-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("leave.newTitle") };
}

/** ขอลา — ส่งให้หัวหน้าที่ระบุอนุมัติ */
export default async function NewLeavePage() {
  const [{ t }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: LeaveOptions }>("/leave/options")]);
  return (
    <div className="space-y-5">
      <PageHeader icon={PlusIcon} title={t("leave.newTitle")} subtitle={t("leave.newSubtitle")} />
      <LeaveForm options={data} />
    </div>
  );
}
