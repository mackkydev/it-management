"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { AlertIcon } from "@/components/icons";
import { alert } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { deniedTarget, routeAllowed } from "./nav";

/** แถบแจ้งเมื่อถูกพามาจากหน้าที่ไม่มีสิทธิ์ (?denied=1) */
function DeniedNotice() {
  const { t } = useI18n();
  if (useSearchParams().get("denied") !== "1") return null;
  return (
    <p role="alert" className={`${alert.warning} mb-4`}>
      <AlertIcon className="shrink-0" />
      {t("common.accessDenied")}
    </p>
  );
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
      <Suspense fallback={null}>
        <DeniedNotice />
      </Suspense>
      {children}
    </>
  );
}
