"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addGroupMembers, removeGroupMember, setMemberExpiry } from "@/app/actions/access-review";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, PlusIcon, SaveIcon, ShieldIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { alert, btn, card, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { GroupMember, GroupMembersView } from "@/lib/types";
import { HelperPicker } from "../tickets/[id]/helpers-card";

type Group = { key: string; name_th: string; name_en: string; is_system: boolean; members: number };

/** แท็บ "สมาชิกกลุ่ม": เลือกกลุ่ม → สมาชิกที่มอบเพิ่ม (แก้วันหมดอายุ / เอาออก) + เพิ่มสมาชิก + ผู้ที่อยู่ตามตำแหน่ง (อ่านอย่างเดียว) */
export function GroupMembers({ groups, view }: { groups: Group[]; view: GroupMembersView }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [picked, setPicked] = useState<number[]>([]);
  const [expires, setExpires] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  const name = (g: { name_th: string; name_en: string }) => (locale === "en" ? g.name_en : g.name_th);

  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const add = () => run(() => addGroupMembers(view.group.key, picked, expires || null), () => (setPicked([]), setExpires("")));
  const remove = async (m: GroupMember) => {
    if (!(await confirm(t("accessReview.members.confirmRemove", { name: m.user.name, group: name(view.group) })))) return;
    run(() => removeGroupMember(view.group.key, m.user.id));
  };

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-end gap-3 p-4 ${card}`}>
        <div className="min-w-56 flex-1">
          <label htmlFor="ar-group" className="mb-1 block text-xs font-medium">
            {t("accessReview.members.group")}
          </label>
          <AppSelect
            id="ar-group"
            value={view.group.key}
            onValueChange={(key) => router.push(`/access-review?tab=groups&group=${encodeURIComponent(key)}`)}
            options={groups.map((g) => ({ value: g.key, label: `${name(g)} (${g.members})` }))}
          />
        </div>
        <p className="text-xs text-muted">{t(view.group.is_system ? "accessReview.members.systemHint" : "accessReview.members.customHint")}</p>
      </div>

      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
          {result.message}
        </p>
      )}

      {view.can_manage ? (
        <section className={`space-y-3 p-4 ${card}`}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PlusIcon width={16} height={16} className="text-accent-500" />
            {t("accessReview.members.addTitle", { group: name(view.group) })}
          </h2>
          <HelperPicker
            options={view.user_options.map((o) => ({ ...o, busy: null }))}
            value={picked}
            onChange={setPicked}
            searchLabel={t("accessReview.members.search")}
            noMatchLabel={t("accessReview.members.noMatch")}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="ar-expires" className="mb-1 block text-xs font-medium">
                {t("accessReview.expiresOn")}
              </label>
              <DateInput id="ar-expires" value={expires} onChange={setExpires} className="max-w-44" />
            </div>
            <button type="button" onClick={add} disabled={pending || picked.length === 0} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
              {pending ? <SpinnerIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
              {t("accessReview.members.add", { count: picked.length })}
            </button>
          </div>
          <p className="text-xs text-muted">{t(view.expiry_enabled ? "accessReview.expiryHint" : "accessReview.expiryOff")}</p>
        </section>
      ) : (
        <p className={alert.warning}>
          <AlertIcon className="shrink-0" />
          {t("accessReview.members.cannotManage")}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("accessReview.members.assignedTitle", { count: view.members.length })}</h2>
        {view.members.length === 0 ? (
          <p className={`p-4 text-sm text-muted ${card}`}>{t("accessReview.members.empty")}</p>
        ) : (
          <>
            <div className={`hidden md:block ${table.wrap}`}>
              <table className={table.table}>
                <thead className={table.head}>
                  <tr>
                    <th className={table.th}>{t("accessReview.user")}</th>
                    <th className={table.th}>{t("accessReview.grantedBy")}</th>
                    <th className={table.th}>{t("accessReview.expiresOn")}</th>
                    <th className={table.th} />
                  </tr>
                </thead>
                <tbody className={table.body}>
                  {view.members.map((m) => (
                    <MemberRow key={m.user.id} m={m} group={view.group.key} pending={pending} run={run} onRemove={() => remove(m)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {view.members.map((m) => (
                <MemberRow key={m.user.id} m={m} group={view.group.key} pending={pending} run={run} onRemove={() => remove(m)} card />
              ))}
            </div>
          </>
        )}
      </section>

      {view.group.is_system && (
        <section className={`space-y-2 p-4 ${card}`}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldIcon width={16} height={16} className="text-muted" />
            {t("accessReview.members.byRoleTitle", { role: t(`roles.${view.group.key}` as MessageKey), count: view.role_members.length })}
          </h2>
          <p className="text-xs text-muted">{t("accessReview.members.byRoleHint")}</p>
          {view.role_members.length === 0 ? (
            <p className="text-sm text-muted">{t("accessReview.members.empty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {view.role_members.map((r) => (
                <li key={r.id}>
                  <Link href={`/users/${r.id}/permissions`} className="inline-block cursor-pointer rounded-full bg-subtle px-2.5 py-0.5 text-xs hover:bg-accent-50 dark:hover:bg-accent-400/10">
                    {r.name}
                    {r.department ? ` · ${r.department}` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function MemberRow({
  m,
  group,
  pending,
  run,
  onRemove,
  card: asCard = false,
}: {
  m: GroupMember;
  group: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok?: boolean; message?: string }>) => void;
  onRemove: () => void;
  card?: boolean;
}) {
  const { t, fmt } = useI18n();
  const [expires, setExpires] = useState(m.expires_on ?? "");
  const dirty = expires !== (m.expires_on ?? "");
  const userCell = (
    <div className="min-w-0">
      <Link href={`/users/${m.user.id}/permissions`} className="cursor-pointer font-medium hover:underline">
        {m.user.name}
      </Link>
      <p className="truncate text-xs text-muted">
        {t(`roles.${m.user.role}` as MessageKey)}
        {m.user.department ? ` · ${m.user.department}` : ""}
        {m.user.branch ? ` · ${m.user.branch}` : ""}
        {!m.user.is_active && ` · ${t("accessReview.inactive")}`}
      </p>
    </div>
  );
  const granted = (
    <span className="text-xs text-muted">
      {m.granted_by?.name ?? "-"}
      {m.granted_at ? ` · ${fmt.date(m.granted_at)}` : ""}
    </span>
  );
  const expiry = m.can_edit ? (
    <div className="flex items-center gap-2">
      <DateInput id={`exp-${m.user.id}`} value={expires} onChange={setExpires} className="max-w-40" />
      {dirty && (
        <button type="button" onClick={() => run(() => setMemberExpiry(group, m.user.id, expires || null))} disabled={pending} className={`${btn.soft} ${btn.sm} disabled:cursor-not-allowed`}>
          {pending ? <SpinnerIcon width={13} height={13} /> : <SaveIcon width={13} height={13} />}
          {t("common.save")}
        </button>
      )}
      {m.expired && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.danger.badge}`}>{t("accessReview.expired")}</span>}
    </div>
  ) : (
    <span className="text-sm">
      {m.expires_on ? fmt.date(m.expires_on) : t("accessReview.noExpiry")}
      {m.expired && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${tone.danger.badge}`}>{t("accessReview.expired")}</span>}
    </span>
  );
  const removeBtn = m.can_edit && (
    <button type="button" onClick={onRemove} disabled={pending} className={`${btn.danger} ${btn.sm} disabled:cursor-not-allowed`}>
      <TrashIcon width={13} height={13} />
      {t("accessReview.members.remove")}
    </button>
  );

  if (asCard) {
    return (
      <div className={`space-y-2 p-3 ${card}`}>
        {userCell}
        {granted}
        {expiry}
        <div className="flex justify-end">{removeBtn}</div>
      </div>
    );
  }
  return (
    <tr className={table.row}>
      <td className={table.td}>{userCell}</td>
      <td className={table.td}>{granted}</td>
      <td className={table.td}>{expiry}</td>
      <td className={`${table.td} text-right`}>{removeBtn}</td>
    </tr>
  );
}
