import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DocumentLink } from "@/components/document-viewer";
import { FileTextIcon, PencilIcon, TruckIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canViewAssets, getAccess, getCurrentUser, has } from "@/lib/auth";
import type { RepairOrder } from "@/lib/types";
import { CancelButton } from "../cancel-button";
import { ReturnButton } from "../return-button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("repairOrders.detailTitle") };
}

const Item = ({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) => (
  <div className={wide ? "sm:col-span-2" : undefined}>
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 whitespace-pre-line text-sm">{children}</dd>
  </div>
);

function Files({ files, label }: { files: RepairOrder["files"]; label: string }) {
  if (files.length === 0) return null;
  return (
    <div className="sm:col-span-2">
      <p className="mb-2 text-xs text-muted">{label}</p>
      <ul className="space-y-1.5">
        {files.map((f) => (
          <li key={f.id}>
            <DocumentLink href={`/files${f.url}`} name={f.name} className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
              <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
            </DocumentLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** รายละเอียดรายการส่งซ่อม (ลิงก์จากประวัติใบแจ้งงาน — เปิดได้เฉพาะ repair_orders.view) */
export default async function RepairOrderPage({ params }: PageProps<"/it/repair-orders/[id]">) {
  const [{ id }, user, { t, fmt }, can] = await Promise.all([params, getCurrentUser(), getI18n(), getAccess()]);
  if (!has(user, "repair_orders.view")) redirect("/dashboard");
  const { data: r } = await apiFetch<{ data: RepairOrder }>(`/repair-orders/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const returned = r.status === "returned";

  return (
    <div className="space-y-5">
      <PageHeader
        icon={TruckIcon}
        title={r.item_name}
        subtitle={r.item_no ?? t("repairOrders.detailTitle")}
        actions={
          r.can_return && (
            <span className="flex flex-wrap gap-2">
              {can("btn:repair-orders:return") && <ReturnButton id={r.id} item={r.item_name} />}
              {can("btn:repair-orders:edit") && (
                <Link href={`/it/repair-orders/${r.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                  <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                  {t("common.edit")}
                </Link>
              )}
              {can("btn:repair-orders:cancel") && <CancelButton id={r.id} item={r.item_name} />}
            </span>
          )
        }
      />

      <section className={`p-4 sm:p-6 ${card}`}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("repairOrders.form.itemSection")}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${returned ? tone.success.badge : r.status === "cancelled" ? tone.idle.badge : tone.warning.badge}`}>{t(`repairOrders.tabs.${r.status}`)}</span>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Item label={t("repairOrders.form.itemNo")}>
            {r.asset_id && canViewAssets(user) ? (
              <Link href={`/assets/${r.asset_id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
                {r.item_no ?? r.item_name}
              </Link>
            ) : (
              (r.item_no ?? "—")
            )}
          </Item>
          <Item label={t("repairOrders.form.itemName")}>{r.item_name}</Item>
          {(r.brand || r.model) && <Item label={t("repairOrders.form.brandModel")}>{[r.brand, r.model].filter(Boolean).join(" ")}</Item>}
          {r.serial_number && <Item label={t("repairOrders.form.serial")}>{r.serial_number}</Item>}
          {r.holder && <Item label={t("repairOrders.form.holder")}>{r.holder}</Item>}
          {r.ticket && (
            <Item label={t("repairOrders.col.ticket")}>
              <Link href={`/tickets/${r.ticket.id}`} className="cursor-pointer font-mono text-accent-700 hover:underline dark:text-accent-300">
                {r.ticket.ticket_no}
              </Link>
            </Item>
          )}
          <Item label={t("repairOrders.form.symptom")} wide>
            {r.symptom}
          </Item>
        </dl>
      </section>

      <section className={`p-4 sm:p-6 ${card}`}>
        <h2 className="mb-4 font-semibold">{t("repairOrders.form.sendSection")}</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Item label={t("repairOrders.form.vendor")}>
            {r.vendor.name}
            <span className="block text-xs text-muted">
              {r.vendor.contact_name} · {r.vendor.contact_phone}
            </span>
          </Item>
          <Item label={t("repairOrders.col.sent")}>
            {fmt.date(r.sent_on)} {r.sent_time}
            <span className="block text-xs text-muted">{r.sent_by.name}</span>
          </Item>
          {r.document_no && <Item label={t("repairOrders.form.documentNo")}>{r.document_no}</Item>}
          {r.item_details && (
            <Item label={t("repairOrders.form.itemDetails")} wide>
              {r.item_details}
            </Item>
          )}
          <Files files={r.files.filter((f) => f.kind === "send")} label={t("repairOrders.form.files")} />
        </dl>
      </section>

      {r.status === "cancelled" && (
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("repairOrders.cancel.section")}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Item label={t("repairOrders.col.cancelled")}>
              {r.cancelled_at && fmt.dateTime(r.cancelled_at)}
              <span className="block text-xs text-muted">{r.cancelled_by?.name}</span>
            </Item>
            <Item label={t("repairOrders.cancel.reason")}>{r.cancel_reason}</Item>
          </dl>
        </section>
      )}

      {returned && (
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("repairOrders.return.section")}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Item label={t("repairOrders.col.returned")}>
              {r.returned_at && fmt.dateTime(r.returned_at)}
              <span className="block text-xs text-muted">{r.received_by?.name}</span>
            </Item>
            {r.return_note && <Item label={t("repairOrders.return.note")}>{r.return_note}</Item>}
            <Files files={r.files.filter((f) => f.kind === "return")} label={t("repairOrders.return.files")} />
          </dl>
        </section>
      )}
    </div>
  );
}
