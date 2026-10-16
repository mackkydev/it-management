import type { Metadata } from "next";
import Link from "next/link";
import { KeyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { alert } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { VpnLoan } from "@/lib/types";
import { VpnRequestForm } from "./vpn-request-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vpn.requestTitle") };
}

/** ขอใช้ VPN (ทุกคน) — มีคำขอที่รออยู่แล้ว = แจ้งและลิงก์ไปการยืมของฉัน (API ก็กันซ้ำ) */
export default async function VpnRequestPage() {
  const [{ t }, user, mine] = await Promise.all([getI18n(), getCurrentUser(), apiFetch<{ data: VpnLoan[] }>("/vpn-loans/mine").then((r) => r.data)]);
  const waiting = mine.some((l) => l.status === "requested");

  return (
    <div className="space-y-5">
      <PageHeader icon={KeyIcon} title={t("vpn.requestTitle")} subtitle={t("vpn.requestSubtitle")} />
      {waiting ? (
        <p className={alert.warning}>
          {t("vpn.pendingRequest")} —{" "}
          <Link href="/loans/mine" className="cursor-pointer font-medium underline">
            {t("nav.loanMine")}
          </Link>
        </p>
      ) : (
        <VpnRequestForm requester={{ name: user?.name ?? "", department: user?.department ?? null }} />
      )}
    </div>
  );
}
