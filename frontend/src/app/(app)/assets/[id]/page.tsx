import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BoxIcon, ChevronLeftIcon, MapPinIcon, PencilIcon, UserIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { LoadingLabel } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getAccess, canManageAssets, getCurrentUser } from "@/lib/auth";
import type { Asset, AssetMovement, Paginated } from "@/lib/types";
import { MovementTimeline } from "../movement-timeline";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getAsset(id: string) {
  try {
    return (await apiFetch<{ data: Asset }>(`/assets/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.detail.title") };
}

/** จำนวนวันที่เหลือของประกัน (ติดลบ = หมดแล้ว) */
function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}

/** แถว ชื่อ : ค่า */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{children || "-"}</dd>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
          {icon}
        </span>
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

async function Movements({ id }: { id: string }) {
  const res = await apiFetch<Paginated<AssetMovement>>(`/assets/${id}/movements?per_page=50`);
  return <MovementTimeline movements={res.data} total={res.meta.total} />;
}

/** หน้ารายละเอียดสินทรัพย์แบบดูอย่างเดียว — ทุกบทบาทเข้าได้ (viewer ก็ดูประวัติการโอนย้ายได้) */
export default async function AssetDetailPage({ params }: PageProps<"/assets/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [asset, user, { t, fmt }, can] = await Promise.all([getAsset(id), getCurrentUser(), getI18n(), getAccess()]);
  const canEdit = canManageAssets(user) && can("btn:assets:edit");

  // จำนวนวันที่เหลือของประกัน: หมดแล้ว = danger, เหลือ ≤ 90 วัน = warning
  const warrantyDays = asset.warranty_expires_at ? daysUntil(asset.warranty_expires_at) : null;
  const warrantyTone = warrantyDays === null ? null : warrantyDays < 0 ? tone.danger : warrantyDays <= 90 ? tone.warning : tone.success;

  return (
    <div className="space-y-5">
      <Link href="/assets" className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-ink">
        <LinkPendingIcon icon={<ChevronLeftIcon width={15} height={15} />} size={15} />
        {t("assets.detail.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
            <BoxIcon width={24} height={24} />
          </span>
          <div>
            <p className="font-mono text-xs text-muted">{asset.asset_tag}</p>
            <h1 className="text-2xl font-semibold">{asset.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={asset.status} label={asset.status_label} />
              {!canEdit && <span className="text-xs text-faint">{t("assets.detail.readOnly")}</span>}
            </div>
          </div>
        </div>
        {canEdit && (
          <Link href={`/assets/${asset.id}/edit`} className={btn.soft}>
            <LinkPendingIcon icon={<PencilIcon />} />
            {t("common.edit")}
          </Link>
        )}
      </div>

      <Section title={t("assets.detail.sectionInfo")} icon={<BoxIcon width={15} height={15} />}>
        <Item label={t("assets.col.category")}>{asset.category}</Item>
        <Item label={t("assets.detail.brandModel")}>{[asset.brand, asset.model].filter(Boolean).join(" ")}</Item>
        <Item label={t("assets.form.serial")}>
          {asset.serial_number && <span className="font-mono text-sm">{asset.serial_number}</span>}
        </Item>
        <Item label={t("assets.form.notes")}>{asset.notes && <span className="whitespace-pre-line font-normal">{asset.notes}</span>}</Item>
      </Section>

      <Section title={t("assets.detail.sectionPlace")} icon={<MapPinIcon width={15} height={15} />}>
        <Item label={t("assets.col.location")}>
          {asset.location && (
            <Link href={`/assets?location_id=${asset.location.id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
              {asset.location.name} <span className="font-mono text-xs text-muted">({asset.location.code})</span>
            </Link>
          )}
        </Item>
        <Item label={t("assets.col.custodian")}>
          {asset.custodian && (
            <span className="inline-flex items-center gap-1.5">
              <UserIcon width={14} height={14} className="text-accent-400" />
              {asset.custodian.name}
            </span>
          )}
        </Item>
      </Section>

      <Section title={t("assets.detail.sectionPurchase")} icon={<BoxIcon width={15} height={15} />}>
        <Item label={t("assets.form.purchaseDate")}>{asset.purchase_date && fmt.date(asset.purchase_date)}</Item>
        <Item label={t("assets.col.cost")}>{asset.purchase_cost && <span className="tabular-nums">{fmt.money(asset.purchase_cost)}</span>}</Item>
        <Item label={t("assets.form.warranty")}>
          {asset.warranty_expires_at && (
            <span className="flex flex-wrap items-center gap-2">
              {fmt.date(asset.warranty_expires_at)}
              {warrantyTone && warrantyDays !== null && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${warrantyTone.badge}`}>
                  {warrantyDays < 0 ? t("assets.detail.warrantyExpired") : t("assets.detail.warrantyLeft", { days: fmt.number(warrantyDays) })}
                </span>
              )}
            </span>
          )}
        </Item>
        <Item label={t("assets.detail.createdAt")}>{fmt.dateTime(asset.created_at)}</Item>
        <Item label={t("assets.detail.updatedAt")}>{fmt.dateTime(asset.updated_at)}</Item>
      </Section>

      <Suspense
        fallback={
          <section className={`p-4 sm:p-6 ${card}`}>
            <LoadingLabel text={t("movements.loading")} />
          </section>
        }
      >
        <Movements id={asset.id} />
      </Suspense>
    </div>
  );
}
