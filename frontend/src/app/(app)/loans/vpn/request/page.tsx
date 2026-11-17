import type { Metadata } from "next";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { SignatureNotice } from "@/components/signature-notice";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { VpnLoan } from "@/lib/types";
import type { TicketFormOptions } from "../../../tickets/new/ticket-form";
import { VpnCard } from "../vpn-card";
import { VpnRequestButton } from "./vpn-request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vpn.request.title") };
}

/**
 * ขอใช้ VPN (ผู้ใช้) — ปุ่มขอใช้ (กล่องฟอร์ม → ใบแจ้งงานเบื้องหลัง) + รายการ VPN ของฉัน:
 * ได้รับแล้ว (ปิดใบแจ้งงาน) / ดูชื่อผู้ใช้ + รหัสผ่าน (กรอกรหัสผ่าน login) / ขอต่ออายุ / แจ้งถูกล็อก / ไม่ต่ออายุ (ยืนยันก่อนส่ง → ใบแจ้งงาน)
 */
export default async function VpnRequestPage() {
  const [{ t }, user, mine, options] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    apiFetch<{ data: VpnLoan[] }>("/vpn-loans/mine").then((r) => r.data),
    apiFetch<{ data: TicketFormOptions }>("/tickets/form-options").then((r) => r.data),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vpn.request.title")} subtitle={t("vpn.request.subtitle")} actions={user && <VpnRequestButton user={user} options={options} />} />
      <SignatureNotice user={user} t={t} />
      {mine.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vpn.request.empty")}</div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((l) => (
            <VpnCard key={`${l.id}:${l.status}:${l.expires_on}:${l.received_at}:${l.revoked_at}`} loan={l} compact />
          ))}
        </div>
      )}
    </div>
  );
}
