"use client";

import { logout } from "@/app/actions/auth";
import { LogoutIcon } from "@/components/icons";
import { SubmitButton } from "@/components/pending";
import { useI18n } from "@/i18n/client";
import type { User } from "@/lib/types";

/** วงกลมตัวอักษรย่อของชื่อผู้ใช้ */
export function Avatar({ user, size = "md" }: { user: User; size?: "sm" | "md" }) {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-200 font-semibold text-accent-800 dark:bg-accent-400/25 dark:text-accent-200 ${dim}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function UserLabel({ user }: { user: User }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 text-left leading-tight">
      <div className="truncate text-sm font-medium text-ink">{user.name}</div>
      <div className="truncate text-xs text-muted">{t(`roles.${user.role}`)}</div>
    </div>
  );
}

export function LogoutButton({ className }: { className: string }) {
  const { t } = useI18n();
  return (
    <form action={logout}>
      <SubmitButton className={className} icon={<LogoutIcon width={15} height={15} className="text-danger-400" />}>
        {t("nav.logout")}
      </SubmitButton>
    </form>
  );
}
