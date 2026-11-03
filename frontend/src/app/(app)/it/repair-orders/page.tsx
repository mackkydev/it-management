import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, TruckIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { LinkPendingIcon, SubmitButton } from "@/components/pending";
import { alert, btn, card, input, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { Paginated, RepairOrder } from "@/lib/types";
import { CancelButton } from "./cancel-button";
import { ReturnButton } from "./return-button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("repairOrders.title") };
}

const TABS = ["sent", "returned", "cancelled"] as const;
const TAB_CLS = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/** งานฝ่าย IT → รายการส่งซ่อม — แท็บ ส่งซ่อมอยู่ (ปุ่มรับเครื่องซ่อมคืน + ตัวเลขแดง) / รับคืนแล้ว */
export default async function RepairOrdersPage({ searchParams }: PageProps<"/it/repair-orders">) {
  const [sp, user, { t, fmt }, can] = await Promise.all([searchParams, getCurrentUser(), getI18n(), getAccess()]);
  if (!has(user, "repair_orders.view")) redirect("/dashboard");
  const status = TABS.find((s) => s === sp.status) ?? "sent";
  const search = typeof sp.search === "string" ? sp.search : "";
  const page = typeof sp.page === "string" && /^\d+$/.test(sp.page) ? sp.page : "1";
  const query = new URLSearchParams({ status, page, ...(search ? { search } : {}) });
  const res = await apiFetch<Paginated<RepairOrder> & { meta: { counts: { sent: number } } }>(`/repair-orders?${query}`);
  const canReturn = can("btn:repair-orders:return");
  const canEdit = can("btn:repair-orders:edit");
  const canCancel = can("btn:repair-orders:cancel");
  const pageHref = (n: number) => `/it/repair-orders?${new URLSearchParams({ status, page: String(n), ...(search ? { search } : {}) })}`;
  const sentAt = (r: RepairOrder) => `${fmt.date(r.sent_on)} ${r.sent_time}`;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={TruckIcon}
        title={t("repairOrders.title")}
        subtitle={t("repairOrders.subtitle")}
        actions={
          has(user, "repair_orders.manage") &&
          can("btn:repair-orders:create") && (
            <Link href="/it/repair-orders/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("repairOrders.add")}
            </Link>
          )
        }
      />

      {sp.saved === "sent" && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t("repairOrders.saved")}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
          {TABS.map((s) => (
            <Link key={s} href={`/it/repair-orders?status=${s}`} aria-current={s === status ? "page" : undefined} className={`inline-flex cursor-pointer items-center gap-2 ${TAB_CLS(s === status)}`}>
              {t(`repairOrders.tabs.${s}`)}
              {s === "sent" && res.meta.counts.sent > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-500 px-1.5 text-[11px] font-semibold text-white">{res.meta.counts.sent > 99 ? "99+" : res.meta.counts.sent}</span>
              )}
            </Link>
          ))}
        </nav>
        <Form action="/it/repair-orders" className="flex gap-2 sm:w-96">
          <input type="hidden" name="status" value={status} />
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
            <input name="search" defaultValue={search} maxLength={100} placeholder={t("repairOrders.searchPlaceholder")} aria-label={t("common.search")} className={`${input} pl-9`} />
          </div>
          <SubmitButton icon={<SearchIcon />} pendingText={t("common.searching")} className={`${btn.primary} whitespace-nowrap`}>
            {t("common.search")}
          </SubmitButton>
        </Form>
      </div>

      {res.data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t(`repairOrders.empty.${status}`)}</div>
      ) : (
        <>
          {/* จอใหญ่: ตาราง */}
          <div className={`hidden lg:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("repairOrders.col.item")}</th>
                  <th className={table.th}>{t("repairOrders.col.symptom")}</th>
                  <th className={table.th}>{t("repairOrders.col.vendor")}</th>
                  <th className={table.th}>{t("repairOrders.col.sent")}</th>
                  {status === "returned" && <th className={table.th}>{t("repairOrders.col.returned")}</th>}
                  {status === "cancelled" && <th className={table.th}>{t("repairOrders.col.cancelled")}</th>}
                  <th className={table.th}>{t("repairOrders.col.ticket")}</th>
                  <th className={table.th} aria-label={t("common.manage")} />
                </tr>
              </thead>
              <tbody className={table.body}>
                {res.data.map((r) => (
                  <tr key={r.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/it/repair-orders/${r.id}`} className="group block cursor-pointer">
                        {r.item_no && <span className="font-mono text-xs text-accent-700 group-hover:underline dark:text-accent-300">{r.item_no}</span>}
                        <span className="block font-medium group-hover:underline">{r.item_name}</span>
                      </Link>
                    </td>
                    <td className={`${table.td} max-w-64`}>
                      <span className="line-clamp-2 text-muted">{r.symptom}</span>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{r.vendor.name}</td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      {sentAt(r)}
                      <span className="block text-xs text-muted">{r.sent_by.name}</span>
                    </td>
                    {status === "returned" && (
                      <td className={`${table.td} whitespace-nowrap`}>
                        {r.returned_at && fmt.dateTime(r.returned_at)}
                        <span className="block text-xs text-muted">{r.received_by?.name}</span>
                      </td>
                    )}
                    {status === "cancelled" && (
                      <td className={`${table.td} max-w-56`}>
                        {r.cancelled_at && fmt.dateTime(r.cancelled_at)}
                        <span className="block text-xs text-muted">{r.cancelled_by?.name}</span>
                        <span className="line-clamp-2 text-xs text-muted">{r.cancel_reason}</span>
                      </td>
                    )}
                    <td className={`${table.td} whitespace-nowrap`}>
                      {r.ticket ? (
                        <Link href={`/tickets/${r.ticket.id}`} className="cursor-pointer font-mono text-xs text-accent-700 hover:underline dark:text-accent-300">
                          {r.ticket.ticket_no}
                        </Link>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-right`}>
                      <span className="inline-flex items-center gap-2">
                        {r.files.length > 0 && (
                          <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted">
                            <PaperclipIcon width={13} height={13} />
                            {fmt.number(r.files.length)}
                          </span>
                        )}
                        {r.can_return && canReturn && <ReturnButton id={r.id} item={r.item_name} />}
                        {r.can_return && canEdit && (
                          <Link href={`/it/repair-orders/${r.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                            <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                            {t("common.edit")}
                          </Link>
                        )}
                        {r.can_return && canCancel && <CancelButton id={r.id} item={r.item_name} />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* มือถือ: การ์ด */}
          <ul className="space-y-3 lg:hidden">
            {res.data.map((r) => (
              <li key={r.id} className={`space-y-2 p-4 ${card}`}>
                <Link href={`/it/repair-orders/${r.id}`} className="block cursor-pointer">
                  {r.item_no && <span className="font-mono text-xs text-accent-700 dark:text-accent-300">{r.item_no}</span>}
                  <span className="block font-medium">{r.item_name}</span>
                </Link>
                <p className="line-clamp-2 text-sm text-muted">{r.symptom}</p>
                <p className="text-sm">{r.vendor.name}</p>
                <p className="text-xs text-muted">
                  {t("repairOrders.sentLine", { when: sentAt(r), name: r.sent_by.name })}
                  {r.returned_at && (
                    <span className="block">{t("repairOrders.returnedLine", { when: fmt.dateTime(r.returned_at), name: r.received_by?.name ?? "-" })}</span>
                  )}
                  {r.cancelled_at && (
                    <span className="block">{t("repairOrders.cancelledLine", { when: fmt.dateTime(r.cancelled_at), name: r.cancelled_by?.name ?? "-", reason: r.cancel_reason ?? "-" })}</span>
                  )}
                </p>
                {r.ticket && (
                  <Link href={`/tickets/${r.ticket.id}`} className="block cursor-pointer font-mono text-xs text-accent-700 hover:underline dark:text-accent-300">
                    {r.ticket.ticket_no}
                  </Link>
                )}
                {r.can_return && canReturn && <ReturnButton id={r.id} item={r.item_name} full />}
                {r.can_return && (canEdit || canCancel) && (
                  <div className="grid grid-cols-2 gap-2">
                    {canEdit && (
                      <Link href={`/it/repair-orders/${r.id}/edit`} className={`${btn.soft} w-full`}>
                        <LinkPendingIcon icon={<PencilIcon width={14} height={14} />} size={14} />
                        {t("common.edit")}
                      </Link>
                    )}
                    {canCancel && <CancelButton id={r.id} item={r.item_name} full />}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination meta={res.meta} href={pageHref} />
        </>
      )}
    </div>
  );
}
