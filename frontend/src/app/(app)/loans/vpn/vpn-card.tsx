"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { approveVpn, cancelVpnRequest, chooseVpn, closeVpn, receiveVpn, revealVpn, revokeVpn, saveVpnAssignment, type VpnAssignValues } from "@/app/actions/vpn";
import { PasswordInput } from "@/components/password-input";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckIcon, ChevronDownIcon, ClipboardIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyIcon, PencilIcon, ResetIcon, SaveIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
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
  if (l.revoked_at && ["active", "renewal_requested", "cancel_requested"].includes(l.status)) return { key: "revoked", tone: "idle" };
  if (l.is_expired) return { key: "expired", tone: "danger" };
  if (l.is_expiring) return { key: "expiring", tone: "warning" };
  // ขอผ่านใบแจ้งงานที่หัวหน้ายังไม่อนุมัติ
  if (l.status === "requested" && (l.ticket?.status === "pending_supervisor" || l.ticket?.status === "approval_requested")) return { key: "awaiting", tone: "idle" };
  // อนุมัติแล้ว รอผู้ขอกด "ได้รับแล้ว"
  if (l.status === "active" && !l.received_at) return { key: "toReceive", tone: "info" };
  const map: Record<VpnLoan["status"], Tone> = {
    requested: "info",
    pending_approval: "warning",
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

/** ค่าที่เปิดดูแล้วจำไว้ 1 นาที (ในหน่วยความจำของแท็บนี้ — โหลดหน้าใหม่ = ต้องกรอกรหัสผ่านอีกครั้ง) */
const CACHE_MS = 60_000;
const revealed = new Map<string, { username: string | null; password: string; until: number }>();
const cachedOf = (id: string) => {
  const c = revealed.get(id);
  if (c && c.until > Date.now()) return c;
  revealed.delete(id);
  return null;
};

/**
 * ชื่อผู้ใช้ / รหัส VPN ของตัวเอง — กดดู = กรอกรหัสผ่าน login ของตัวเองทุกครั้ง (API ตรวจ + บันทึกประวัติ)
 * ค่าที่เปิดแล้วจำไว้ 1 นาที (เปิด/ซ่อนซ้ำได้ไม่ต้องกรอกใหม่) แล้วซ่อนเอง — มีปุ่มคัดลอก
 */
function RevealVpn({ id }: { id: string }) {
  const { t } = useI18n();
  const [value, setValue] = useState<{ username: string | null; password: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [clearIn, setClearIn] = useState(0);
  const [reauth, setReauth] = useState<ReauthChallenge | null>(null);
  const [pending, start] = useTransition();

  // ซ่อนเองเมื่อครบเวลาที่จำไว้
  useEffect(() => {
    if (value === null) return;
    const c = revealed.get(id);
    const timer = window.setTimeout(() => setValue(null), Math.max(0, (c?.until ?? 0) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [value, id]);

  const open = () => {
    const c = cachedOf(id);
    if (c) return setValue(c);
    setAsking(true);
    setError("");
  };
  const submit = () => {
    if (!password) return setError(t("vpn.reveal.passwordRequired"));
    start(async () => {
      const res = await revealVpn(id, password);
      if ("error" in res) {
        if (res.reauth) setReauth(res.reauth);
        else setError(res.error);
        return;
      }
      const v = { username: res.username, password: res.password ?? "", until: Date.now() + CACHE_MS };
      revealed.set(id, v);
      setValue(v);
      setAsking(false);
      setPassword("");
    });
  };
  const copy = async (what: "username" | "password") => {
    const text = what === "username" ? value?.username : value?.password;
    if (!text) return;
    setClearIn(await copySecret(text));
    setCopied(what);
    window.setTimeout(() => setCopied(""), 1500);
  };

  if (reauth) return <ReauthPrompt challenge={reauth} onConfirmed={() => (setReauth(null), submit())} onCancel={() => setReauth(null)} />;
  const iconBtn = "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed";
  const copyBtn = (what: "username" | "password") => (
    <Tooltip label={copied === what ? t("vault.copied", { seconds: clearIn }) : t("vault.copy")}>
      <button type="button" onClick={() => copy(what)} aria-label={t("vault.copy")} className={iconBtn}>
        {copied === what ? <CheckIcon width={15} height={15} className="text-success-500" /> : <CopyIcon width={15} height={15} />}
      </button>
    </Tooltip>
  );
  if (asking && value === null) {
    return (
      <form action={submit} className="space-y-1.5">
        <p className="text-xs text-muted">{t("vpn.reveal.hint")}</p>
        <div className="flex items-center gap-1.5">
          <PasswordInput
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => (setPassword(e.target.value), setError(""))}
            aria-label={t("vpn.reveal.password")}
            placeholder={t("vpn.reveal.password")}
            className={`${input} ${error ? inputError : ""}`}
          />
          <button type="submit" disabled={pending} className={`${btn.primary} ${btn.sm} shrink-0`}>
            {pending ? <SpinnerIcon width={14} height={14} /> : <EyeIcon width={14} height={14} />}
            {t("vpn.reveal.show")}
          </button>
          <Tooltip label={t("common.cancel")}>
            <button type="button" onClick={() => (setAsking(false), setPassword(""), setError(""))} aria-label={t("common.cancel")} className={iconBtn}>
              <XIcon width={14} height={14} />
            </button>
          </Tooltip>
        </div>
        {error && <p className="text-xs font-medium text-red-500">{error}</p>}
      </form>
    );
  }
  return (
    <div className="space-y-1">
      {value !== null && (
        <div className="flex items-center gap-1">
          <span className="w-16 shrink-0 text-xs text-muted">{t("vpn.field.username")}</span>
          <code className="min-w-24 rounded-lg bg-subtle px-2 py-1 font-mono text-xs">{value.username ?? "-"}</code>
          {value.username && copyBtn("username")}
        </div>
      )}
      <div className="flex items-center gap-1">
        {value !== null && <span className="w-16 shrink-0 text-xs text-muted">{t("vpn.field.password")}</span>}
        <code className="min-w-24 rounded-lg bg-subtle px-2 py-1 font-mono text-xs">{value === null ? "••••••••••" : value.password}</code>
        <Tooltip label={value === null ? t("vpn.reveal.open") : t("vault.hide")}>
          <button type="button" onClick={() => (value === null ? open() : setValue(null))} aria-label={value === null ? t("vpn.reveal.open") : t("vault.hide")} className={iconBtn}>
            {value === null ? <EyeIcon width={15} height={15} /> : <EyeOffIcon width={15} height={15} />}
          </button>
        </Tooltip>
        {value !== null && copyBtn("password")}
      </div>
    </div>
  );
}

type Dialog = { kind: "renew" | "stop" | "locked" | "assign" | "edit" | "reject" | "end" | "approve" | "revoke" } | null;

/**
 * การ์ด VPN 1 รายการ — ปุ่มตาม can_* จาก API
 * ผู้ใช้: ได้รับแล้ว (ปิดใบแจ้งงาน), ดูชื่อผู้ใช้ / รหัส (กรอกรหัสผ่าน login), ขอต่ออายุ / แจ้งถูกล็อก / ไม่ต่ออายุ (ยืนยันก่อนส่ง → ใบแจ้งงานเข้าคิว IT), ยกเลิกคำขอ
 * ผู้ดูแล (loans.manage): มอบบัญชี (→ รอผู้จัดการฝ่าย IT อนุมัติ) / แก้ไข / ไม่อนุมัติ / สิ้นสุดการใช้ / เรียกคืนรหัส · ผู้จัดการฝ่าย IT: อนุมัติ / ส่งกลับ
 */
export function VpnCard({
  loan: initial,
  accounts,
  showUser = false,
  defaultNotifyDays = 7,
  compact = false,
}: {
  loan: VpnLoan;
  accounts?: VpnAccount[];
  showUser?: boolean;
  defaultNotifyDays?: number;
  /** การ์ดย่อขนาดเท่าการ์ด License (หัวการ์ดบรรทัดเดียว) — กดขยายดูรายละเอียด + ปุ่ม (หน้า จัดการ VPN) */
  compact?: boolean;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [l, setL] = useState(initial);
  const [open, setOpen] = useState(!compact);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();

  const done = (loan?: VpnLoan) => {
    if (loan) setL(loan);
    setDialog(null);
    router.refresh();
  };

  const receive = async () => {
    if (!(await confirm(t("vpn.actions.confirmReceive")))) return;
    start(async () => {
      const res = await receiveVpn(l.id);
      if (!res.loan) return void (await showAlert(res.errors?.status ?? res.message ?? t("common.saveFailed")));
      done(res.loan);
    });
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

  const title = l.account ? l.account.title : showUser ? l.user.name : t("tickets.vpn.detail");
  const leftCls = l.is_expired ? "text-danger-600 dark:text-danger-300" : l.is_expiring ? "text-warning-700 dark:text-warning-300" : "text-muted";
  const ring = l.is_expired ? "ring-danger-300 dark:ring-danger-400/40" : l.is_expiring ? "ring-warning-300 dark:ring-warning-400/40" : "";
  // มีปุ่มรอทำ (มอบ / อนุมัติ / ได้รับ) = จุดเตือนบนการ์ดย่อ
  const actionable = l.can_assign || l.can_approve || l.can_receive;

  return (
    <div className={`space-y-3 p-4 ${card} ${ring}`}>
      {compact ? (
        // การ์ดย่อ: ไอคอน + ชื่อบัญชี/ผู้ใช้ + บรรทัดสรุป (ผู้ใช้ · สถานะ · วันเหลือ) — กดทั้งแถบเพื่อขยาย
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 text-left">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600 ring-1 ring-inset ring-accent-200 dark:bg-accent-400/10 dark:text-accent-300 dark:ring-accent-400/20">
            <KeyIcon width={18} height={18} />
            {actionable && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger-500 ring-2 ring-surface" aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{title}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
              {showUser && l.account && <span className="truncate">{l.user.name}</span>}
              <VpnStatusBadge loan={l} />
              {leftText && <span className={`font-medium ${leftCls}`}>{leftText}</span>}
            </span>
          </span>
          <ChevronDownIcon width={16} height={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          <span className="sr-only">{t(open ? "vpn.actions.collapse" : "vpn.actions.expand")}</span>
        </button>
      ) : (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <VpnStatusBadge loan={l} />
          <h3 className="flex items-center gap-1.5 break-words font-semibold">
            <KeyIcon width={16} height={16} className="shrink-0 text-accent-500" />
            {l.account ? l.account.title : showUser ? l.user.name : t("tickets.vpn.detail")}
          </h3>
          {showUser && l.account && <p className="text-sm text-muted">{l.user.name}{l.department ? ` · ${l.department}` : ""}</p>}
        </div>
        {leftText && <span className={`text-sm font-medium ${leftCls}`}>{leftText}</span>}
      </div>
      )}

      {open && (
      <>
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
        {l.account?.username && !l.can_reveal && row(t("vpn.field.username"), <code className="font-mono text-xs">{l.account.username}</code>)}
        {l.can_reveal && row(t("vpn.field.credentials"), <RevealVpn id={l.id} />)}
        {l.status === "pending_approval" && row(t("vpn.field.approval"), t("vpn.approval.waiting"))}
        {l.approved_by && row(t("vpn.field.approvedBy"), `${l.approved_by}${l.approved_at ? ` · ${fmt.dateTime(l.approved_at)}` : ""}`)}
        {l.revoked_at && row(t("vpn.field.revokedAt"), fmt.dateTime(l.revoked_at))}
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

      {(l.can_choose || l.can_cancel || l.can_assign || l.can_edit || l.can_reject || l.can_end || l.can_receive || l.can_approve || l.can_revoke) && (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {l.can_receive && (
            <button type="button" disabled={pending} onClick={receive} className={`${btn.primary} ${btn.sm}`}>
              {pending ? <SpinnerIcon width={14} height={14} /> : <CheckIcon width={14} height={14} />}
              {t("vpn.actions.receive")}
            </button>
          )}
          {l.can_approve && (
            <button type="button" onClick={() => setDialog({ kind: "approve" })} className={`${btn.primary} ${btn.sm}`}>
              <CheckIcon width={14} height={14} />
              {t("vpn.actions.approve")}
            </button>
          )}
          {l.can_revoke && (
            <button type="button" onClick={() => setDialog({ kind: "revoke" })} className={`${btn.secondary} ${btn.sm}`}>
              <ResetIcon width={14} height={14} />
              {t("vpn.actions.revoke")}
            </button>
          )}
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
              <button type="button" onClick={() => setDialog({ kind: "locked" })} className={`${btn.secondary} ${btn.sm}`}>
                <AlertIcon width={14} height={14} />
                {t("vpn.actions.locked")}
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
      </>
      )}

      {dialog && (dialog.kind === "renew" || dialog.kind === "stop" || dialog.kind === "locked") && (
        <ChoiceDialog
          loan={l}
          choice={dialog.kind === "renew" ? "renew" : dialog.kind === "locked" ? "locked" : "cancel"}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog && (dialog.kind === "assign" || dialog.kind === "edit") && accounts && (
        <AssignDialog loan={l} mode={dialog.kind} accounts={accounts} defaultNotifyDays={defaultNotifyDays} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === "approve" && <ApproveDialog loan={l} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "revoke" && <RevokeDialog loan={l} onClose={() => setDialog(null)} onDone={done} />}
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
function ChoiceDialog({ loan, choice, onClose, onDone }: { loan: VpnLoan; choice: "renew" | "cancel" | "locked"; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
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
    <Modal title={t(choice === "renew" ? "vpn.choice.renewTitle" : choice === "locked" ? "vpn.choice.lockedTitle" : "vpn.choice.stopTitle")} onClose={onClose}>
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
function AssignDialog({
  loan,
  mode,
  accounts,
  defaultNotifyDays,
  onClose,
  onDone,
}: {
  loan: VpnLoan;
  mode: "assign" | "edit";
  accounts: VpnAccount[];
  /** มอบใหม่: วันแจ้งเตือนล่วงหน้าตั้งต้นจากหน้าตั้งค่า (vpn_notify_days) */
  defaultNotifyDays: number;
  onClose: () => void;
  onDone: (loan?: VpnLoan) => void;
}) {
  const { t, fmt } = useI18n();
  const today = localToday();
  const [v, setV] = useState<VpnAssignValues>({
    credential_id: loan.account ? String(loan.account.id) : "",
    start_on: loan.start_on ?? (loan.requested_from && loan.requested_from >= today ? loan.requested_from : today),
    expires_on: loan.expires_on ?? (loan.requested_until && loan.requested_until >= today ? loan.requested_until : addDays(today, 90)),
    notify_days_before: String(mode === "assign" ? defaultNotifyDays : (loan.notify_days_before ?? defaultNotifyDays)),
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
            <p className="mt-1 text-xs text-muted">{t("vpn.assign.notifyHint", { n: defaultNotifyDays })}</p>
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

/** ผู้จัดการฝ่าย IT อนุมัติการมอบบัญชี (แจ้งผู้ขอ) / ส่งกลับ (ต้องมีเหตุผล → กลับเป็นรอมอบ แจ้งผู้มอบ) */
function ApproveDialog({ loan, onClose, onDone }: { loan: VpnLoan; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
  const { t, fmt } = useI18n();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submit = (approve: boolean) => {
    if (!approve && !note.trim()) return setError(t("vpn.approval.noteRequired"));
    start(async () => {
      const res = await approveVpn(loan.id, approve, note);
      if (!res.ok) return setError(res.errors?.note ?? res.errors?.signature ?? res.errors?.status ?? res.message ?? t("common.saveFailed"));
      onDone(res.loan);
    });
  };

  return (
    <Modal title={t("vpn.approval.title", { name: loan.user.name })} onClose={onClose}>
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">{t("vpn.field.account")}</dt><dd>{loan.account?.title ?? "-"}</dd></div>
        {loan.start_on && loan.expires_on && <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">{t("vpn.field.expiresOn")}</dt><dd>{`${fmt.date(loan.start_on)} – ${fmt.date(loan.expires_on)}`}</dd></div>}
        {loan.assigned_by && <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">{t("vpn.field.assignedBy")}</dt><dd>{loan.assigned_by}</dd></div>}
      </dl>
      <p className="text-xs text-muted">{t("vpn.approval.hint")}</p>
      <div>
        {label("vpn-approval-note", t("vpn.approval.note"))}
        <textarea id="vpn-approval-note" rows={2} maxLength={2000} value={note} disabled={pending} onChange={(e) => (setNote(e.target.value), setError(""))} className={`${input} ${error ? inputError : ""}`} />
        {errorText(error)}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="button" disabled={pending} onClick={() => submit(false)} className={btn.danger}>
          <ResetIcon width={16} height={16} />
          {t("vpn.approval.return")}
        </button>
        <button type="button" disabled={pending} onClick={() => submit(true)} className={btn.primary}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
          {t("vpn.actions.approve")}
        </button>
      </div>
    </Modal>
  );
}

/** เรียกคืนรหัส VPN — ยืนยันก่อน, ผู้ใช้ดูชื่อผู้ใช้ / รหัสผ่านไม่ได้อีก (แจ้งผู้ใช้) */
function RevokeDialog({ loan, onClose, onDone }: { loan: VpnLoan; onClose: () => void; onDone: (loan?: VpnLoan) => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submit = async () => {
    if (!(await confirm(t("vpn.revoke.confirm", { name: loan.user.name })))) return;
    start(async () => {
      const res = await revokeVpn(loan.id, note);
      if (!res.ok) return setError(res.errors?.note ?? res.errors?.status ?? res.message ?? t("common.saveFailed"));
      onDone(res.loan);
    });
  };

  return (
    <Modal title={t("vpn.revoke.title", { name: loan.user.name })} onClose={onClose}>
      <p className="text-sm text-muted">{t("vpn.revoke.hint")}</p>
      <div>
        {label("vpn-revoke-note", t("vpn.end.note"))}
        <textarea id="vpn-revoke-note" rows={2} maxLength={2000} value={note} disabled={pending} onChange={(e) => (setNote(e.target.value), setError(""))} className={`${input} ${error ? inputError : ""}`} />
        {errorText(error)}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="button" disabled={pending} onClick={submit} className={btn.danger}>
          {pending ? <SpinnerIcon width={16} height={16} /> : <ResetIcon width={16} height={16} />}
          {t("vpn.actions.revoke")}
        </button>
      </div>
    </Modal>
  );
}
