"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deletePolicyFile, savePolicy, uploadPolicyFiles } from "@/app/actions/policy";
import { DOC_ACCEPT, DOC_MAX_BYTES } from "@/components/file-pickers";
import { useConfirm } from "@/components/dialog-provider";
import { ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, ExternalLinkIcon, FileTextIcon, PlusIcon, PrinterIcon, SaveIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { ResultToast } from "@/components/toast";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { PolicyAcceptance, PolicySection, SystemPolicy } from "@/lib/types";

type Filter = "all" | "accepted" | "pending";

const SAMPLE_COUNT = 10;

/** ข้อมูลหลัก → นโยบายการใช้งาน: แก้หัวข้อ/เนื้อหา, ให้ทุกคนยอมรับใหม่ (ฉบับใหม่), พิมพ์เอกสาร, รายชื่อผู้ยอมรับ — เปิด-ปิด / ที่แสดง อยู่ที่หน้าตั้งค่าระบบ */
export function PolicyEditor({ initial, acceptances }: { initial: SystemPolicy; acceptances: { data: PolicyAcceptance[]; accepted: number; total: number } }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const samples = (): PolicySection[] => Array.from({ length: SAMPLE_COUNT }, (_, i) => ({ title: t(`policySamples.s${i + 1}Title` as MessageKey), body: t(`policySamples.s${i + 1}Body` as MessageKey) }));
  // ยังไม่เคยบันทึกนโยบาย = เติมร่างตัวอย่างให้ (มีผลเมื่อกดบันทึกเท่านั้น)
  const neverSaved = initial.version === 0 && initial.sections.length === 0;
  const [sections, setSections] = useState<PolicySection[]>(neverSaved ? samples : initial.sections);
  const [reaccept, setReaccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [showList, setShowList] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, start] = useTransition();

  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  const patch = (i: number, v: Partial<PolicySection>) => setSections((s) => s.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSections((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const save = async () => {
    const e: Record<string, string> = {};
    sections.forEach((s, i) => {
      if (!s.title.trim()) e[`sections.${i}.title`] = t("settingsPage.policy.validate.title");
      if (!s.body.trim()) e[`sections.${i}.body`] = t("settingsPage.policy.validate.body");
    });
    if (initial.enabled && !sections.length) e.sections = t("settingsPage.policy.validate.sections");
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    if (reaccept && !(await confirm(t("settingsPage.policy.reacceptConfirm"), { danger: false }))) return;
    start(async () => {
      const res = await savePolicy({ reaccept, sections });
      setResult(res);
      if (res.errors) setErrors(Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k, v ?? ""])));
      if (res.ok) setReaccept(false);
    });
  };

  const addSamples = async () => {
    if (sections.length && !(await confirm(t("settingsPage.policy.addSamplesConfirm"), { danger: false }))) return;
    setSections((s) => [...s, ...samples()]);
    clearErr("sections");
    setResult({ ok: true, message: t("settingsPage.policy.samplesAdded") });
  };

  const upload = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const big = chosen.find((f) => f.size > DOC_MAX_BYTES);
    if (big) return setResult({ ok: false, message: t("settingsPage.policy.fileTooBig", { name: big.name }) });
    const fd = new FormData();
    chosen.forEach((f) => fd.append("files[]", f));
    start(async () => {
      const res = await uploadPolicyFiles(fd);
      setResult(res.ok ? res : { ok: false, message: Object.values(res.errors ?? {})[0] ?? res.message });
    });
  };

  const removeFile = async (id: number, name: string) => {
    if (!(await confirm(t("settingsPage.policy.deleteFileConfirm", { name }), { danger: true }))) return;
    start(async () => setResult(await deletePolicyFile(id)));
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const rows = acceptances.data.filter((r) => (filter === "all" ? true : filter === "accepted" ? r.accepted_at : !r.accepted_at));

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileTextIcon className="text-accent-500" />
            {t("settingsPage.policy.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("settingsPage.policy.contentHint")}</p>
          <p className="mt-1 text-xs text-faint">
            {initial.version > 0 ? t("settingsPage.policy.version", { version: initial.version, date: initial.updated_at ? fmt.dateTime(initial.updated_at) : "-" }) : t("settingsPage.policy.notSaved")}
          </p>
        </div>
        <a href="/policy-print/blank" target="_blank" rel="noreferrer" className={`${btn.secondary} ${btn.sm}`}>
          <PrinterIcon width={14} height={14} className="text-accent-500" />
          {t("settingsPage.policy.printDoc")}
        </a>
      </div>

      {neverSaved && <p className={alert.warning}>{t("settingsPage.policy.samplesDraft")}</p>}

      {/* หัวข้อนโยบาย */}
      <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-medium">{t("settingsPage.policy.sections")}</legend>
        {sections.length === 0 && <p className="text-sm text-muted">{t("settingsPage.policy.empty")}</p>}
        {sections.map((s, i) => (
          <div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-line">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">{t("settingsPage.policy.sectionTitle", { n: i + 1 })}</span>
              <span className="flex-1" />
              <Tooltip label={t("settingsPage.policy.moveUp")} side="top">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("settingsPage.policy.moveUp")} className={`${btn.secondary} ${btn.sm} h-8 px-2`}>
                  <ArrowUpIcon width={14} height={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("settingsPage.policy.moveDown")} side="top">
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === sections.length - 1}
                  aria-label={t("settingsPage.policy.moveDown")}
                  className={`${btn.secondary} ${btn.sm} h-8 px-2`}
                >
                  <ArrowDownIcon width={14} height={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("settingsPage.policy.remove")} side="top">
                <button
                  type="button"
                  onClick={() => setSections((x) => x.filter((_, j) => j !== i))}
                  aria-label={t("settingsPage.policy.remove")}
                  className={`${btn.danger} ${btn.sm} h-8 px-2`}
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </Tooltip>
            </div>
            <div>
              <input
                value={s.title}
                maxLength={200}
                onChange={(e) => {
                  patch(i, { title: e.target.value });
                  clearErr(`sections.${i}.title`);
                }}
                aria-label={t("settingsPage.policy.sectionTitle", { n: i + 1 })}
                className={`${input} font-medium ${errors[`sections.${i}.title`] ? inputError : ""}`}
              />
              {err(`sections.${i}.title`)}
            </div>
            <div>
              <textarea
                value={s.body}
                rows={5}
                maxLength={20000}
                onChange={(e) => {
                  patch(i, { body: e.target.value });
                  clearErr(`sections.${i}.body`);
                }}
                aria-label={t("settingsPage.policy.sectionBody")}
                placeholder={t("settingsPage.policy.sectionBody")}
                className={`${input} ${errors[`sections.${i}.body`] ? inputError : ""}`}
              />
              {err(`sections.${i}.body`)}
            </div>
          </div>
        ))}
        {err("sections")}
        <button
          type="button"
          onClick={() => {
            setSections((x) => [...x, { title: "", body: "" }]);
            clearErr("sections");
          }}
          className={`${btn.secondary} ${btn.sm}`}
        >
          <PlusIcon width={14} height={14} />
          {t("settingsPage.policy.add")}
        </button>
        <button type="button" onClick={addSamples} className={`${btn.secondary} ${btn.sm} ml-2`}>
          <FileTextIcon width={14} height={14} />
          {t("settingsPage.policy.addSamples")}
        </button>
      </fieldset>

      {/* ไฟล์แนบประกาศ — บันทึกทันที แยกจากปุ่มบันทึกนโยบาย */}
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">{t("settingsPage.policy.files")}</p>
        <p className="text-xs text-muted">{t("settingsPage.policy.filesHint")}</p>
        {initial.files.length > 0 && (
          <ul className="space-y-1.5">
            {initial.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                <FileTextIcon width={15} height={15} className="shrink-0 text-accent-500" />
                <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                  {f.name}
                </a>
                <button type="button" onClick={() => removeFile(f.id, f.name)} disabled={pending} aria-label={t("settingsPage.policy.deleteFileConfirm", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500 disabled:cursor-not-allowed">
                  <TrashIcon width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className={`${btn.secondary} ${btn.sm} w-fit cursor-pointer`}>
          {pending ? <SpinnerIcon width={14} height={14} /> : <PlusIcon width={14} height={14} />}
          {t("settingsPage.policy.uploadFiles")}
          <input
            type="file"
            multiple
            accept={DOC_ACCEPT}
            disabled={pending}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      </div>

      {initial.version > 0 && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={reaccept} onChange={(e) => setReaccept(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          {t("settingsPage.policy.reaccept")}
        </label>
      )}

      {result.message && <ResultToast result={result} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {initial.version > 0 && initial.enabled && (
          <Link href="/policy-accept" className={`${btn.secondary} ${btn.sm}`}>
            <ExternalLinkIcon width={14} height={14} />
            {t("settingsPage.policy.preview")}
          </Link>
        )}
        <button type="button" onClick={save} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
          {t("settingsPage.policy.save")}
        </button>
      </div>

      {/* รายชื่อผู้ใช้ + วันที่ยอมรับฉบับปัจจุบัน */}
      {initial.version > 0 && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("settingsPage.policy.accepted", { accepted: acceptances.accepted, total: acceptances.total })}</p>
            <button type="button" onClick={() => setShowList((v) => !v)} aria-expanded={showList} className={`${btn.secondary} ${btn.sm}`}>
              {t(showList ? "settingsPage.policy.hideList" : "settingsPage.policy.showList")}
            </button>
          </div>
          {showList && (
            <>
              <div className="flex flex-wrap gap-1" role="tablist">
                {(["all", "accepted", "pending"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300" : "text-muted hover:bg-subtle"}`}
                  >
                    {t(f === "all" ? "settingsPage.policy.filterAll" : f === "accepted" ? "settingsPage.policy.filterAccepted" : "settingsPage.policy.filterPending")}
                  </button>
                ))}
              </div>
              <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
                {rows.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">{t("settingsPage.policy.noRows")}</li>}
                {rows.map((r) => (
                  <li key={r.user.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{r.user.name}</span>
                      <span className="block text-xs text-muted">{[r.user.email, r.user.branch].filter(Boolean).join(" · ") || "-"}</span>
                    </span>
                    {r.accepted_at ? (
                      <a href={`/policy-print/${r.user.id}`} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center gap-1 text-xs text-success-700 hover:underline dark:text-success-300">
                        <CheckCircleIcon width={14} height={14} />
                        {t("settingsPage.policy.acceptedAt", { date: fmt.dateTime(r.accepted_at) })}
                      </a>
                    ) : (
                      <span className="text-xs text-warning-700 dark:text-warning-300">{t("settingsPage.policy.pending")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
