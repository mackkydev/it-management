"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppSelect } from "@/components/app-select";
import { BuildingIcon, LockIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { lockedBranch } from "@/lib/booking";
import { input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { BookingKind, BookingScopeMeta } from "@/lib/types";

/** ชื่อ cookie ต้องตรงกับ BRANCH_COOKIE ใน lib/booking-scope.ts */
const COOKIE: Record<BookingKind, string> = { meeting: "eam_branch_meeting", vehicle: "eam_branch_vehicle" };

/**
 * เลือกดูห้องประชุม / รถ ของสาขา (เฉพาะผู้ที่ขอบเขต "ทุกสาขา" และมีมากกว่า 1 สาขา)
 * จำค่าใน cookie แล้วโหลดหน้าใหม่ — ปฏิทิน / ไทม์ไลน์ / ฟอร์มจอง ใช้สาขาเดียวกัน
 */
export function BranchFilter({ kind, meta, value }: { kind: BookingKind; meta: BookingScopeMeta; value: number | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (meta.scope !== "all" || meta.branches.length < 2) return null;
  // ห้องประชุม / รถ: ล็อกที่สาขาของผู้ใช้ (แสดงให้รู้ว่าดูสาขาไหน แต่เปลี่ยนไม่ได้)
  const locked = lockedBranch(kind, meta);

  const change = (v: string) => {
    document.cookie = `${COOKIE[kind]}=${v || "all"}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-muted">{t("bookingScope.filter")}</span>
      {pending ? (
        <SpinnerIcon className="shrink-0 text-accent-400" />
      ) : locked ? (
        <Tooltip label={t("bookingScope.lockedHint")}>
          <LockIcon className="shrink-0 text-muted" aria-label={t("bookingScope.lockedHint")} />
        </Tooltip>
      ) : (
        <BuildingIcon className="shrink-0 text-muted" />
      )}
      <div className="w-52">
        <AppSelect
          value={locked ? String(locked) : value ? String(value) : ""}
          onValueChange={change}
          disabled={Boolean(locked)}
          aria-label={t("bookingScope.filter")}
          className={`${input} py-1.5 ${locked ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <option value="">{t("bookingScope.allBranches")}</option>
          {meta.branches.map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
        </AppSelect>
      </div>
    </div>
  );
}
