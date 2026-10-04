"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteApprovalRoute, saveApprovalRoute, type RoutePayload } from "@/app/actions/approval-routes";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ApprovalRoute, Branch } from "@/lib/types";
import { CustodianPicker } from "../assets/custodian-picker";

const MAX_STEPS = 5;
const MAX_APPROVERS = 20;

const ICON_BTN =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

type Step = RoutePayload["steps"][number];

/** ย้ายตำแหน่งในรายการ (dir = -1 ขึ้น, +1 ลง) */
function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** ฟอร์มสายอนุมัติ: ขอบเขต (สาขา/แผนก) + ขั้นอนุมัติเรียงลำดับ แต่ละขั้นมีผู้อนุมัติหลายคน (คนใดคนหนึ่งอนุมัติได้) */
export function RouteForm({ route, branches, departments }: { route?: ApprovalRoute; branches: Branch[]; departments: string[] }) {
  const { t } = useI18n();
  const isEdit = Boolean(route);
  const [v, setV] = useState<RoutePayload>({
    name: route?.name ?? "",
    branch_id: route?.branch ? String(route.branch.id) : "",
    department: route?.department ?? "",
    is_active: route?.is_active ?? true,
    steps: route?.steps.map((s) => ({ name: s.name, approvers: s.approvers.map(({ id, name }) => ({ id, name })) })) ?? [{ name: "", approvers: [] }],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "delete" | null>(null);

  const set = <K extends keyof RoutePayload>(k: K, value: RoutePayload[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };
  // ข้อผิดพลาดของขั้นอ้างอิงตามลำดับ — เปลี่ยนขั้นแล้วล้างของขั้นทั้งหมด
  const setSteps = (steps: Step[]) => {
    setV((s) => ({ ...s, steps }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("steps"))));
  };
  const updateStep = (i: number, patch: Partial<Step>) => setSteps(v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = t("approvalRoutes.validate.name");
    if (v.steps.length === 0) e.steps = t("approvalRoutes.validate.steps");
    v.steps.forEach((s, i) => {
      if (!s.name.trim()) e[`steps.${i}.name`] = t("approvalRoutes.validate.stepName");
      if (s.approvers.length === 0) e[`steps.${i}.approver_ids`] = t("approvalRoutes.validate.approvers");
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    setAction("save");
    start(async () => {
      const res = await saveApprovalRoute(route?.id ?? null, v);
      if (res) {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, m]) => [k, m ?? ""])));
        setMessage(res.message ?? "");
      }
    });
  };

  const remove = () => {
    if (!route || !confirm(t("approvalRoutes.confirmDelete", { name: route.name }))) return;
    setAction("delete");
    start(async () => {
      const res = await deleteApprovalRoute(route.id);
      if (res) setMessage(res.message ?? "");
    });
  };

  /** ข้อความผิดพลาดของผู้อนุมัติในขั้น i (รวมรายคน steps.i.approver_ids.j) */
  const approverError = (i: number) =>
    errors[`steps.${i}.approver_ids`] || Object.entries(errors).find(([k, m]) => k.startsWith(`steps.${i}.approver_ids.`) && m)?.[1] || "";

  const cls = (k: string) => `${input} ${errors[k] ? inputError : ""}`;
  const err = (k: string, msg = errors[k]) => (msg ? <p className="mt-1 text-xs font-medium text-red-500">{msg}</p> : null);
  const field = (id: string, label: string, control: ReactNode, opts: { required?: boolean; hint?: string } = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {opts.required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[id] ? err(id) : opts.hint && <p className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
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
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="font-semibold">{t("approvalRoutes.form.sectionScope")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("approvalRoutes.form.scopeHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {field(
                "name",
                t("approvalRoutes.form.name"),
                <input id="name" value={v.name} maxLength={255} placeholder={t("approvalRoutes.form.namePlaceholder")} onChange={(e) => set("name", e.target.value)} className={cls("name")} />,
                { required: true },
              )}
            </div>
            {field(
              "branch_id",
              t("approvalRoutes.form.branch"),
              <select id="branch_id" value={v.branch_id} onChange={(e) => set("branch_id", e.target.value)} className={cls("branch_id")}>
                <option value="">{t("approvalRoutes.allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "department",
              t("approvalRoutes.form.department"),
              <>
                <input
                  id="department"
                  list="department-options"
                  value={v.department}
                  maxLength={100}
                  placeholder={t("approvalRoutes.allDepartments")}
                  onChange={(e) => set("department", e.target.value)}
                  className={cls("department")}
                />
                <datalist id="department-options">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>,
              { hint: t("approvalRoutes.form.departmentHint") },
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
              {t("approvalRoutes.form.active")}
            </label>
          </div>
        </section>

        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="font-semibold">{t("approvalRoutes.form.sectionSteps")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("approvalRoutes.form.stepsHint")}</p>
          {err("steps")}
          <ol className="space-y-3">
            {v.steps.map((s, i) => (
              <li key={i} className="rounded-xl bg-subtle/50 p-4 ring-1 ring-line">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{t("approvalRoutes.stepNo", { n: String(i + 1) })}</span>
                  <span className="ml-auto flex items-center gap-0.5">
                    <Tooltip label={t("permissions.moveUp")}>
                      <button type="button" onClick={() => setSteps(move(v.steps, i, -1))} disabled={i === 0} aria-label={t("permissions.moveUp")} className={ICON_BTN}>
                        <ArrowUpIcon width={14} height={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t("permissions.moveDown")}>
                      <button type="button" onClick={() => setSteps(move(v.steps, i, 1))} disabled={i === v.steps.length - 1} aria-label={t("permissions.moveDown")} className={ICON_BTN}>
                        <ArrowDownIcon width={14} height={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t("approvalRoutes.removeStep")}>
                      <button
                        type="button"
                        onClick={() => setSteps(v.steps.filter((_, j) => j !== i))}
                        disabled={v.steps.length === 1}
                        aria-label={t("approvalRoutes.removeStep")}
                        className={`${ICON_BTN} hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-400/10`}
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </Tooltip>
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[16rem_1fr]">
                  <div>
                    <label htmlFor={`step-${i}-name`} className="mb-1 block text-sm font-medium">
                      {t("approvalRoutes.form.stepName")}
                      <span className="text-red-500"> *</span>
                    </label>
                    <input
                      id={`step-${i}-name`}
                      value={s.name}
                      maxLength={100}
                      placeholder={t("approvalRoutes.form.stepNamePlaceholder")}
                      onChange={(e) => updateStep(i, { name: e.target.value })}
                      className={cls(`steps.${i}.name`)}
                    />
                    {err(`steps.${i}.name`)}
                  </div>
                  <div>
                    <label htmlFor={`step-${i}-approver`} className="mb-1 block text-sm font-medium">
                      {t("approvalRoutes.form.approvers")}
                      <span className="text-red-500"> *</span>
                    </label>
                    {s.approvers.length > 0 && (
                      <ul className="mb-2 flex flex-wrap gap-1.5">
                        {s.approvers.map((a) => (
                          <li key={a.id} className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-1 pl-3 pr-1 text-sm text-accent-800 ring-1 ring-accent-200 dark:bg-accent-400/10 dark:text-accent-200 dark:ring-accent-400/30">
                            {a.name}
                            <button
                              type="button"
                              onClick={() => updateStep(i, { approvers: s.approvers.filter((x) => x.id !== a.id) })}
                              aria-label={t("approvalRoutes.removeApprover", { name: a.name })}
                              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-accent-500 hover:bg-accent-100 hover:text-accent-700 dark:hover:bg-accent-400/20"
                            >
                              <XIcon width={11} height={11} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.approvers.length < MAX_APPROVERS && (
                      <CustodianPicker
                        id={`step-${i}-approver`}
                        value={null}
                        onChange={(u) => u && !s.approvers.some((a) => a.id === u.id) && updateStep(i, { approvers: [...s.approvers, { id: u.id, name: u.name }] })}
                        className={`${input} ${approverError(i) ? inputError : ""}`}
                      />
                    )}
                    {approverError(i) ? err("", approverError(i)) : <p className="mt-1 text-xs text-muted">{t("approvalRoutes.form.approversHint")}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {v.steps.length < MAX_STEPS && (
            <button type="button" onClick={() => setSteps([...v.steps, { name: "", approvers: [] }])} className={`${btn.soft} mt-3`}>
              <PlusIcon />
              {t("approvalRoutes.addStep")}
            </button>
          )}
        </section>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {isEdit && (
          <button type="button" onClick={remove} disabled={pending} className={`${btn.danger} sm:mr-auto`}>
            {pending && action === "delete" ? <SpinnerIcon /> : <TrashIcon />}
            {t("approvalRoutes.delete")}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Link href="/approval-routes" className={`${btn.secondary} flex-1 sm:flex-none`}>
            <XIcon className="text-faint" />
            {t("common.cancel")}
          </Link>
          <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 sm:flex-none`}>
            {pending && action === "save" ? <SpinnerIcon /> : <SaveIcon />}
            {t("approvalRoutes.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
