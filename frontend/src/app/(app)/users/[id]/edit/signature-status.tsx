"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteUserSignature } from "@/app/actions/users";
import { CheckCircleIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { btn, card, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Local Admin: สถานะลายเซ็นของผู้ใช้ (มี/ไม่มี — ไม่แสดงรูป) + ลบเมื่อจำเป็น (บันทึก audit) */
export function SignatureStatus({ userId, hasSignature }: { userId: number; hasSignature: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const remove = () => {
    if (!confirm(t("users.signature.confirmRemove"))) return;
    start(async () => {
      const res = await deleteUserSignature(userId);
      setMessage(res.message ?? "");
      if (res.ok) router.refresh();
    });
  };

  return (
    <section className={`flex flex-wrap items-center gap-3 p-4 sm:px-6 ${card}`}>
      <h2 className="font-semibold">{t("users.signature.title")}</h2>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${hasSignature ? tone.success.badge : tone.idle.badge}`}>
        {hasSignature ? t("users.signature.has") : t("users.signature.none")}
      </span>
      {message && (
        <span className="flex items-center gap-1 text-sm text-muted">
          <CheckCircleIcon width={14} height={14} />
          {message}
        </span>
      )}
      {hasSignature && (
        <button type="button" onClick={remove} disabled={pending} className={`${btn.danger} ${btn.sm} ml-auto disabled:cursor-not-allowed`}>
          {pending ? <SpinnerIcon width={13} height={13} /> : <TrashIcon width={13} height={13} />}
          {t("users.signature.remove")}
        </button>
      )}
    </section>
  );
}
