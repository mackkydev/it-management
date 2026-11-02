import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { btn, card, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MissingAsset } from "@/lib/types";

/** ปุ่มเพิ่มเข้าระบบ — เติมเลขที่ทรัพย์สิน + ชื่อเครื่องจากใบแจ้งซ่อมให้ */
function addHref(m: MissingAsset) {
  const q = new URLSearchParams({ asset_no: m.asset_no });
  if (m.device_name) q.set("name", m.device_name.slice(0, 255));
  return `/assets/new?${q}` as const;
}

/**
 * แท็บ "สินทรัพย์ที่ต้องเพิ่ม" — เลขทรัพย์สินที่ผู้แจ้งพิมพ์ในใบแจ้งซ่อมแต่ไม่พบในระบบ (ไม่ตรงรหัส / เลขที่ทรัพย์สิน / เลขที่ทรัพย์สิน (เดิม))
 * เพิ่มสินทรัพย์ที่มีเลขนั้นแล้ว = หายจากรายการเอง
 */
export async function MissingAssets({ items }: { items: MissingAsset[] }) {
  const { t, fmt } = await getI18n();
  if (items.length === 0) return <div className={`p-10 text-center text-muted ${card}`}>{t("assets.missing.empty")}</div>;

  const ticket = (m: MissingAsset) => (
    <span className="min-w-0">
      <Link href={`/tickets/${m.last_ticket.id}`} className="cursor-pointer font-mono text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">
        {m.last_ticket.ticket_no}
      </Link>
      <span className="ml-1.5 text-xs text-muted">{fmt.date(m.last_ticket.requested_at)}</span>
      {m.tickets > 1 && <span className="ml-1.5 text-xs text-faint">{t("assets.missing.moreTickets", { count: fmt.number(m.tickets - 1) })}</span>}
    </span>
  );
  const add = (m: MissingAsset, full = false) => (
    <Link href={addHref(m)} className={full ? `${btn.primary} mt-3 w-full` : `${btn.primary} ${btn.sm}`}>
      <LinkPendingIcon icon={<PlusIcon width={13} height={13} />} size={13} />
      {t("assets.missing.add")}
    </Link>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("assets.missing.hint", { count: fmt.number(items.length) })}</p>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("assets.missing.assetNo")}</th>
              <th className={table.th}>{t("assets.missing.device")}</th>
              <th className={table.th}>{t("assets.missing.ticket")}</th>
              <th className={table.th}>{t("assets.missing.requester")}</th>
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((m) => (
              <tr key={m.asset_no} className={`${table.row} align-top`}>
                <td className={`${table.td} whitespace-nowrap font-mono text-sm`}>{m.asset_no}</td>
                <td className={table.td}>
                  {m.device_name ?? "-"}
                  {m.last_ticket.symptom && <div className="line-clamp-1 text-xs text-muted">{m.last_ticket.symptom}</div>}
                </td>
                <td className={table.td}>{ticket(m)}</td>
                <td className={table.td}>
                  {m.last_ticket.requester ?? "-"}
                  {m.last_ticket.branch && <div className="text-xs text-muted">{m.last_ticket.branch}</div>}
                </td>
                <td className={`${table.td} whitespace-nowrap text-right`}>{add(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
        {items.map((m) => (
          <li key={m.asset_no} className={`p-4 ${card}`}>
            <p className="font-mono text-sm font-medium">{m.asset_no}</p>
            <p className="text-sm">{m.device_name ?? "-"}</p>
            {m.last_ticket.symptom && <p className="line-clamp-2 text-xs text-muted">{m.last_ticket.symptom}</p>}
            <p className="mt-2">{ticket(m)}</p>
            <p className="text-xs text-muted">{[m.last_ticket.requester, m.last_ticket.branch].filter(Boolean).join(" · ")}</p>
            {add(m, true)}
          </li>
        ))}
      </ul>
    </div>
  );
}
