"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createPolicyVersion, deletePolicyVersionFile, updatePolicyVersion, uploadPolicyVersionFiles } from "@/app/actions/policy";
import { DocumentLink } from "@/components/document-viewer";
import { DOC_ACCEPT, DOC_MAX_BYTES } from "@/components/file-pickers";
import { useConfirm } from "@/components/dialog-provider";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, FileTextIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { ResultToast } from "@/components/toast";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import type { PolicySection, PolicyVersion } from "@/lib/types";

const SAMPLE_COUNT = 10;

/** เพิ่ม/แก้นโยบายฉบับหนึ่ง: ชื่อ, หัวข้อ, ไฟล์แนบ — initial null = ฉบับใหม่ (บันทึกแล้วจึงแนบไฟล์ได้), มีผู้ยอมรับแล้วแก้ได้เฉพาะชื่อ */
export function PolicyEditor({ initial, prefillSamples = false }: { initial: PolicyVersion | null; prefillSamples?: boolean }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const samples = (): PolicySection[] => Array.from({ length: SAMPLE_COUNT }, (_, i) => ({ title: t(`policySamples.s${i + 1}Title` as MessageKey), body: t(`policySamples.s${i + 1}Body` as MessageKey) }));
  const locked = initial?.locked ?? false;
  const [title, setTitle] = useState(initial?.title ?? (prefillSamples ? t("policyAccept.title") : ""));
  const [sections, setSections] = useState<PolicySection[]>(initial?.sections ?? (prefillSamples ? samples : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  const patch = (i: number, v: Partial<PolicySection>) => setSections((s) => s.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSections((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const save = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = t("policyPage.form.titleRequired");
    sections.forEach((s, i) => {
      if (!s.title.trim()) e[`sections.${i}.title`] = t("settingsPage.policy.validate.title");
      if (!s.body.trim()) e[`sections.${i}.body`] = t("settingsPage.policy.validate.body");
    });
    if (initial?.is_default && !sections.length) e.sections = t("settingsPage.policy.validate.sections");
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    start(async () => {
      const values = { title: title.trim(), sections };
      const res = initial ? await updatePolicyVersion(initial.version, values) : await createPolicyVersion(values);
      setResult(res);
      if (res.errors) setErrors(Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k, v ?? ""])));
    });
  };

  const addSamples = async () => {
    if (sections.length && !(await confirm(t("settingsPage.policy.addSamplesConfirm"), { danger: false }))) return;
    setSections((s) => [...s, ...samples()]);
    clearErr("sections");
    setResult({ ok: true, message: t("settingsPage.policy.samplesAdded") });
  };

  const upload = (list: FileList | null) => {
    if (!initial) return;
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const big = chosen.find((f) => f.size > DOC_MAX_BYTES);
    if (big) return setResult({ ok: false, message: t("settingsPage.policy.fileTooBig", { name: big.name }) });
    const fd = new FormData();
    chosen.forEach((f) => fd.append("files[]", f));
    start(async () => {
      const res = await uploadPolicyVersionFiles(initial.version, fd);
      setResult(res.ok ? res : { ok: false, message: Object.values(res.errors ?? {})[0] ?? res.message });
    });
  };

  const removeFile = async (id: number, name: string) => {
    if (!initial || !(await confirm(t("settingsPage.policy.deleteFileConfirm", { name }), { danger: true }))) return;
    start(async () => {
      const res = await deletePolicyVersionFile(initial.version, id);
      setResult(res.ok ? res : { ok: false, message: Object.values(res.errors ?? {})[0] ?? res.message });
    });
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-faint">{initial ? t("settingsPage.policy.version", { version: initial.version, date: initial.updated_at ? fmt.dateTime(initial.updated_at) : "-" }) : t("settingsPage.policy.notSaved")}</p>
        <Link href="/policy" className={`${btn.secondary} ${btn.sm}`}>
          <ChevronLeftIcon width={14} height={14} />
          {t("policyPage.back")}
        </Link>
      </div>

      {prefillSamples && <p className={alert.warning}>{t("settingsPage.policy.samplesDraft")}</p>}
      {locked && <p className={alert.warning}>{t("policyPage.form.lockedHint", { count: fmt.number(initial?.accepted ?? 0) })}</p>}

      <div>
        <label htmlFor="policy-title" className="mb-1 block text-sm font-medium">
          {t("policyPage.form.title")}
          <span className="text-red-500"> *</span>
        </label>
        <input
          id="policy-title"
          value={title}
          maxLength={200}
          disabled={pending}
          onChange={(e) => {
            setTitle(e.target.value);
            clearErr("title");
          }}
          className={`${input} ${errors.title ? inputError : ""}`}
        />
        {err("title")}
      </div>

      {/* หัวข้อนโยบาย */}
      <fieldset disabled={pending || locked} className="space-y-3 disabled:opacity-60">
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
        {!locked && (
          <>
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
          </>
        )}
      </fieldset>

      {/* ไฟล์แนบของฉบับนี้ — บันทึกทันที แยกจากปุ่มบันทึกนโยบาย */}
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">{t("settingsPage.policy.files")}</p>
        <p className="text-xs text-muted">{initial ? t("settingsPage.policy.filesHint") : t("policyPage.form.filesAfterSave")}</p>
        {initial && initial.files.length > 0 && (
          <ul className="space-y-1.5">
            {initial.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                <FileTextIcon width={15} height={15} className="shrink-0 text-accent-500" />
                <DocumentLink href={`/files${f.url}`} name={f.name} className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                  {f.name}
                </DocumentLink>
                {!locked && (
                  <button type="button" onClick={() => removeFile(f.id, f.name)} disabled={pending} aria-label={t("settingsPage.policy.deleteFileConfirm", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500 disabled:cursor-not-allowed">
                    <TrashIcon width={14} height={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {initial && !locked && (
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
        )}
      </div>

      {result.message && <ResultToast result={result} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={save} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
          {t("settingsPage.policy.save")}
        </button>
      </div>
    </section>
  );
}
