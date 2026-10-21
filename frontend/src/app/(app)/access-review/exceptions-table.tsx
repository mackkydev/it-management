"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeGroupMember, revokeOverride } from "@/app/actions/access-review";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, SearchIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { alert, btn, card, input, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { AccessException } from "@/lib/types";

type Kind = "all" | AccessException["kind"];
type Status = "all" | "active" | "expired" | "no_expiry";

const KIND_TONE: Record<AccessException["kind"], string> = { group: tone.info.badge, allow: tone.success.badge, deny: tone.warning.badge };

/**
 * แท็บ "สิทธิ์รายคนพิเศษ": ทุกการมอบที่ไม่ได้มาจากตำแหน่ง — กลุ่มที่มอบเพิ่ม / อนุญาต / ไม่อนุญาตรายข้อ
 * พร้อมผู้มอบ วันที่มอบ วันหมดอายุ — ยกเลิกได้จากหน้านี้ (กลุ่ม = เอาออกจากกลุ่ม, รายข้อ = กลับไปใช้ตามกลุ่ม)
 */
export function ExceptionsTable({ items, expiryEnabled }: { items: AccessException[]; expiryEnabled: boolean }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<Status>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [, start] = useTransition();

  const label = (i: AccessException) => (locale === "en" ? i.name_en : i.name_th);
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (kind === "all" || i.kind === kind) &&
      (status === "all" || (status === "expired" ? i.expired : status === "active" ? !i.expired : i.expires_on === null)) &&
      (!needle || [i.user.name, i.user.email ?? "", i.user.department ?? "", label(i), i.key].some((x) => x.toLowerCase().includes(needle))),
  );
  const noExpiry = items.filter((i) => i.expires_on === null).length;

  const revoke = async (i: AccessException) => {
    if (!(await confirm(t("accessReview.exceptions.confirmRevoke", { name: i.user.name, item: label(i) })))) return;
    const id = `${i.kind}:${i.user.id}:${i.key}`;
    setBusy(id);
    start(async () => {
      const res = i.kind === "group" ? await removeGroupMember(i.key, i.user.id) : await revokeOverride(i.user.id, i.key);
      setResult(res);
      setBusy(null);
      if (res.ok) router.refresh();
    });
  };

  const kindBadge = (i: AccessException) => (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${KIND_TONE[i.kind]}`}>{t(`accessReview.kinds.${i.kind}`)}</span>
  );
  const expiry = (i: AccessException) => (
    <span className="whitespace-nowrap text-sm">
      {i.expires_on ? fmt.date(i.expires_on) : <span className="text-muted">{t("accessReview.noExpiry")}</span>}
      {i.expired && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${tone.danger.badge}`}>{t("accessReview.expired")}</span>}
    </span>
  );
  const userCell = (i: AccessException) => (
    <div className="min-w-0">
      <Link href={`/users/${i.user.id}/permissions`} className="cursor-pointer font-medium hover:underline">
        {i.user.name}
      </Link>
      <p className="truncate text-xs text-muted">
        {t(`roles.${i.user.role}` as MessageKey)}
        {i.user.department ? ` · ${i.user.department}` : ""}
        {!i.user.is_active && ` · ${t("accessReview.inactive")}`}
      </p>
    </div>
  );
  const granted = (i: AccessException) => (
    <span className="text-xs text-muted">
      {i.granted_by?.name ?? "-"}
      {i.granted_at ? ` · ${fmt.date(i.granted_at)}` : ""}
    </span>
  );
  const action = (i: AccessException) => {
    const id = `${i.kind}:${i.user.id}:${i.key}`;
    return i.can_revoke ? (
      <button type="button" onClick={() => revoke(i)} disabled={busy !== null} className={`${btn.danger} ${btn.sm} disabled:cursor-not-allowed`}>
        {busy === id ? <SpinnerIcon width={13} height={13} /> : <TrashIcon width={13} height={13} />}
        {t("accessReview.exceptions.revoke")}
      </button>
    ) : (
      <span className="text-xs text-faint">{t("accessReview.exceptions.cannotRevoke")}</span>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] ${card}`}>
        <div className="relative">
          <SearchIcon width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("accessReview.exceptions.search")}
            aria-label={t("accessReview.exceptions.search")}
            className={`${input} pl-9`}
          />
        </div>
        <AppSelect
          value={kind}
          onValueChange={(v) => setKind(v as Kind)}
          aria-label={t("accessReview.exceptions.kind")}
          options={(["all", "group", "allow", "deny"] as const).map((k) => ({ value: k, label: k === "all" ? t("accessReview.exceptions.allKinds") : t(`accessReview.kinds.${k}`) }))}
        />
        <AppSelect
          value={status}
          onValueChange={(v) => setStatus(v as Status)}
          aria-label={t("accessReview.exceptions.status")}
          options={(["all", "active", "expired", "no_expiry"] as const).map((s) => ({ value: s, label: t(`accessReview.statuses.${s}`) }))}
        />
      </div>

      {!expiryEnabled && (
        <p className={alert.warning}>
          <AlertIcon className="shrink-0" />
          {t("accessReview.expiryOff")}
        </p>
      )}
      {noExpiry > 0 && (
        <p className="text-xs text-muted">{t("accessReview.exceptions.noExpiryCount", { count: noExpiry })}</p>
      )}
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
          {result.message}
        </p>
      )}

      <p className="text-sm text-muted">{t("accessReview.exceptions.count", { count: shown.length })}</p>
      {shown.length === 0 ? (
        <p className={`p-6 text-center text-sm text-muted ${card}`}>{t(items.length ? "accessReview.exceptions.noMatch" : "accessReview.exceptions.empty")}</p>
      ) : (
        <>
          <div className={`hidden md:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("accessReview.user")}</th>
                  <th className={table.th}>{t("accessReview.exceptions.kind")}</th>
                  <th className={table.th}>{t("accessReview.exceptions.item")}</th>
                  <th className={table.th}>{t("accessReview.grantedBy")}</th>
                  <th className={table.th}>{t("accessReview.expiresOn")}</th>
                  <th className={table.th} />
                </tr>
              </thead>
              <tbody className={table.body}>
                {shown.map((i) => (
                  <tr key={`${i.kind}:${i.user.id}:${i.key}`} className={table.row}>
                    <td className={table.td}>{userCell(i)}</td>
                    <td className={table.td}>{kindBadge(i)}</td>
                    <td className={table.td}>{label(i)}</td>
                    <td className={table.td}>{granted(i)}</td>
                    <td className={table.td}>{expiry(i)}</td>
                    <td className={`${table.td} text-right`}>{action(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {shown.map((i) => (
              <div key={`${i.kind}:${i.user.id}:${i.key}`} className={`space-y-2 p-3 ${card}`}>
                <div className="flex items-start justify-between gap-2">
                  {userCell(i)}
                  {kindBadge(i)}
                </div>
                <p className="text-sm">{label(i)}</p>
                {granted(i)}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {expiry(i)}
                  {action(i)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
