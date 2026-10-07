"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteOrgUnit, saveOrgUnit, type OrgTable } from "@/app/actions/org-units";
import { AlertIcon, CheckCircleIcon, CheckIcon, PencilIcon, PlusIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OrgUnit } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";

type Draft = { name: string; is_active: boolean; sort_order: string };
const EMPTY: Draft = { name: "", is_active: true, sort_order: "0" };
const ICON_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** จัดการแผนก / ฝ่าย แบบแก้ในแถว — เพิ่มด้านบน, แก้ไข/ลบในตาราง */
export function OrgUnitManager({ table, items }: { table: OrgTable; items: OrgUnit[] }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const open = (u: OrgUnit | null) => {
    setEditing(u ? u.id : "new");
    setDraft(u ? { name: u.name, is_active: u.is_active, sort_order: String(u.sort_order) } : EMPTY);
    setError("");
  };
  const save = () =>
    start(async () => {
      const res = await saveOrgUnit(table, editing === "new" ? null : editing, { name: draft.name, is_active: draft.is_active, sort_order: Number(draft.sort_order) || 0 });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else setError(res.errors?.name ?? res.errors?.sort_order ?? "");
      setFeedback({ ok: Boolean(res.ok), text: res.message ?? "" });
    });
  const remove = async (u: OrgUnit) => {
    if (!(await confirm(t("orgUnits.confirmDelete", { name: u.name })))) return;
    start(async () => {
      const res = await deleteOrgUnit(table, u.id);
      setFeedback({ ok: Boolean(res.ok), text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  };

  const editor = (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-48 flex-1">
        <input
          autoFocus
          value={draft.name}
          maxLength={100}
          placeholder={t("orgUnits.name")}
          onChange={(e) => (setDraft((d) => ({ ...d, name: e.target.value })), setError(""))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className={`${input} ${error ? inputError : ""}`}
        />
        {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
      </div>
      <input type="number" min={0} max={9999} value={draft.sort_order} onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))} aria-label={t("orgUnits.sortOrder")} className={`${input} w-24`} />
      <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
        <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} className="cursor-pointer accent-[var(--accent-500)]" />
        {t("orgUnits.active")}
      </label>
      <button type="button" onClick={save} disabled={pending || !draft.name.trim()} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? <SpinnerIcon /> : <CheckIcon />}
        {t("common.save")}
      </button>
      <button type="button" onClick={() => setEditing(null)} className={btn.secondary}>
        <XIcon />
        {t("common.cancel")}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {feedback && (
        <p role="status" className={feedback.ok ? alert.success : alert.error}>
          {feedback.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {feedback.text}
        </p>
      )}
      <section className={`p-4 ${card}`}>
        {editing === "new" ? (
          editor
        ) : (
          <button type="button" onClick={() => open(null)} className={btn.primary}>
            <PlusIcon />
            {t(`orgUnits.${table}.add`)}
          </button>
        )}
      </section>

      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t(`orgUnits.${table}.empty`)}</div>
      ) : (
        <ul className={`divide-y divide-line overflow-hidden ${card}`}>
          {items.map((u) => (
            <li key={u.id} className={`px-4 py-3 ${u.is_active ? "" : "opacity-60"}`}>
              {editing === u.id ? (
                <div className="space-y-2">
                  {editor}
                  <p className="text-xs text-muted">{t("orgUnits.renameNote")}</p>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs tabular-nums text-faint">{u.sort_order}</span>
                  <span className="flex-1 font-medium">{u.name}</span>
                  <span className="text-xs text-muted">{t("orgUnits.usersCount", { count: fmt.number(u.users_count ?? 0) })}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? tone.success.badge : tone.idle.badge}`}>
                    {u.is_active ? t("orgUnits.active") : t("orgUnits.inactive")}
                  </span>
                  <Tooltip label={t("common.edit")}>
                    <button type="button" onClick={() => open(u)} aria-label={t("common.edit")} className={ICON_BTN}>
                      <PencilIcon width={15} height={15} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t("common.delete")}>
                    <button type="button" onClick={() => remove(u)} disabled={pending || (u.users_count ?? 0) > 0} aria-label={t("common.delete")} className={ICON_BTN}>
                      <TrashIcon width={15} height={15} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
