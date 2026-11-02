import Link from "next/link";
import { MonitorIcon, PaperclipIcon } from "@/components/icons";
import { ClickableRow } from "@/components/clickable-row";
import { card, tone } from "@/components/ui";
import type { Formatters, TFunction } from "@/i18n/types";
import type { LicenseSummary } from "@/lib/types";
import { UsageBar } from "../license-installations/usage-bar";
import { LicenseIcon } from "./license-icon";

/** วันหมดอายุบนการ์ด: หมดแล้ว = แดง, เหลือ ≤ 30 วัน = เหลือง */
function Expiry({ license: l, t, fmt }: { license: LicenseSummary; t: TFunction; fmt: Formatters }) {
  if (!l.expires_at || l.days_left === null) return <>{t("assets.license.noExpiry")}</>;
  if (l.days_left > 30) return <>{t("assets.license.expiresOn", { date: fmt.date(l.expires_at) })}</>;
  const look = l.days_left < 0 ? tone.danger : tone.warning;
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${look.badge}`}>
      {l.days_left < 0 ? t("assets.license.expiredOn", { date: fmt.date(l.expires_at) }) : t("assets.license.expiresOn", { date: fmt.date(l.expires_at) })}
    </span>
  );
}

/**
 * การ์ดซอฟต์แวร์ License (เมนู /licenses และหัวหน้าการติดตั้ง) — คลิกการ์ด = รายละเอียด (/assets/{id}),
 * จำนวนไฟล์แนบ → ส่วนเอกสารแนบในหน้ารายละเอียด, "เครื่องที่ติดตั้ง" → /license-installations?license=
 */
export function LicenseCard({
  license: l,
  t,
  fmt,
  showInstalls,
  canEdit,
}: {
  license: LicenseSummary;
  t: TFunction;
  fmt: Formatters;
  showInstalls: boolean;
  /** อัปโหลด/เปลี่ยนไอคอนได้ (assets.update) */
  canEdit: boolean;
}) {
  const linkCls = "inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-700 hover:underline dark:text-accent-300";
  return (
    <ClickableRow as="li" href={`/assets/${l.id}`} className={`flex flex-col p-4 transition-shadow hover:shadow-md ${card}`}>
      {/* ไอคอน (อัปโหลดได้) + ชื่อ */}
      <div className="mb-3 flex items-center gap-3">
        <LicenseIcon assetId={l.id} iconId={l.icon_id} name={l.name} canEdit={canEdit} />
        <div className="min-w-0">
          <Link href={`/assets/${l.id}`} className="block cursor-pointer truncate font-medium text-ink hover:text-accent-700 hover:underline dark:hover:text-accent-300">
            {l.name}
          </Link>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <span className="mr-0.5 rounded-full bg-accent-50 px-1.5 py-px font-medium text-accent-700 ring-1 ring-inset ring-accent-200 dark:bg-accent-400/10 dark:text-accent-300 dark:ring-accent-400/30">
              {t(`licenses.types.${l.software_type}`)}
            </span>
            <span className="font-mono">{l.asset_tag}</span>
            <span>·</span>
            <Expiry license={l} t={t} fmt={fmt} />
            {l.vendor && <span className="truncate">· {l.vendor}</span>}
          </p>
        </div>
      </div>
      <UsageBar usage={l} t={t} fmt={fmt} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Link href={`/assets/${l.id}#files`} className={linkCls}>
          <PaperclipIcon width={13} height={13} />
          {l.files_count > 0 ? t("licenses.files", { count: fmt.number(l.files_count) }) : t("licenses.noFiles")}
        </Link>
        {showInstalls && (
          <Link href={`/license-installations?license=${l.id}`} className={linkCls}>
            <MonitorIcon width={13} height={13} />
            {t("licenses.installations")}
          </Link>
        )}
      </div>
    </ClickableRow>
  );
}
