"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { FlashToast } from "@/components/toast";
import { useI18n } from "@/i18n/client";
import type { UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { deniedTarget, routeAllowed } from "./nav";

/** Toast เมื่อถูกพามาจากหน้าที่ไม่มีสิทธิ์ (?denied=1) */
function DeniedNotice() {
  const { t } = useI18n();
  return <FlashToast param="denied" kind="warning" message={t("common.accessDenied")} />;
}

/**
 * กันหน้าตอนเปลี่ยนหน้าภายในแอป (layout ไม่ทำงานซ้ำ) — การเปิดลิงก์ตรงกันที่ (app)/layout.tsx ด้วยกฎเดียวกัน (routeAllowed)
 */
export function RouteGuard({ user, uiConfig, children }: { user: User; uiConfig: UiConfig; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = routeAllowed(user, uiConfig, pathname);
  useEffect(() => {
    if (!allowed) router.replace(deniedTarget(user, uiConfig) as Route);
  }, [allowed, router, user, uiConfig]);
  if (!allowed) return null;
  return (
    <>
      <DeniedNotice />
      {children}
    </>
  );
}
