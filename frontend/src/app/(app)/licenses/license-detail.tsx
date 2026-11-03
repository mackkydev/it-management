import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BoxIcon, ChevronLeftIcon, KeyIcon, PaperclipIcon, PencilIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { StatusBadge } from "@/components/status-badge";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canEditAssets, has, getAccess, getCurrentUser } from "@/lib/auth";
import type { License } from "@/lib/types";
import { UsageBar } from "../license-installations/usage-bar";
import { LicenseIcon } from "./license-icon";
import { LicenseFiles, LicenseKey } from "./license-parts";
import { ManageContractButton } from "./manage-contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** แถว ชื่อ : ค่า */
function Item({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{children || "-"}</dd>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">{icon}</span>
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

/** รายละเอียด License ซอฟต์แวร์ */
export async function LicenseDetail({ id }: { id: string }) {
  if (!UUID_RE.test(id)) notFound();
  const [row, user, { t, fmt }, can] = await Promise.all([
    apiFetch<{ data: License }>(`/licenses/${id}`).then(
      (r) => r.data,
      (e) => {
        if (e instanceof ApiError && e.status === 404) notFound();
        throw e;
      },
    ),
    getCurrentUser(),
    getI18n(),
    getAccess(),
  ]);
  const lic = row.license;
  const canEdit = canEditAssets(user) && can("btn:assets:edit");
  const canRevealKey = has(user, "assets.license_key");
  // หมดแล้ว = danger, เหลือ ≤ 30 วัน = warning
  const licenseTone = lic.days_left === null ? null : lic.days_left < 0 ? tone.danger : lic.days_left <= 30 ? tone.warning : tone.success;

  return (
    <div className="space-y-5">
      <Link href="/licenses" className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-ink">
        <LinkPendingIcon icon={<ChevronLeftIcon width={15} height={15} />} size={15} />
        {t("licenses.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* ผู้แก้ไขคลิกเพื่อเปลี่ยนโลโก้ / × ลบ */}
          <LicenseIcon licenseId={row.id} iconId={row.icon_id} name={row.name} canEdit={canEdit} removable size="lg" />
          <div>
            {row.license_no && <p className="font-mono text-xs text-muted">{row.license_no}</p>}
            <h1 className="text-2xl font-semibold">{row.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={row.status} label={t(`licenses.statuses.${row.status}`)} />
              {lic.cancelled_at && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("licenses.contract.cancelled")}</span>}
              {lic.expiring && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("licenses.expiringBadge")}</span>}
              {!canEdit && <span className="text-xs text-faint">{t("assets.detail.readOnly")}</span>}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {/* จัดการสัญญา: แสดงเมื่อถึงวันแจ้งเตือนแล้ว (ยังไม่ต่อ/ยกเลิก) */}
            {lic.expiring && can("btn:licenses:contract") && <ManageContractButton licenseId={row.id} license={lic} />}
            <Link href={`/licenses/${row.id}/edit`} className={btn.soft}>
              <LinkPendingIcon icon={<PencilIcon />} />
              {t("common.edit")}
            </Link>
          </div>
        )}
      </div>

      <Section title={t("licenses.form.section")} icon={<BoxIcon width={15} height={15} />}>
        <Item label={t("assets.col.category")}>{t(`licenses.types.${lic.software_type}`)}</Item>
        <Item label={t("assets.detail.brandModel")}>{[row.brand, row.model].filter(Boolean).join(" ")}</Item>
        <Item label={t("assets.form.tag")}>{row.license_no && <span className="font-mono text-sm">{row.license_no}</span>}</Item>
        <Item label={t("assets.form.serial")}>{row.serial_number && <span className="font-mono text-sm">{row.serial_number}</span>}</Item>
        <Item label={t("assets.col.branch")}>{row.branch?.name}</Item>
        <Item label={t("assets.col.location")}>{row.location && <>{row.location.name} <span className="font-mono text-xs text-muted">({row.location.code})</span></>}</Item>
        <Item label={t("assets.form.notes")} wide>
          {row.notes && <span className="whitespace-pre-line font-normal">{row.notes}</span>}
        </Item>
      </Section>

      <Section title={t("licenses.form.sectionTerms")} icon={<KeyIcon width={15} height={15} />}>
        <Item label={t("assets.license.billing")}>{t(`assets.license.billings.${lic.billing}`)}</Item>
        <Item label={t("assets.license.expiresAt")}>
          {lic.expires_at ? (
            <span className="flex flex-wrap items-center gap-2">
              {fmt.date(lic.start_date)} – {fmt.date(lic.expires_at)}
              {licenseTone && lic.days_left !== null && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${licenseTone.badge}`}>
                  {lic.days_left < 0 ? t("assets.license.expired") : t("assets.license.daysLeft", { days: fmt.number(lic.days_left) })}
                </span>
              )}
            </span>
          ) : (
            <span>
              {fmt.date(lic.start_date)} · {t("assets.license.noExpiry")}
            </span>
          )}
        </Item>
        <Item label={t("installations.title")}>
          <span className="block max-w-xs">
            <UsageBar usage={row.license_usage} t={t} fmt={fmt} />
            {has(user, "licenses.install") && (
              <Link href={`/license-installations?license=${row.id}`} className="mt-1 inline-block cursor-pointer text-xs font-normal text-accent-700 hover:underline dark:text-accent-300">
                {t("installations.viewAll")}
              </Link>
            )}
          </span>
        </Item>
        <Item label={t("assets.license.vendor")}>{lic.vendor}</Item>
        <Item label={t("assets.license.key")}>{lic.has_key ? canRevealKey ? <LicenseKey licenseId={row.id} /> : <span className="font-mono text-sm">••••••••••••</span> : null}</Item>
        {lic.expires_at && (
          <Item label={t("assets.license.notifyDays")}>
            {lic.notify_days_before ? t("assets.license.notifyDaysValue", { days: fmt.number(lic.notify_days_before) }) : t("assets.license.notifyDefault")}
          </Item>
        )}
      </Section>

      <section id="files" className={`scroll-mt-20 p-4 sm:p-6 ${card}`}>
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
            <PaperclipIcon width={15} height={15} />
          </span>
          {t("assets.files.title")}
        </h2>
        <LicenseFiles licenseId={row.id} files={row.files} canManage={canEditAssets(user)} />
      </section>

      <Section title={t("licenses.form.sectionPurchase")} icon={<BoxIcon width={15} height={15} />}>
        <Item label={t("assets.form.purchaseDate")}>{row.purchase_date && fmt.date(row.purchase_date)}</Item>
        <Item label={t("assets.col.cost")}>{row.purchase_cost && <span className="tabular-nums">{fmt.money(row.purchase_cost)}</span>}</Item>
        <Item label={t("assets.detail.createdAt")}>{fmt.dateTime(row.created_at)}</Item>
        <Item label={t("assets.detail.updatedAt")}>{fmt.dateTime(row.updated_at)}</Item>
      </Section>
    </div>
  );
}
