"use client";

import { useState, useTransition } from "react";
import { deleteOtherPolicy, saveOtherPolicy } from "@/app/actions/policy";
import { DocumentLink } from "@/components/document-viewer";
import { useConfirm } from "@/components/dialog-provider";
import { DocumentPicker } from "@/components/file-pickers";
import { PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { PolicyFileIcons } from "@/components/policy-content";
import { ResultToast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OtherPolicy } from "@/lib/types";

const FILES_MAX = 10;
const ICON_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** แท็บนโยบายอื่นๆ ของผู้จัดการ: รายการ + เอกสารแนบ, เพิ่ม/แก้ในกล่อง popup */
export function OtherPoliciesManager({ items, canEdit }: { items: OtherPolicy[]; canEdit: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [form, setForm] = useState<{ item: OtherPolicy | null } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [active, setActive] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const open = (item: OtherPolicy | null) => {
    setForm({ item });
    setTitle(item?.title ?? "");
    setDescription(item?.description ?? "");
    setSortOrder(item ? String(item.sort_order) : "");
    setActive(item?.is_active ?? true);
    setFiles([]);
    setRemoved([]);
    setErrors({});
  };

  const save = () => {
    if (!title.trim()) return setErrors({ title: t("policyPage.others.validateTitle") });
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("description", description.trim());
    fd.set("sort_order", sortOrder || "0");
    fd.set("is_active", active ? "1" : "0");
    files.forEach((f) => fd.append("files[]", f));
    removed.forEach((id) => fd.append("remove_file_ids[]", String(id)));
    start(async () => {
      const res = await saveOtherPolicy(form?.item?.id ?? null, fd);
      if (res.ok) {
        setForm(null);
        setResult(res);
      } else {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, v]) => [k, v ?? ""])));
        setResult({ ok: false, message: res.message ?? Object.values(res.errors ?? {})[0] });
      }
    });
  };

  const remove = async (item: OtherPolicy) => {
    if (!(await confirm(t("policyPage.others.deleteConfirm", { title: item.title }), { danger: true }))) return;
    start(async () => setResult(await deleteOtherPolicy(item.id)));
  };

  const existing = form?.item?.files.filter((f) => !removed.includes(f.id)) ?? [];
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);

  return (
    <div className="space-y-4">
      {result.message && <ResultToast result={result} />}
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" onClick={() => open(null)} className={btn.primary}>
            <PlusIcon />
            {t("policyPage.others.add")}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("policyPage.others.empty")}</div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((o) => (
            <li key={o.id} className={`space-y-1 p-4 ${card}`}>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <h2 className="min-w-0 font-medium">{o.title}</h2>
                  {!o.is_active && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.idle.badge}`}>{t("policyPage.others.hidden")}</span>}
                </div>
                <PolicyFileIcons files={o.files} />
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Tooltip label={t("common.edit")}>
                      <button type="button" onClick={() => open(o)} disabled={pending} aria-label={t("common.edit")} className={ICON_BTN}>
                        <PencilIcon width={15} height={15} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t("common.delete")}>
                      <button type="button" onClick={() => remove(o)} disabled={pending} aria-label={t("common.delete")} className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}>
                        <TrashIcon width={15} height={15} />
                      </button>
                    </Tooltip>
                  </span>
                )}
              </div>
              {o.description && <p className="whitespace-pre-line text-sm text-muted">{o.description}</p>}
            </li>
          ))}
        </ul>
      )}

      {form && (
        <ModalShell id="other-policy-form" size="wide" busy={pending} title={form.item ? t("policyPage.others.editTitle") : t("policyPage.others.newTitle")} onClose={() => setForm(null)}>
          <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
            <div>
              <label htmlFor="other-title" className="mb-1 block text-sm font-medium">
                {t("policyPage.others.title")}
                <span className="text-red-500"> *</span>
              </label>
              <input id="other-title" maxLength={200} value={title} onChange={(e) => (setTitle(e.target.value), setErrors({}))} className={`${input} ${errors.title ? inputError : ""}`} />
              {err("title")}
            </div>
            <div>
              <label htmlFor="other-description" className="mb-1 block text-sm font-medium">
                {t("policyPage.others.description")}
              </label>
              <textarea id="other-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
              {err("description")}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="other-sort" className="mb-1 block text-sm font-medium">
                  {t("policyPage.others.sortOrder")}
                </label>
                <input id="other-sort" type="number" min={0} max={999} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={input} />
                {err("sort_order")}
              </div>
              <label className="flex cursor-pointer items-center gap-2 self-center text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
                {t("policyPage.others.active")}
              </label>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("policyPage.others.files")}</p>
              {existing.length > 0 && (
                <ul className="mb-2 space-y-1.5">
                  {existing.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                      <DocumentLink href={`/files${f.url}`} name={f.name} className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                        {f.name}
                      </DocumentLink>
                      <button type="button" onClick={() => setRemoved((x) => [...x, f.id])} aria-label={t("settingsPage.policy.deleteFileConfirm", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500">
                        <XIcon width={14} height={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DocumentPicker files={files} onChange={setFiles} max={FILES_MAX} onError={(message) => setResult({ ok: false, message })} />
              {err("files")}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={btn.secondary}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={save} aria-busy={pending} className={btn.primary}>
                {pending ? <SpinnerIcon /> : <SaveIcon />}
                {t("common.save")}
              </button>
            </div>
          </fieldset>
        </ModalShell>
      )}
    </div>
  );
}
