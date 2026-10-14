"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteRoom } from "@/app/actions/meeting";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { SpinnerIcon, TrashIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ปุ่มลบห้อง — ห้องที่มีประวัติการจอง API ตอบ 422 (ให้ปิดใช้งานแทน) */
export function DeleteRoomButton({ id, name }: { id: number; name: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [pending, start] = useTransition();
  const remove = async () => {
    if (!(await confirm(t("meeting.rooms.confirmDelete", { name })))) return;
    start(async () => {
      const res = await deleteRoom(id);
      if (!res.ok) return void (await showAlert(res.errors?.name ?? res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };
  return (
    <button type="button" disabled={pending} onClick={remove} className={`${btn.danger} ${btn.sm}`}>
      {pending ? <SpinnerIcon width={14} height={14} /> : <TrashIcon width={14} height={14} />}
      {t("meeting.booking.delete")}
    </button>
  );
}
