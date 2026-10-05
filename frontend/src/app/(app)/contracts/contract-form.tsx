"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteContract, saveContract, type ContractPayload } from "@/app/actions/it-data";
import { DateInput } from "@/components/date-input";
import { AlertIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Branch, Contract } from "@/lib/types";
import { AppSelect } from "@/components/app-select";

export function ContractForm({ contract, branches, defaultNotifyDays }: { contract?: Contract; branches: Branch[]; defaultNotifyDays: number }) {
  const { t } = useI18n();
  const isEdit = Boolean(contract);
  const [v, setV] = useState<ContractPayload>({
    title: contract?.title ?? "",
    vendor_name: contract?.vendor_name ?? "",
    contract_no: contract?.contract_no ?? "",
    start_date: contract?.start_date ?? "",
    end_date: contract?.end_date ?? "",
    amount: contract?.amount ?? "",
    contact_name: contract?.contact_name ?? "",
    contact_email: contract?.contact_email ?? "",
    contact_phone: contract?.contact_phone ?? "",
    notify_enabled: contract?.notify_enabled ?? true,
    notify_days_before: contract?.notify_days_before ? String(contract.notify_days_before) : "",
    notes: contract?.notes ?? "",
    branch_id: contract?.branch_id ? String(contract.branch_id) : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "delete" | null>(null);

  const set = <K extends keyof ContractPayload>(k: K, value: ContractPayload[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.title.trim()) e.title = t("contracts.validate.title");
    if (!v.vendor_name.trim()) e.vendor_name = t("contracts.validate.vendor");
    if (!v.start_date) e.start_date = t("contracts.validate.startDate");
    if (!v.end_date) e.end_date = t("contracts.validate.endDate");
    else if (v.start_date && v.end_date < v.start_date) e.end_date = t("contracts.validate.endBeforeStart");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    setAction("save");
    start(async () => {
      const res = await saveContract(contract?.id ?? null, v);
      if (res) {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, m ?? ""])));
        setMessage(res.message ?? "");
      }
    });
  };

  const remove = () => {
    if (!contract || !confirm(t("contracts.form.confirmDelete", { title: contract.title }))) return;
    setAction("delete");
    start(async () => {
      const res = await deleteContract(contract.id);
      if (res) setMessage(res.message ?? "");
    });
  };

  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;
  const field = (k: keyof ContractPayload, label: string, control: ReactNode, opts: { required?: boolean; hint?: string; wide?: boolean } = {}) => (
    <div className={opts.wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={k} className="mb-1 block text-sm font-medium">
        {label}
        {opts.required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : opts.hint && <p className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
  );
  const text = (k: keyof ContractPayload, label: string, opts: { required?: boolean; type?: string; max?: number; wide?: boolean; mono?: boolean } = {}) =>
    field(
      k,
      label,
      <input
        id={k}
        type={opts.type ?? "text"}
        value={v[k] as string}
        maxLength={opts.max ?? 255}
        onChange={(e) => set(k, e.target.value)}
        className={`${cls(k)} ${opts.mono ? "font-mono" : ""}`}
      />,
      opts,
    );
  const section = (title: string, children: ReactNode) => (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );

  return (
    <div className="space-y-5">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}
      <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
        {section(
          t("contracts.form.sectionInfo"),
          <>
            {text("title", t("contracts.form.title"), { required: true, wide: true })}
            {text("vendor_name", t("contracts.form.vendor"), { required: true })}
            {text("contract_no", t("contracts.form.contractNo"), { max: 100, mono: true })}
            {field("start_date", t("contracts.form.startDate"), <DateInput id="start_date" value={v.start_date} onChange={(d) => set("start_date", d)} className={cls("start_date")} />, { required: true })}
            {field("end_date", t("contracts.form.endDate"), <DateInput id="end_date" value={v.end_date} onChange={(d) => set("end_date", d)} className={cls("end_date")} />, { required: true })}
            {field(
              "amount",
              t("contracts.form.amount"),
              <input id="amount" type="number" min={0} step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} className={cls("amount")} />,
            )}
            {field(
              "branch_id",
              t("contracts.form.branch"),
              <AppSelect id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
                <option value="">{t("common.none")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </AppSelect>,
            )}
            {field("notes", t("contracts.form.notes"), <textarea id="notes" rows={3} maxLength={5000} value={v.notes} onChange={(e) => set("notes", e.target.value)} className={cls("notes")} />, { wide: true })}
          </>,
        )}
        {section(
          t("contracts.form.sectionContact"),
          <>
            {text("contact_name", t("contracts.form.contactName"))}
            {text("contact_phone", t("contracts.form.contactPhone"), { type: "tel", max: 50 })}
            {text("contact_email", t("contracts.form.contactEmail"), { type: "email", wide: true })}
          </>,
        )}
        {section(
          t("contracts.form.sectionNotify"),
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={v.notify_enabled} onChange={(e) => set("notify_enabled", e.target.checked)} className="h-4 w-4 accent-[var(--accent-500)]" />
              {t("contracts.form.notifyEnabled")}
            </label>
            {v.notify_enabled &&
              field(
                "notify_days_before",
                t("contracts.form.notifyDays"),
                <input
                  id="notify_days_before"
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  placeholder={String(defaultNotifyDays)}
                  value={v.notify_days_before}
                  onChange={(e) => set("notify_days_before", e.target.value)}
                  className={cls("notify_days_before")}
                />,
                { hint: t("contracts.form.notifyDaysHint", { days: String(defaultNotifyDays) }) },
              )}
          </>,
        )}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && (
          <button type="button" onClick={remove} disabled={pending} className={`${btn.danger} sm:mr-auto`}>
            {pending && action === "delete" ? <SpinnerIcon /> : <TrashIcon />}
            {t("contracts.form.delete")}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/contracts" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {pending && action === "save" ? <SpinnerIcon /> : <SaveIcon />}
            {isEdit ? t("contracts.form.submitUpdate") : t("contracts.form.submitCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}
