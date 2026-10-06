"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBranch, saveBranch } from "@/app/actions/it-data";
import { AlertIcon, CheckCircleIcon, PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Branch } from "@/lib/types";

type Draft = { code: string; name: string; work_group: string; sort_order: string; is_active: boolean };
const EMPTY: Draft = { code: "", name: "", work_group: "", sort_order: "0", is_active: true };

/** ตารางสาขาแบบแก้ไขในแถว: เพิ่มแถวใหม่ด้านบน, กดแก้ไขแล้วแถวกลายเป็นช่องกรอก */
export function BranchManager({ branches }: { branches: Branch[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const startEdit = (b: Branch | null) => {
    setEditing(b ? b.id : "new");
    setDraft(b ? { code: b.code, name: b.name, work_group: b.work_group ?? "", sort_order: String(b.sort_order), is_active: b.is_active } : { ...EMPTY, sort_order: String((branches.length + 1) * 10) });
    setErrors({});
    setFeedback(null);
  };

  const save = () => {
    const e: typeof errors = {};
    if (!/^[A-Za-z0-9\-_]+$/.test(draft.code.trim())) e.code = t("branches.validate.code");
    if (!draft.name.trim()) e.name = t("branches.validate.name");
    if (draft.work_group.trim() && !/^[A-Za-z0-9._-]+$/.test(draft.work_group.trim())) e.work_group = t("branches.validate.workGroup");
    if (Object.keys(e).length) return setErrors(e);
    start(async () => {
      const res = await saveBranch(editing === "new" ? null : (editing as number), {
        code: draft.code,
        name: draft.name,
        work_group: draft.work_group,
        sort_order: Number(draft.sort_order) || 0,
        is_active: draft.is_active,
      });
      if (res.ok) {
        setEditing(null);
        setFeedback({ ok: true, text: res.message ?? "" });
        router.refresh();
      } else {
        setErrors((res.errors ?? {}) as typeof errors);
        setFeedback({ ok: false, text: res.message ?? "" });
      }
    });
  };

  const remove = (b: Branch) => {
    if (!confirm(t("branches.confirmDelete", { name: b.name }))) return;
    start(async () => {
      const res = await deleteBranch(b.id);
      setFeedback({ ok: Boolean(res.ok), text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  };

  const editRow = (key: string | number) => (
    <tr key={key} className="bg-accent-50/50 dark:bg-accent-400/[0.05]">
      <td className={table.td}>
        <input aria-label={t("branches.code")} value={draft.code} maxLength={30} onChange={(e) => (setDraft({ ...draft, code: e.target.value }), setErrors({ ...errors, code: "" }))} className={`${input} font-mono uppercase ${errors.code ? inputError : ""}`} />
        {errors.code && <p className="mt-1 text-xs font-medium text-red-500">{errors.code}</p>}
      </td>
      <td className={table.td}>
        <input aria-label={t("branches.name")} value={draft.name} maxLength={255} onChange={(e) => (setDraft({ ...draft, name: e.target.value }), setErrors({ ...errors, name: "" }))} className={`${input} ${errors.name ? inputError : ""}`} />
        {errors.name && <p className="mt-1 text-xs font-medium text-red-500">{errors.name}</p>}
      </td>
      <td className={table.td}>
        <input
          aria-label={t("branches.workGroup")}
          value={draft.work_group}
          maxLength={50}
          placeholder="LAMPHUN"
          onChange={(e) => (setDraft({ ...draft, work_group: e.target.value }), setErrors({ ...errors, work_group: "" }))}
          className={`${input} font-mono uppercase ${errors.work_group ? inputError : ""}`}
        />
        {errors.work_group && <p className="mt-1 text-xs font-medium text-red-500">{errors.work_group}</p>}
      </td>
      <td className={table.td}>
        <input aria-label={t("branches.order")} type="number" min={0} max={9999} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} className={`${input} w-24`} />
      </td>
      <td className={table.td}>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} className="h-4 w-4 accent-[var(--accent-500)]" />
          {t("branches.active")}
        </label>
      </td>
      <td className={table.td} />
      <td className={`${table.td} whitespace-nowrap text-right`}>
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={save} disabled={pending} className={`${btn.primary} ${btn.sm}`}>
            {pending ? <SpinnerIcon width={13} height={13} /> : <SaveIcon width={13} height={13} />}
            {t("common.save")}
          </button>
          <button type="button" onClick={() => setEditing(null)} disabled={pending} className={`${btn.secondary} ${btn.sm}`}>
            <XIcon width={13} height={13} />
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      {feedback?.text && (
        <div role={feedback.ok ? "status" : "alert"} className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={() => startEdit(null)} disabled={editing !== null} className={btn.primary}>
          <PlusIcon />
          {t("branches.add")}
        </button>
      </div>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("branches.code")}</th>
              <th className={table.th}>{t("branches.name")}</th>
              <th className={table.th}>{t("branches.workGroup")}</th>
              <th className={table.th}>{t("branches.order")}</th>
              <th className={table.th}>{t("common.manage")}</th>
              <th className={table.th} />
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {editing === "new" && editRow("new")}
            {branches.map((b) =>
              editing === b.id ? (
                editRow(b.id)
              ) : (
                <tr key={b.id} className={`${table.row} ${b.is_active ? "" : "opacity-60"}`}>
                  <td className={`${table.td} font-mono text-xs`}>{b.code}</td>
                  <td className={`${table.td} font-medium`}>{b.name}</td>
                  <td className={`${table.td} font-mono text-xs text-muted`}>{b.work_group ?? "-"}</td>
                  <td className={`${table.td} text-muted`}>{b.sort_order}</td>
                  <td className={table.td}>
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${b.is_active ? tone.success.badge : tone.idle.badge}`}>
                      {b.is_active ? t("branches.active") : t("branches.inactive")}
                    </span>
                  </td>
                  <td className={`${table.td} whitespace-nowrap text-xs text-muted`}>
                    {t("branches.usage", { users: fmt.number(b.users_count ?? 0), tickets: fmt.number(b.tickets_count ?? 0) })}
                  </td>
                  <td className={`${table.td} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => startEdit(b)} disabled={editing !== null} className={`${btn.soft} ${btn.sm}`}>
                        <PencilIcon width={13} height={13} />
                        {t("common.edit")}
                      </button>
                      {(b.users_count ?? 0) + (b.tickets_count ?? 0) > 0 ? (
                        <Tooltip label={t("branches.deleteBlocked")} side="top">
                          <button type="button" disabled className={`${btn.danger} ${btn.sm}`} aria-label={t("common.delete")}>
                            <TrashIcon width={13} height={13} />
                          </button>
                        </Tooltip>
                      ) : (
                        <button type="button" onClick={() => remove(b)} disabled={pending || editing !== null} className={`${btn.danger} ${btn.sm}`} aria-label={t("common.delete")}>
                          <TrashIcon width={13} height={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
