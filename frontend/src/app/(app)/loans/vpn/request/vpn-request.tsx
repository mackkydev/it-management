"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestVpn, type VpnRequestValues } from "@/app/actions/vpn";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { AlertIcon, PlusIcon, SendIcon, SpinnerIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { User } from "@/lib/types";
import type { TicketFormOptions } from "../../../tickets/new/ticket-form";

type Field = keyof VpnRequestValues | "signature";
const MAX_DAYS = 366;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * ปุ่ม + กล่อง "ขอใช้ VPN" — ฟอร์มสั้นเฉพาะเรื่อง VPN (ไม่ใช่หน้าตาฟอร์มแจ้งงาน) แต่เก็บข้อมูลชุดเดียวกับใบแจ้งงาน:
 * ช่วงวันที่ใช้ / เหตุผล / เจ้าหน้าที่ IT / ผู้อนุมัติ (ไม่เลือก = ตามสายอนุมัติ) / สาขา — ส่งแล้วระบบสร้างใบแจ้งงานเบื้องหลัง (ผ่านหัวหน้า → ฝ่าย IT)
 */
export function VpnRequestButton({ user, options }: { user: User; options: TicketFormOptions }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const today = localToday();
  const userBranch = options.branches.some((b) => b.id === user.branch_id) ? String(user.branch_id) : "";
  const blank = (): VpnRequestValues => ({ vpn_start_on: today, vpn_end_on: addDays(today, 30), reason: "", assignee_id: "", approver_id: "", branch_id: userBranch });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<VpnRequestValues>(blank);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const itFirst = options.approval_flow === "it_first";
  const approvers = options.approvers.filter((a) => !v.branch_id || a.branch_id === Number(v.branch_id));

  const set = <K extends keyof VpnRequestValues>(k: K, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.vpn_start_on || !v.vpn_end_on) e.vpn_start_on = t("vpn.request.validate.dates");
    else if (v.vpn_end_on < v.vpn_start_on) e.vpn_end_on = t("vpn.request.validate.order");
    if (!v.reason.trim()) e.reason = t("vpn.request.validate.reason");
    if (!v.assignee_id) e.assignee_id = t("vpn.request.validate.staff");
    if (!v.branch_id) e.branch_id = t("vpn.request.validate.branch");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await requestVpn(v, { department: user.department ?? null, division: user.division ?? null });
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors?.signature ?? (res.errors ? "" : (res.message ?? "")));
        return;
      }
      setOpen(false);
      setV(blank());
      toast("success", t("vpn.request.saved"));
      router.refresh();
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn.primary}>
        <PlusIcon />
        {t("vpn.request.new")}
      </button>
      {open && (
        <ModalShell id="vpn-request" title={t("vpn.request.formTitle")} onClose={() => setOpen(false)} busy={pending} size="lg">
          <form action={submit} className="space-y-4 overflow-y-auto p-5">
            {message && (
              <p role="alert" className={alert.error}>
                <AlertIcon className="shrink-0 text-danger-400" />
                {message}
              </p>
            )}
            <fieldset disabled={pending} className="grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2">
              <div>
                {label("vpn-from", t("vpn.request.from"), true)}
                <DateInput id="vpn-from" value={v.vpn_start_on} min={today} onChange={(d) => (set("vpn_start_on", d), v.vpn_end_on < d ? set("vpn_end_on", d) : null)} className={cls("vpn_start_on")} />
                {err("vpn_start_on")}
              </div>
              <div>
                {label("vpn-until", t("vpn.request.until"), true)}
                <DateInput id="vpn-until" value={v.vpn_end_on} min={v.vpn_start_on || today} max={addDays(v.vpn_start_on || today, MAX_DAYS)} onChange={(d) => set("vpn_end_on", d)} className={cls("vpn_end_on")} />
                {err("vpn_end_on")}
              </div>
              <div className="sm:col-span-2">
                {label("vpn-reason", t("vpn.request.reason"), true)}
                <textarea id="vpn-reason" rows={3} maxLength={2000} value={v.reason} placeholder={t("vpn.request.reasonPlaceholder")} onChange={(e) => set("reason", e.target.value)} className={cls("reason")} />
                {err("reason")}
              </div>
              <div>
                {label("vpn-staff", t("vpn.request.staff"), true)}
                <AppSelect id="vpn-staff" value={v.assignee_id} onValueChange={(x) => set("assignee_id", x)} className={cls("assignee_id")}>
                  <option value="">{t("vpn.request.staffChoose")}</option>
                  {options.it_staff.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </AppSelect>
                {err("assignee_id")}
              </div>
              <div>
                {label("vpn-branch", t("vpn.request.branch"), true)}
                <AppSelect id="vpn-branch" value={v.branch_id} onValueChange={(x) => (set("branch_id", x), set("approver_id", ""))} className={cls("branch_id")}>
                  <option value="">—</option>
                  {options.branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))}
                </AppSelect>
                {err("branch_id")}
              </div>
              {!itFirst && (
                <div className="sm:col-span-2">
                  {label("vpn-approver", t("vpn.request.approver"))}
                  <AppSelect id="vpn-approver" value={v.approver_id} onValueChange={(x) => set("approver_id", x)} className={cls("approver_id")}>
                    <option value="">{t("vpn.request.approverDefault")}</option>
                    {approvers.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name}
                      </option>
                    ))}
                  </AppSelect>
                  {err("approver_id")}
                </div>
              )}
            </fieldset>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btn.secondary}>
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={pending} className={btn.primary}>
                {pending ? <SpinnerIcon /> : <SendIcon />}
                {t("vpn.request.submit")}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}


