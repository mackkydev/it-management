"use client";

import { SpinnerIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";
import { card } from "@/components/ui";

/** แท่งโครงร่างกระพริบตามสีธีม */
export function Bone({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-accent-100/70 dark:bg-white/[0.06] ${className}`} />;
}

/** ข้อความ "กำลังโหลด" พร้อมวงหมุน — สำหรับ screen reader และให้ผู้ใช้รู้ว่าระบบกำลังทำงาน */
export function LoadingLabel({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-accent-600 dark:text-accent-300">
      <SpinnerIcon />
      {text ?? t("common.loadingData")}
    </div>
  );
}

/** โครงร่างตาราง (บนจอใหญ่) / การ์ด (บนมือถือ) */
export function TableSkeleton({ cols = 7, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <LoadingLabel />
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="flex gap-4 bg-subtle px-4 py-3">
          {Array.from({ length: cols }).map((_, i) => (
            <Bone key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="flex items-center gap-4 border-t border-line-soft px-4 py-4">
            {Array.from({ length: cols }).map((_, i) => (
              <Bone key={i} className={`flex-1 ${i === 1 ? "h-4" : "h-3"}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`space-y-2 p-4 ${card}`}>
            <div className="flex justify-between">
              <Bone className="h-3 w-1/3" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
            <Bone className="h-4 w-2/3" />
            <Bone className="h-3 w-1/2" />
            <Bone className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** โครงร่างหน้ารายการ: หัวข้อ + แถบตัวกรอง + ตาราง */
export function ListPageSkeleton() {
  return (
    <div className="space-y-5">
      <Bone className="h-8 w-48" />
      <Bone className="h-[120px] w-full rounded-2xl lg:h-[108px]" />
      <TableSkeleton />
    </div>
  );
}

/** โครงร่างหน้าฟอร์มเพิ่ม/แก้ไขสินทรัพย์ */
export function AssetFormSkeleton() {
  const { t } = useI18n();
  const fields = (n: number, cols: string) => (
    <div className={`grid grid-cols-1 gap-4 ${cols}`}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Bone className="h-3 w-24" />
          <Bone className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5" aria-busy="true">
      <Bone className="h-8 w-56" />
      <LoadingLabel text={t("common.loadingForm")} />
      <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
        <Bone className="h-4 w-32" />
        {fields(9, "sm:grid-cols-2")}
      </section>
      <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
        <Bone className="h-4 w-40" />
        {fields(3, "sm:grid-cols-3")}
      </section>
    </div>
  );
}
