"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAccess } from "@/components/access-context";
import { PlusIcon } from "@/components/icons";
import { routeAllowed } from "@/components/shell/nav";
import { Tooltip } from "@/components/tooltip";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import { MASTER_DATA, type MasterDataSource } from "@/lib/master-data";
import { has, isReadOnly } from "@/lib/permissions";

/** ผู้ใช้คนนี้เปิดหน้าจัดการข้อมูลหลักนั้นได้ไหม = สิทธิ์จัดการ + เมนูไม่ถูกซ่อน (กฎเดียวกับเมนู) และไม่ใช่ผู้ตรวจสอบ (อ่านอย่างเดียว) */
export function useCanManageMaster(source: MasterDataSource): boolean {
  const access = useAccess();
  if (!access) return false;
  const { user, uiConfig } = access;
  const entry = MASTER_DATA[source];
  if (isReadOnly(user) || !has(user, entry.perm)) return false;
  return routeAllowed(user, uiConfig, entry.href.split("?")[0]);
}

/** ปุ่มไอคอน + ไปหน้าจัดการ (เพิ่ม/แก้ไข/ลบ) ของข้อมูลหลัก — ไม่มีสิทธิ์ = ไม่แสดง */
export function MasterDataButton({ source }: { source: MasterDataSource }) {
  const { t } = useI18n();
  if (!useCanManageMaster(source)) return null;
  const entry = MASTER_DATA[source];
  const label = t("masterData.manage", { name: t(entry.label as MessageKey) });
  return (
    <Tooltip label={label} className="shrink-0">
      {/* ความสูงเท่าช่องกรอก (ขอบ 1px + py-2 + 1 บรรทัด text-sm) — ขยายตามขนาดตัวอักษรของผู้ใช้ */}
      <Link href={entry.href as Route} className={`${btn.soft} border border-transparent px-2.5!`} aria-label={label}>
        <span className="flex h-[1lh] items-center">
          <PlusIcon width={16} height={16} />
        </span>
      </Link>
    </Tooltip>
  );
}

/**
 * ครอบ Drop Down ที่ดึงตัวเลือกจากข้อมูลหลัก → [Drop Down][+] (ปุ่ม + ด้านหลัง แสดงเฉพาะผู้ที่จัดการข้อมูลนั้นได้)
 * ไม่มีสิทธิ์ = แสดง Drop Down อย่างเดียวเหมือนเดิม
 */
export function MasterDataSelect({ source, children, className = "" }: { source: MasterDataSource; children: ReactNode; className?: string }) {
  const canManage = useCanManageMaster(source);
  if (!canManage) return <>{children}</>;
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <MasterDataButton source={source} />
    </div>
  );
}
