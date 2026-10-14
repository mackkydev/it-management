"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteOrgUnit, importOrgUnits, saveOrgUnit, type OrgImportResult, type OrgTable } from "@/app/actions/org-units";
import { AlertIcon, CheckCircleIcon, CheckIcon, DownloadIcon, PencilIcon, PlusIcon, SpinnerIcon, TrashIcon, UploadIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { OrgUnit } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";
import { AppSelect } from "@/components/app-select";

type Draft = { name: string; is_active: boolean; sort_order: string; division_id: string; department_ids: number[] };
const EMPTY: Draft = { name: "", is_active: true, sort_order: "0", division_id: "", department_ids: [] };
const ICON_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const LABEL = "mb-1 block text-xs font-medium text-muted";

/**
 * จัดการแผนก / ฝ่าย แบบแก้ในแถว — เพิ่มด้านบน, แก้ไข/ลบในตาราง, นำเข้า Excel (ฝ่าย + แผนก ไฟล์เดียว)
 * แผนก: เลือกฝ่ายที่สังกัด (divisions) · ฝ่าย: เลือกแผนกที่อยู่ในฝ่ายนี้ (departments) — ไม่บังคับทั้งสองทาง
 */
export function OrgUnitManager({ table, items, divisions, departments }: { table: OrgTable; items: OrgUnit[]; divisions?: OrgUnit[]; departments?: OrgUnit[] }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pending, start] = useTransition();

  const open = (u: OrgUnit | null) => {
    setEditing(u ? u.id : "new");
    setDraft(
      u
        ? { name: u.name, is_active: u.is_active, sort_order: String(u.sort_order), division_id: u.division ? String(u.division.id) : "", department_ids: (u.departments ?? []).map((d) => d.id) }
        : EMPTY,
    );
    setError("");
  };
  const save = () =>
    start(async () => {
      const res = await saveOrgUnit(table, editing === "new" ? null : editing, {
        name: draft.name,
        is_active: draft.is_active,
        sort_order: Number(draft.sort_order) || 0,
        ...(divisions ? { division_id: draft.division_id ? Number(draft.division_id) : null } : {}),
        ...(departments ? { department_ids: draft.department_ids } : {}),
      });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else setError(res.errors?.name ?? res.errors?.sort_order ?? res.message ?? "");
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
  const toggleDept = (id: number) =>
    setDraft((d) => ({ ...d, department_ids: d.department_ids.includes(id) ? d.department_ids.filter((x) => x !== id) : [...d.department_ids, id] }));
  // ฝ่าย: แผนกที่สังกัดฝ่ายอื่นอยู่ — เลือกแล้วจะย้ายมาฝ่ายนี้ (แสดงชื่อฝ่ายเดิมกำกับ)
  const editingId = typeof editing === "number" ? editing : null;

  const editor = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className={LABEL} htmlFor="org-name">
            {t("orgUnits.name")}
          </label>
          <input
            id="org-name"
            autoFocus
            value={draft.name}
            maxLength={100}
            onChange={(e) => {
              setDraft((d) => ({ ...d, name: e.target.value }));
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className={`${input} ${error ? inputError : ""}`}
          />
        </div>
        {divisions && (
          <div className="w-56">
            <span className={LABEL}>{t("orgUnits.division")}</span>
            <AppSelect value={draft.division_id} onValueChange={(v) => setDraft((d) => ({ ...d, division_id: v }))} aria-label={t("orgUnits.division")} className={input}>
              <option value="">{t("orgUnits.noDivision")}</option>
              {divisions
                .filter((d) => d.is_active || String(d.id) === draft.division_id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </AppSelect>
          </div>
        )}
        <div className="w-28">
          <label className={LABEL} htmlFor="org-sort">
            {t("orgUnits.sortOrder")}
          </label>
          <input
            id="org-sort"
            type="number"
            min={0}
            max={9999}
            value={draft.sort_order}
            onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))}
            title={t("orgUnits.sortHint")}
            className={input}
          />
        </div>
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
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}
      <p className="text-xs text-muted">{t("orgUnits.sortHint")}</p>
      {departments && (
        <div>
          <span className={LABEL}>{t("orgUnits.departmentsInDivision")}</span>
          {departments.length === 0 ? (
            <p className="text-sm text-muted">{t("orgUnits.departments.empty")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {departments.map((d) => {
                const on = draft.department_ids.includes(d.id);
                const elsewhere = d.division && d.division.id !== editingId ? d.division.name : null;
                return (
                  <label
                    key={d.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ${on ? `${tone.info.badge} ring-transparent` : "text-muted ring-line"} ${d.is_active ? "" : "opacity-60"}`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleDept(d.id)} className="h-3.5 w-3.5 accent-[var(--accent-500)]" />
                    {d.name}
                    {elsewhere && !on && <span className="text-faint">({elsewhere})</span>}
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-muted">{t("orgUnits.departmentsHint")}</p>
        </div>
      )}
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
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => open(null)} className={btn.primary}>
              <PlusIcon />
              {t(`orgUnits.${table}.add`)}
            </button>
            {/* นำเข้า Excel เฉพาะฝ่าย/แผนก */}
            {(table === "departments" || table === "divisions") && (
              <button type="button" onClick={() => setImportOpen(true)} className={btn.secondary}>
                <UploadIcon />
                {t("orgUnits.import")}
              </button>
            )}
          </div>
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
                  {table === "departments" || table === "divisions" ? (
                    <p className="text-xs text-muted">{t("orgUnits.renameNote")}</p>
                  ) : (
                    table !== "contract_categories" && <p className="text-xs text-muted">{t("orgUnits.renameNoteData")}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Tooltip label={t("orgUnits.sortHint")} side="top">
                    <span className="w-10 text-xs tabular-nums text-faint">{u.sort_order}</span>
                  </Tooltip>
                  <span className="flex flex-1 flex-wrap items-center gap-2 font-medium">
                    {u.name}
                    {divisions && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-normal ${u.division ? tone.info.badge : "text-faint"}`}>
                        {u.division ? u.division.name : t("orgUnits.noDivision")}
                      </span>
                    )}
                    {departments &&
                      (u.departments?.length ? (
                        u.departments.map((d) => (
                          <span key={d.id} className={`rounded-full px-2 py-0.5 text-xs font-normal ${tone.info.badge}`}>
                            {d.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs font-normal text-faint">{t("orgUnits.noDepartments")}</span>
                      ))}
                  </span>
                  <span className="text-xs text-muted">
                    {table === "contract_categories"
                      ? t("orgUnits.contractsCount", { count: fmt.number(u.contracts_count ?? 0) })
                      : u.usage_count !== undefined
                        ? t("orgUnits.usageCount", { count: fmt.number(u.usage_count) })
                        : t("orgUnits.usersCount", { count: fmt.number(u.users_count ?? 0) })}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? tone.success.badge : tone.idle.badge}`}>
                    {u.is_active ? t("orgUnits.active") : t("orgUnits.inactive")}
                  </span>
                  <Tooltip label={t("common.edit")}>
                    <button type="button" onClick={() => open(u)} aria-label={t("common.edit")} className={ICON_BTN}>
                      <PencilIcon width={15} height={15} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t("common.delete")}>
                    <button type="button" onClick={() => remove(u)} disabled={pending || (u.users_count ?? 0) > 0 || (u.contracts_count ?? 0) > 0 || (u.usage_count ?? 0) > 0} aria-label={t("common.delete")} className={ICON_BTN}>
                      <TrashIcon width={15} height={15} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {importOpen && <OrgImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

/** นำเข้าฝ่าย + แผนกจาก Excel (ไฟล์เดียว 2 แผ่น) — ดาวน์โหลด template ที่มีข้อมูลปัจจุบันไปแก้ แล้วอัปโหลดกลับ */
function OrgImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OrgImportResult | null>(null);
  const [pending, start] = useTransition();
  const submit = async () => {
    if (!file) return setResult({ ok: false, message: t("orgUnits.noFile"), rows: [] });
    if (!(await confirm(t("common.confirmImport", { name: file.name }), { title: t("common.confirmImportTitle"), confirmText: t("common.importConfirm"), danger: false }))) return;
    start(async () => {
      const form = new FormData();
      form.set("file", file);
      const res = await importOrgUnits(form);
      setResult(res);
      if (res.ok) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`w-full max-w-lg space-y-4 p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t("orgUnits.importTitle")}</h3>
            <p className="mt-1 text-sm text-muted">{t("orgUnits.importHint")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ดาวน์โหลดไฟล์จาก route handler (ไม่ใช่หน้าเว็บ) — template ไม่ต้องถามยืนยัน */}
        <a href="/files/org-units/import-template" className={`${btn.soft} ${btn.sm} w-fit`}>
          <DownloadIcon width={14} height={14} />
          {t("orgUnits.template")}
        </a>
        <div>
          <label htmlFor="org-file" className="mb-1 block text-sm font-medium">
            {t("orgUnits.file")}
          </label>
          <input
            ref={inputRef}
            id="org-file"
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
            className={`${input} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-accent-800 hover:file:bg-accent-200 dark:file:bg-accent-400/15 dark:file:text-accent-200`}
          />
        </div>
        {result?.ok && (
          <p role="status" className={alert.success}>
            <CheckCircleIcon className="shrink-0 text-success-500" />
            {t("orgUnits.importSuccess", { created: result.created, updated: result.updated })}
          </p>
        )}
        {result && !result.ok && (
          <div role="alert" className="space-y-2">
            <p className={alert.error}>
              <AlertIcon className="shrink-0 text-danger-400" />
              {result.message}
            </p>
            {result.rows.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {result.rows.map((r, i) => (
                  <li key={i}>
                    {r.row > 0 && <span className="mr-2 font-medium">{t("orgUnits.row", { row: r.row })}</span>}
                    {r.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={btn.secondary}>
            {t("common.close")}
          </button>
          <button type="button" onClick={submit} disabled={pending} className={btn.primary}>
            {pending ? <SpinnerIcon /> : <UploadIcon />}
            {t("orgUnits.importButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
