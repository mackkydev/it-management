import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BoxIcon, ChevronLeftIcon, KeyIcon, MonitorIcon, PencilIcon, UserIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { LoadingLabel } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canEditAssets, has, getAccess, getCurrentUser } from "@/lib/auth";
import { assetCategoryLabel, CATEGORY_FORM, type Asset, type Branch, type SoftwareRef } from "@/lib/types";
import { MovementSummary, RepairHistory, UserHistory } from "./history-sections";
import { TransferButton } from "./transfer-button";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getAsset(id: string) {
  try {
    return (await apiFetch<{ data: Asset }>(`/assets/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

/** จำนวนวันที่เหลือของประกัน (ติดลบ = หมดแล้ว) */
function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}

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
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
          {icon}
        </span>
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

/** License ที่ติดตั้งบนเครื่อง → หน้าซอฟต์แวร์ License นั้น */
function SoftwareLink({ sw }: { sw: SoftwareRef }) {
  return (
    <Link href={`/licenses/${sw.id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
      {sw.name}
    </Link>
  );
}

/** หน้ารายละเอียดสินทรัพย์แบบดูอย่างเดียว — ผู้มี assets.view ดูของที่ตัวเองถือครองได้ (ไม่มีสิทธิ์ = API ตอบ 404 → ไม่พบ) */
export async function AssetDetail({ id }: { id: string }) {
  if (!UUID_RE.test(id)) notFound();

  const [asset, user, { t, fmt }, can] = await Promise.all([getAsset(id), getCurrentUser(), getI18n(), getAccess()]);
  const form = CATEGORY_FORM[asset.category];
  const canEdit = canEditAssets(user) && can("btn:assets:edit");
  // ปุ่มโอนย้าย (สินทรัพย์ทั่วไป): เปลี่ยนสาขา + ผู้ถือครอง/ผู้ใช้งาน
  const branches = canEdit ? (await apiFetch<{ data: Branch[] }>("/branches")).data : [];
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
              {asset.is_loanable && (
                <span className="inline-flex items-center rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-medium text-accent-800 dark:bg-accent-400/15 dark:text-accent-200">
                  {t("assets.form.loanableBadge")}
                </span>
              )}
              {!canEdit && <span className="text-xs text-faint">{t("assets.detail.readOnly")}</span>}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {can("btn:assets:transfer") && <TransferButton assetId={asset.id} branches={branches} branchId={asset.branch?.id ?? null} holder={asset.custodian ?? null} />}
            <Link href={`/assets/${asset.id}/edit`} className={btn.soft}>
              <LinkPendingIcon icon={<PencilIcon />} />
              {t("common.edit")}
            </Link>
          </div>
        )}
      </div>

      {/* ข้อมูลทั่วไป = ข้อมูลสินทรัพย์ + ที่ตั้งและผู้ถือครอง (+ ชื่อ-สกุลผู้ใช้งานของทะเบียนคอมพิวเตอร์) */}
      <Section title={t("assets.detail.sectionInfo")} icon={<BoxIcon width={15} height={15} />}>
        <Item label={t("assets.col.category")}>{assetCategoryLabel(t, asset.category)}</Item>
        <Item label={t("assets.detail.brandModel")}>{[asset.brand, asset.model].filter(Boolean).join(" ")}</Item>
        <Item label={t("assets.form.serial")}>
          {asset.serial_number && <span className="font-mono text-sm">{asset.serial_number}</span>}
        </Item>
        <Item label={t("assets.col.branch")}>
          {asset.branch && (
            <Link href={`/assets?branch_id=${asset.branch.id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
              {asset.branch.name}
            </Link>
          )}
        </Item>
        <Item label={t("assets.col.location")}>
          {asset.location && (
            <Link href={`/assets?location_id=${asset.location.id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
              {asset.location.name} <span className="font-mono text-xs text-muted">({asset.location.code})</span>
            </Link>
          )}
        </Item>
        <Item label={t("assets.form.department")}>{asset.department}</Item>
        {/* ผู้ถือครอง = ผู้ใช้งาน (คนเดียวกัน) — ยังไม่ผูกผู้ใช้ = ชื่อจากทะเบียน Excel */}
        <Item label={t("assets.detail.holder")}>
          {asset.is_shared ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {t("assets.form.shared")}
              <span className="text-xs font-normal text-faint">{[asset.branch?.name, asset.department].filter(Boolean).join(" · ")}</span>
            </span>
          ) : asset.custodian ? (
            <span className="inline-flex items-center gap-1.5">
              <UserIcon width={14} height={14} className="text-accent-400" />
              {asset.custodian.name}
            </span>
          ) : (
            asset.user_name && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {asset.user_name}
                <span className="text-xs font-normal text-faint">{t("assets.detail.holderUnlinked")}</span>
              </span>
            )
          )}
        </Item>
        <Item label={t("assets.form.notes")} wide>
          {asset.notes && <span className="whitespace-pre-line font-normal">{asset.notes}</span>}
        </Item>
      </Section>

      {/* ทะเบียนคอมพิวเตอร์ — ช่องตามไฟล์ Excel ของฝ่าย IT (เลขที่ทรัพย์สิน Notebook เลิกแสดง — ค่าเดิมยังเก็บไว้) */}
      {form?.computer && (
        <Section title={t("assets.computer.section")} icon={<MonitorIcon width={15} height={15} />}>
          <Item label={t("assets.computer.hostName")}>
            <span className="font-mono text-sm">{asset.asset_tag}</span>
          </Item>
          <Item label={t("assets.computer.computerType")}>{asset.computer_type}</Item>
          <Item label={t("assets.computer.spec")}>{asset.computer_spec}</Item>
          <Item label={t("assets.computer.receivedDate")}>{asset.received_date && fmt.date(asset.received_date)}</Item>
          <Item label={t("assets.computer.startUseDate")}>{asset.start_use_date && fmt.date(asset.start_use_date)}</Item>
          <Item label={t("assets.computer.workGroup")}>{asset.work_group}</Item>
          <Item label={t("assets.computer.ip")}>{asset.ip_address && <span className="font-mono text-sm">{asset.ip_address}</span>}</Item>
          <Item label={t("assets.computer.mac")}>{asset.mac_address && <span className="font-mono text-sm">{asset.mac_address}</span>}</Item>
          {/* Email 365 ไม่อยู่ในฟอร์มแล้ว — แสดงเฉพาะค่าเดิมที่มี */}
          {asset.email_365 && <Item label={t("assets.computer.email365")}>{asset.email_365}</Item>}
          {/* เลขที่ทรัพย์สิน + เลขที่ทรัพย์สิน (เดิม) บรรทัดเดียวกันเสมอ */}
          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
            <Item label={t("assets.computer.cpuTag")}>{asset.cpu_tag && <span className="font-mono text-sm">{asset.cpu_tag}</span>}</Item>
            <Item label={t("assets.computer.monitorTag")}>{asset.monitor_tag && <span className="font-mono text-sm">{asset.monitor_tag}</span>}</Item>
          </div>
        </Section>
      )}

      {/* OS และ Software — ที่ผูก License แล้วคลิกไปหน้าซอฟต์แวร์ License นั้น, ข้อความที่ยังไม่ผูก (นำเข้า Excel) แสดงตามเดิม */}
      {form?.computer && (
        <Section title={t("assets.software.section")} icon={<KeyIcon width={15} height={15} />}>
          {(["os", "office", "antivirus"] as const).map((slot) => (
            <Item key={slot} label={t(`assets.computer.${slot}`)}>
              {asset.software?.[slot] ? <SoftwareLink sw={asset.software[slot]} /> : asset[slot]}
            </Item>
          ))}
          <Item label={t("assets.computer.otherSoftware")}>
            {(asset.software?.others.length || asset.other_software) && (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {asset.software?.others.map((o) => <SoftwareLink key={o.id} sw={o} />)}
                {asset.other_software
                  ?.split(/\r?\n/)
                  .filter(Boolean)
                  .map((name) => (
                    <span key={name}>{name}</span>
                  ))}
              </span>
            )}
          </Item>
        </Section>
      )}

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

      {/* ประวัติผู้ใช้งาน (ผู้ถือครอง/ผู้ใช้งาน) แสดงก่อนประวัติการโอนย้าย */}
      <Suspense fallback={<section className={`p-4 sm:p-6 ${card}`}><LoadingLabel text={t("assets.userLogs.loading")} /></section>}>
        <UserHistory id={asset.id} />
      </Suspense>

      <Suspense
        fallback={
          <section className={`p-4 sm:p-6 ${card}`}>
            <LoadingLabel text={t("movements.loading")} />
          </section>
        }
      >
        <MovementSummary id={asset.id} href={has(user, "movements.view") ? `/movements?search=${encodeURIComponent(asset.asset_tag)}` : undefined} />
      </Suspense>

      {/* ประวัติการซ่อม */}
      <Suspense fallback={<section className={`p-4 sm:p-6 ${card}`}><LoadingLabel text={t("assets.repairs.loading")} /></section>}>
        <RepairHistory
          id={asset.id}
          href={has(user, "assets.view_all") || has(user, "assets.update") ? `/repairs?search=${encodeURIComponent(asset.asset_tag)}` : undefined}
        />
      </Suspense>
    </div>
  );
}
