import { tone } from "@/components/ui";
import type { Formatters, TFunction } from "@/i18n/types";
import type { LicenseUsage } from "@/lib/types";

/** แถบจำนวนที่ใช้ของ license: คงเหลือ/ทั้งหมด — เต็ม = แดง, เหลือ ≤ 10% = เหลือง (seats null = ไม่จำกัด) */
export function UsageBar({ usage, t, fmt }: { usage: LicenseUsage; t: TFunction; fmt: Formatters }) {
  if (usage.seats === null) {
    return <p className="text-sm text-muted">{t("installations.usedUnlimited", { used: fmt.number(usage.used) })}</p>;
  }
  const pct = usage.seats > 0 ? Math.min(100, Math.round((usage.used / usage.seats) * 100)) : 100;
  const look = usage.available === 0 ? tone.danger : (usage.available ?? 0) <= Math.ceil(usage.seats * 0.1) ? tone.warning : tone.success;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold tabular-nums">
          {t("installations.availableOf", { available: fmt.number(usage.available ?? 0), seats: fmt.number(usage.seats) })}
        </span>
        <span className="text-xs text-muted">{t("installations.usedCount", { used: fmt.number(usage.used) })}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={usage.used} aria-valuemin={0} aria-valuemax={usage.seats}>
        <div className={`h-full rounded-full ${look.dot}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
