"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { linkApiUser } from "@/app/actions/access";
import { GitBranchIcon, SpinnerIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ผูก API User เข้ากับบัญชีในระบบที่ใช้อีเมลเดียวกัน (ยืนยันก่อน — บัญชีเดิมจะใช้รหัสผ่านเดิมไม่ได้อีก) */
export function LinkAccountButton({ apiUserId, localUserId, connection, email }: { apiUserId: number; localUserId: number; connection: string; email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = () => {
    if (!confirm(t("access.linkConfirm", { connection, email }))) return;
    start(async () => {
      const res = await linkApiUser(apiUserId, localUserId);
      alert(res.message ?? "");
      if (res.ok) router.refresh();
    });
  };

  return (
    <button type="button" onClick={run} disabled={pending} className={`${btn.secondary} ${btn.sm} disabled:cursor-not-allowed`}>
      {pending ? <SpinnerIcon width={13} height={13} /> : <GitBranchIcon width={13} height={13} />}
      {t("access.link")}
    </button>
  );
}
