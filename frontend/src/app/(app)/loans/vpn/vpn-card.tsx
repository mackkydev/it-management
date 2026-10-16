"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { cancelVpnRequest, chooseVpn, closeVpn, revealVpn, saveVpnAssignment, type VpnAssignValues } from "@/app/actions/vpn";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckIcon, ClipboardIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyIcon, PencilIcon, ResetIcon, SaveIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ReauthPrompt } from "@/components/reauth-prompt";
import { Tooltip } from "@/components/tooltip";
import { btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { copySecret } from "@/lib/clipboard";
import { localToday } from "@/lib/date";
import type { ReauthChallenge, VpnAccount, VpnLoan } from "@/lib/types";

type Tone = keyof typeof tone;

/** สถานะที่แสดง: ใช้งานอยู่แต่ถึงช่วงแจ้งเตือน = ใกล้หมดอายุ, เลยวันหมดอายุ = หมดอายุแล้ว */
function stateOf(l: VpnLoan): { key: string; tone: Tone } {
  if (l.is_expired) return { key: "expired", tone: "danger" };
  if (l.is_expiring) return { key: "expiring", tone: "warning" };
  // ขอผ่านใบแจ้งงานที่หัวหน้ายังไม่อนุมัติ
  if (l.status === "requested" && l.ticket?.status === "pending_supervisor") return { key: "awaiting", tone: "idle" };
  const map: Record<VpnLoan["status"], Tone> = {
    requested: "info",
    active: "success",
    renewal_requested: "warning",
    cancel_requested: "warning",
    ended: "idle",
    rejected: "danger",
    cancelled: "idle",
  };
  return { key: l.status, tone: map[l.status] };
}

export function VpnStatusBadge({ loan }: { loan: VpnLoan }) {
  const { t } = useI18n();
  const s = stateOf(loan);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone[s.tone].badge}`}>{t(`vpn.states.${s.key}` as never)}</span>;
}

const AUTO_HIDE_MS = 30_000;

/** รหัส VPN ของตัวเอง — กดเปิดดู (API บันทึกประวัติ / ยืนยันตัวตนซ้ำตามตั้งค่า) ซ่อนเองใน 30 วินาที */
function RevealVpn({ id }: { id: string }) {
  const { t } = useI18n();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [reauth, setReauth] = useState<ReauthChallenge | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (value === null) return;
    const timer = window.setTimeout(() => setValue(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const reveal = () =>
    start(async () => {
      const res = await revealVpn(id);
      if ("error" in res) {
        if (res.reauth) setReauth(res.reauth);
        else setError(res.error);
      } else setValue(res.password ?? "");
    });
  const copy = async () => {
    if (value === null) return;
    await copySecret(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (error) return <span className="text-xs text-danger-600 dark:text-danger-300">{error}</span>;
  if (reauth) return <ReauthPrompt challenge={reauth} onConfirmed={() => (setReauth(null), reveal())} onCancel={() => setReauth(null)} />;
  const iconBtn = "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-1">
      <code className="min-w-24 rounded-lg bg-subtle px-2 py-1 font-mono text-xs">{value === null ? "••••••••••" : value}</code>
      <Tooltip label={value === null ? t("vault.reveal") : t("vault.hide")} side="top">
        <button type="button" onClick={() => (value === null ? reveal() : setValue(null))} disabled={pending} aria-label={value === null ? t("vault.reveal") : t("vault.hide")} className={iconBtn}>
          {pending ? <SpinnerIcon width={14} height={14} /> : value === null ? <EyeIcon width={15} height={15} /> : <EyeOffIcon width={15} height={15} />}
        </button>
      </Tooltip>
      {value !== null && (
        <Tooltip label={copied ? t("vault.copied") : t("vault.copy")} side="top">
          <button type="button" onClick={copy} aria-label={t("vault.copy")} className={iconBtn}>
            {copied ? <CheckIcon width={15} height={15} className="text-success-500" /> : <CopyIcon width={15} height={15} />}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

type Dialog = { kind: "renew" | "stop" | "assign" | "edit" | "reject" | "end" } | null;

/**
 * การ์ด VPN 1 รายการ — ปุ่มตาม can_* จาก API
 * ผู้ใช้: ดูรหัส, ต่ออายุ / เลิกใช้ (→ ใบแจ้งงานเข้าคิว IT), ยกเลิกคำขอ · ผู้ดูแล (loans.manage): มอบบัญชี / แก้ไข / ไม่อนุมัติ / สิ้นสุดการใช้
 */
export function VpnCard({ loan: initial, accounts, showUser = false }: { loan: VpnLoan; accounts?: VpnAccount[]; showUser?: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [l, setL] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();

  const done = (loan?: VpnLoan) => {
    if (loan) setL(loan);
    setDialog(null);
    router.refresh();
  };

  const cancelRequest = async () => {
    if (!(await confirm(t("vpn.actions.confirmCancelRequest")))) return;
    start(async () => {
      const res = await cancelVpnRequest(l.id);
      if (!res.loan) return void (await showAlert(res.errors?.status ?? res.message ?? t("common.saveFailed")));
      done(res.loan);
    });
  };

  const left = l.days_left;
  const leftText =
    left === null ? null : left > 0 ? t("vpn.field.daysLeft", { n: left }) : left === 0 ? t("vpn.field.expiresToday") : t("vpn.field.expiredAgo", { n: -left });
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );

  return (
    <div className={`space-y-3 p-4 ${card} ${l.is_expired ? "ring-danger-300 dark:ring-danger-400/40" : l.is_expiring ? "ring-warning-300 dark:ring-warning-400/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <VpnStatusBadge loan={l} />
          <h3 className="flex items-center gap-1.5 break-words font-semibold">
            <KeyIcon width={16} height={16} className="shrink-0 text-accent-500" />
            {l.account ? l.account.title : showUser ? l.user.name : t("tickets.vpn.detail")}
          </h3>
          {showUser && l.account && <p className="text-sm text-muted">{l.user.name}{l.department ? ` · ${l.department}` : ""}</p>}
        </div>
        {leftText && (
          <span className={`text-sm font-medium ${l.is_expired ? "text-danger-600 dark:text-danger-300" : l.is_expiring ? "text-warning-700 dark:text-warning-300" : "text-muted"}`}>{leftText}</span>
        )}
      </div>

      {l.can_choose && l.is_expiring && (
        <p className="flex items-center gap-2 rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-400/10 dark:text-warning-300">
          <AlertIcon width={15} height={15} className="shrink-0" />
          {t("vpn.expiringAlert")}
        </p>
      )}

      <dl className="divide-y divide-line">
        {showUser && !l.account && row(t("vpn.field.user"), `${l.user.name}${l.department ? ` · ${l.department}` : ""}`)}
        {row(t("vpn.field.purpose"), <span className="whitespace-pre-line">{l.purpose}</span>)}
        {l.status === "requested" &&
          l.requested_until &&
          row(t("vpn.field.requestedUntil"), `${l.requested_from ? `${fmt.date(l.requested_from)} – ` : ""}${fmt.date(l.requested_until)}`)}
        {l.status === "requested" && l.created_at && row(t("vpn.field.requestedAt"), fmt.dateTime(l.created_at))}
        {l.account?.username && row(t("vpn.field.username"), <code className="font-mono text-xs">{l.account.username}</code>)}
        {l.can_reveal && row(t("vpn.field.password"), <RevealVpn id={l.id} />)}
        {l.account?.url && row(t("vpn.field.server"), <span className="break-all">{l.account.url}</span>)}
        {l.start_on && l.expires_on && row(t("vpn.field.expiresOn"), `${fmt.date(l.start_on)} – ${fmt.date(l.expires_on)}`)}
        {l.expires_on && (l.can_edit || l.can_choose) && row(t("vpn.field.notifyDays"), t("vpn.field.notifyDaysValue", { n: l.notify_days_before }))}
        {l.assigned_by && row(t("vpn.field.assignedBy"), `${l.assigned_by}${l.assigned_at ? ` · ${fmt.dateTime(l.assigned_at)}` : ""}`)}
        {l.renew_until && (l.status === "renewal_requested" || l.status === "active") && l.ticket && row(t("vpn.field.renewUntil"), fmt.date(l.renew_until))}
        {l.choice_reason && row(t("vpn.field.reason"), <span className="whitespace-pre-line">{l.choice_reason}</span>)}
        {l.ticket &&
          row(
            t("vpn.field.ticket"),
            <Link href={`/tickets/${l.ticket.id}`} className="cursor-pointer font-medium text-accent-700 hover:underline dark:text-accent-300">
              {l.ticket.ticket_no}
            </Link>,
          )}
        {l.ended_at && row(t("vpn.field.endedBy"), `${l.ended_by ?? "-"} · ${fmt.dateTime(l.ended_at)}`)}
        {l.end_note && row(t("vpn.field.endNote"), <span className="whitespace-pre-line">{l.end_note}</span>)}
      </dl>

      {(l.can_choose || l.can_cancel || l.can_assign || l.can_edit || l.can_reject || l.can_end) && (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {l.can_cancel && (
            <button type="button" disabled={pending} onClick={cancelRequest} className={`${btn.secondary} ${btn.sm}`}>
              {pending ? <SpinnerIcon width={14} height={14} /> : <XIcon width={14} height={14} />}
              {t("vpn.actions.cancelRequest")}
            </button>
          )}
          {l.can_choose && (
            <>
              <button type="button" onClick={() => setDialog({ kind: "stop" })} className={`${btn.secondary} ${btn.sm}`}>
                <XIcon width={14} height={14} />
                {t("vpn.actions.stop")}
              </button>
              <button type="button" onClick={() => setDialog({ kind: "renew" })} className={`${btn.primary} ${btn.sm}`}>
                <ResetIcon width={14} height={14} />
                {t("vpn.actions.renew")}
              </button>
            </>
          )}
          {l.can_reject && (
            <button type="button" onClick={() => setDialog({ kind: "reject" })} className={`${btn.danger} ${btn.sm}`}>
              <XIcon width={14} height={14} />
              {t("vpn.actions.reject")}
            </button>
          )}
          {l.can_end && (
            <button type="button" onClick={() => setDialog({ kind: "end" })} className={`${btn.danger} ${btn.sm}`}>
              <XIcon width={14} height={14} />
              {t("vpn.actions.end")}
            </button>
          )}
          {l.can_edit && accounts && (
            <button type="button" onClick={() => setDialog({ kind: "edit" })} className={`${btn.soft} ${btn.sm}`}>
              <PencilIcon width={14} height={14} />
              {t("vpn.actions.edit")}
            </button>
          )}
          {l.can_assign && accounts && (
            <button type="button" onClick={() => setDialog({ kind: "assign" })} className={`${btn.primary} ${btn.sm}`}>
              <KeyIcon width={14} height={14} />
              {t("vpn.actions.assign")}
            </button>
          )}
        </div>
      )}

      {dialog && (dialog.kind === "renew" || dialog.kind === "stop") && (
        <ChoiceDialog
          loan={l}
          choice={dialog.kind === "renew" ? "renew" : "cancel"}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog && (dialog.kind === "assign" || dialog.kind === "edit") && accounts && (
        <AssignDialog loan={l} mode={dialog.kind} accounts={accounts} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog && (dialog.kind === "reject" || dialog.kind === "end") && (
        <CloseDialog loan={l} action={dialog.kind} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- กล่องลอย */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} shrink-0 px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const label = (htmlFor: string, text: string, required = false) => (
  <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
    {text} {required && <span className="text-red-500">*</span>}
  </label>
);
const errorText = (msg?: string) => (msg ? <p className="mt-1 text-xs font-medium text-red-500">{msg}</p> : null);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ผู้ใช้เลือก ต่ออายุ (+ วันที่ต้องการ) / เลิกใช้ → ใบแจ้งงานเข้าคิว IT */
function ChoiceDialog({ loan, choice, onClose, onDone }: { loan: VpnLoan; choice: "renew" | "cancel"; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
  const { t } = useI18n();
  const today = localToday();
  const base = loan.expires_on && loan.expires_on > today ? loan.expires_on : today;
  const [renewUntil, setRenewUntil] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"renew_until" | "reason" | "choice", string>>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (choice === "renew" && !renewUntil) return setErrors({ renew_until: t("vpn.choice.validate.renewUntil") });
    start(async () => {
      const res = await chooseVpn(loan.id, { choice, renew_until: renewUntil, reason });
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors?.choice ?? (res.errors ? "" : (res.message ?? "")));
        return;
      }
      onDone(res.loan);
    });
  };

  return (
    <Modal title={t(choice === "renew" ? "vpn.choice.renewTitle" : "vpn.choice.stopTitle")} onClose={onClose}>
      <p className="flex items-start gap-2 text-sm text-muted">
        <ClipboardIcon width={15} height={15} className="mt-0.5 shrink-0 text-accent-500" />
        {t("vpn.choice.hint")}
      </p>
      {message && <p className="text-sm font-medium text-red-500">{message}</p>}
      <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
        {choice === "renew" && (
          <div>
            {label("vpn-renew-until", t("vpn.field.renewUntil"), true)}
            <DateInput
              id="vpn-renew-until"
              value={renewUntil}
              min={addDays(base, 1)}
              max={addDays(today, 366)}
              onChange={(d) => (setRenewUntil(d), setErrors((e) => ({ ...e, renew_until: undefined })))}
              className={`${input} ${errors.renew_until ? inputError : ""}`}
            />
            {errorText(errors.renew_until)}
          </div>
        )}
        <div>
          {label("vpn-reason", t("vpn.field.reason"))}
          <textarea
            id="vpn-reason"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => (setReason(e.target.value), setErrors((x) => ({ ...x, reason: undefined })))}
            className={`${input} ${errors.reason ? inputError : ""}`}
          />
          {errorText(errors.reason)}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="button" disabled={pending} onClick={submit} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <SendIcon width={16} height={16} />}
          {t("vpn.actions.send")}
        </button>
      </div>
    </Modal>
  );
}

/** ผู้ดูแลมอบบัญชี (คำขอที่รอ) / แก้ไขบัญชี วันหมดอายุ แจ้งเตือนล่วงหน้า */
function AssignDialog({ loan, mode, accounts, onClose, onDone }: { loan: VpnLoan; mode: "assign" | "edit"; accounts: VpnAccount[]; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
  const { t, fmt } = useI18n();
  const today = localToday();
  const [v, setV] = useState<VpnAssignValues>({
    credential_id: loan.account ? String(loan.account.id) : "",
    start_on: loan.start_on ?? (loan.requested_from && loan.requested_from >= today ? loan.requested_from : today),
    expires_on: loan.expires_on ?? (loan.requested_until && loan.requested_until >= today ? loan.requested_until : addDays(today, 90)),
    notify_days_before: String(loan.notify_days_before ?? 7),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof VpnAssignValues | "status", string>>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof VpnAssignValues>(k: K, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = () => {
    const e: typeof errors = {};
    if (!v.credential_id) e.credential_id = t("vpn.assign.validate.account");
    if (!v.start_on || !v.expires_on) e.expires_on = t("vpn.assign.validate.dates");
    else if (v.expires_on < v.start_on) e.expires_on = t("vpn.assign.validate.order");
    setErrors(e);
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveVpnAssignment(loan.id, mode, v);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors?.status ?? (res.errors ? "" : (res.message ?? "")));
        return;
      }
      onDone(res.loan);
    });
  };

  const accountText = (a: VpnAccount) => {
    const base = `${a.title}${a.username ? ` (${a.username})` : ""}`;
    return a.holder && a.id !== loan.account?.id ? `${base} — ${t("vpn.assign.inUse", { name: `${a.holder}${a.holder_until ? ` · ${fmt.date(a.holder_until)}` : ""}` })}` : base;
  };

  return (
    <Modal title={t(mode === "assign" ? "vpn.assign.title" : "vpn.assign.editTitle", { name: loan.user.name })} onClose={onClose}>
      {message && <p className="text-sm font-medium text-red-500">{message}</p>}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">{t("vpn.noAccounts")}</p>
      ) : (
        <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
          <div>
            {label("vpn-account", t("vpn.field.account"), true)}
            <AppSelect id="vpn-account" value={v.credential_id} onValueChange={(x) => set("credential_id", x)} className={`${input} ${errors.credential_id ? inputError : ""}`}>
              <option value="">{t("vpn.assign.choose")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={String(a.id)} disabled={Boolean(a.holder) && a.id !== loan.account?.id}>
                  {accountText(a)}
                </option>
              ))}
            </AppSelect>
            {errorText(errors.credential_id)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {label("vpn-start", t("vpn.field.startOn"), true)}
              <DateInput id="vpn-start" value={v.start_on} onChange={(d) => set("start_on", d)} className={`${input} ${errors.start_on ? inputError : ""}`} />
              {errorText(errors.start_on)}
            </div>
            <div>
              {label("vpn-expires", t("vpn.field.expiresOn"), true)}
              <DateInput id="vpn-expires" value={v.expires_on} min={v.start_on || undefined} onChange={(d) => set("expires_on", d)} className={`${input} ${errors.expires_on ? inputError : ""}`} />
              {errorText(errors.expires_on)}
            </div>
          </div>
          <div>
            {label("vpn-notify", t("vpn.field.notifyDays"))}
            <input
              id="vpn-notify"
              type="number"
              min={0}
              max={90}
              inputMode="numeric"
              value={v.notify_days_before}
              onChange={(e) => set("notify_days_before", e.target.value)}
              className={`${input} ${errors.notify_days_before ? inputError : ""}`}
            />
            {errorText(errors.notify_days_before)}
          </div>
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        {accounts.length > 0 && (
          <button type="button" disabled={pending} onClick={submit} className={btn.primary}>
            {pending ? <SpinnerIcon width={16} height={16} /> : <SaveIcon width={16} height={16} />}
            {t("vpn.actions.save")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** ไม่อนุมัติคำขอ (ต้องมีเหตุผล) / สิ้นสุดการใช้ (หมายเหตุไม่บังคับ) */
function CloseDialog({ loan, action, onClose, onDone }: { loan: VpnLoan; action: "reject" | "end"; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const reject = action === "reject";

  const submit = async () => {
    if (reject && !note.trim()) return setError(t("vpn.reject.validate"));
    if (!reject && !(await confirm(t("vpn.actions.confirmEnd", { name: loan.user.name })))) return;
    start(async () => {
      const res = await closeVpn(loan.id, action, note);
      if (!res.ok) return setError(res.errors?.note ?? res.errors?.status ?? res.message ?? t("common.saveFailed"));
      onDone(res.loan);
    });
  };

  return (
    <Modal title={t(reject ? "vpn.reject.title" : "vpn.end.title", { name: loan.user.name })} onClose={onClose}>
      <div>
        {label("vpn-note", reject ? t("vpn.field.reason") : t("vpn.end.note"), reject)}
        <textarea
          id="vpn-note"
          rows={3}
          maxLength={2000}
          value={note}
          disabled={pending}
          onChange={(e) => (setNote(e.target.value), setError(""))}
          className={`${input} ${error ? inputError : ""}`}
        />
        {errorText(error)}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="button" disabled={pending} onClick={submit} className={btn.danger}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <XIcon width={16} height={16} />}
          {t(reject ? "vpn.actions.reject" : "vpn.actions.end")}
        </button>
      </div>
    </Modal>
  );
}
