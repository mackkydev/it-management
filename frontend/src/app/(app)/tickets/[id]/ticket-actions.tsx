"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteTicket, recordResult, requestCancel, ticketAction, type TicketResult } from "@/app/actions/tickets";
import { DateInput } from "@/components/date-input";
import { PhotoPicker } from "@/components/file-pickers";
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  HistoryIcon,
  InboxIcon,
  PencilIcon,
  PlusIcon,
  ResetIcon,
  SaveIcon,
  SpinnerIcon,
  TrashIcon,
  WrenchIcon,
  XIcon,
} from "@/components/icons";
import { SignaturePad } from "@/components/signature-pad";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { TicketAction, TicketDetail } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";

const ICONS: Record<TicketAction, ReactNode> = {
  approve: <CheckCircleIcon />,
  reject: <XIcon />,
  accept: <InboxIcon />,
  progress: <HistoryIcon />,
  result: <WrenchIcon />,
  close: <CheckIcon />,
  return: <ResetIcon />,
  confirm_close: <CheckCircleIcon />,
  edit: <PencilIcon />,
  delete: <TrashIcon />,
  cancel_request: <XIcon />,
  cancel_confirm: <CheckIcon />,
  cancel_reject: <ResetIcon />,
  cancel_withdraw: <ResetIcon />,
};

/** ปุ่มที่ทำทันที (ไม่ต้องเปิดฟอร์ม) */
const INSTANT: TicketAction[] = ["edit", "delete", "cancel_withdraw"];
const DANGER: TicketAction[] = ["reject", "return", "delete", "cancel_request", "cancel_confirm"];

/** ปุ่มการทำงานตามสิทธิ์และสถานะ (มาจาก API: ticket.actions) */
export function TicketActions({ ticket }: { ticket: TicketDetail }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [active, setActive] = useState<TicketAction | null>(ticket.actions.includes("result") ? null : null);

  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const style = (a: TicketAction) => (DANGER.includes(a) ? btn.danger : a === "result" || a === "progress" || a === "edit" ? btn.soft : btn.primary);

  /** แก้ไข = ไปหน้าแก้ไข, ลบ / ถอนคำขอยกเลิก = ยืนยันแล้วทำทันที */
  const instant = async (a: TicketAction) => {
    if (a === "delete" && !(await confirm(t("tickets.actions.confirmDelete", { no: ticket.ticket_no })))) return;
    start(async () => {
      const res = a === "delete" ? await deleteTicket(ticket.id) : await ticketAction(ticket.id, "cancel_withdraw");
      if (res) setError(res.message ?? "");
    });
  };

  return (
    <div className={`space-y-4 p-4 sm:p-5 print:hidden ${card} ring-2 ring-accent-200 dark:ring-accent-400/30`}>
      <div className="flex flex-wrap gap-2">
        {ticket.actions.map((a) =>
          a === "edit" ? (
            <Link key={a} href={`/tickets/${ticket.id}/edit`} className={style(a)}>
              {ICONS[a]}
              {t("tickets.actions.edit")}
            </Link>
          ) : (
            <button
              key={a}
              type="button"
              disabled={pending}
              onClick={() => (INSTANT.includes(a) ? instant(a) : setActive(active === a ? null : a))}
              aria-expanded={INSTANT.includes(a) ? undefined : active === a}
              className={`${style(a)} disabled:cursor-not-allowed ${active === a ? "ring-2 ring-offset-1 ring-offset-surface ring-accent-300" : ""}`}
            >
              {pending && INSTANT.includes(a) ? <SpinnerIcon /> : ICONS[a]}
              {t(`tickets.actions.${a}`)}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {error}
        </p>
      )}
      {active === "result" ? (
        <ResultForm ticket={ticket} onCancel={() => setActive(null)} />
      ) : active && !INSTANT.includes(active) ? (
        <SimpleActionForm ticket={ticket} action={active as FormAction} onCancel={() => setActive(null)} />
      ) : null}
    </div>
  );
}

type FormAction = Exclude<TicketAction, "result" | "edit" | "delete" | "cancel_withdraw">;

/** อนุมัติ / ไม่อนุมัติ / รับงาน / ความคืบหน้า / อนุมัติผล (ลงลายเซ็น) / ส่งกลับ / ผู้แจ้งรับงาน / ขอยกเลิก / ยืนยัน-ปฏิเสธการยกเลิก */
function SimpleActionForm({ ticket, action, onCancel }: { ticket: TicketDetail; action: FormAction; onCancel: () => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const commentRequired = action === "reject" || action === "return" || action === "progress" || action === "cancel_request" || action === "cancel_reject";
  const needsSignature = action === "close";

  const submit = () => {
    if (commentRequired && !comment.trim()) return setError(t("tickets.actions.commentRequired"));
    if (needsSignature && !signature) return setError(t("signature.required"));
    setError("");
    start(async () => {
      const res: TicketResult | undefined =
        action === "cancel_request" ? await requestCancel(ticket.id, comment) : await ticketAction(ticket.id, action, { comment, signature });
      if (res) setError(res.errors ? Object.values(res.errors)[0] ?? res.message ?? "" : (res.message ?? ""));
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {error}
        </p>
      )}
      {action !== "accept" && (
        <div>
          <label htmlFor="action-comment" className="mb-1 block text-sm font-medium">
            {action === "progress"
              ? t("tickets.actions.progressLabel")
              : action === "cancel_request"
                ? t("tickets.actions.cancelReason")
                : commentRequired
                  ? t("tickets.actions.commentRequired")
                  : t("tickets.actions.comment")}
          </label>
          <textarea
            id="action-comment"
            rows={action === "progress" ? 3 : 2}
            placeholder={action === "progress" ? t("tickets.actions.progressPlaceholder") : undefined}
            maxLength={2000}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setError("");
            }}
            className={`${input} ${error && commentRequired && !comment.trim() ? inputError : ""}`}
          />
        </div>
      )}
      {needsSignature && (
        <div className="max-w-xl">
          <p className="mb-1 text-sm font-medium">
            {t("signature.label")} — {t("tickets.detail.sigItHead")} <span className="text-red-500">*</span>
          </p>
          <SignaturePad invalid={Boolean(error) && !signature} onChange={setSignature} />
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={DANGER.includes(action) ? btn.danger : btn.primary}>
          {pending ? <SpinnerIcon /> : <CheckIcon />}
          {t("tickets.actions.confirm")}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

type Part = { name: string; quantity: string; photo: File | null };

/** 4.3.2–4.3.3 บันทึกผลการดำเนินงาน / การซ่อม + รูปหลังซ่อม ≤ 4 + อะไหล่ (รูปละ 1) */
function ResultForm({ ticket, onCancel }: { ticket: TicketDetail; onCancel: () => void }) {
  const { t } = useI18n();
  const isRepair = ticket.type === "repair";
  const [outcome, setOutcome] = useState<"completed" | "cannot_complete">(ticket.result ?? "completed");
  const [completedOn, setCompletedOn] = useState(ticket.completed_on ?? localToday());
  const [cannotReason, setCannotReason] = useState(ticket.cannot_reason ?? "");
  const [method, setMethod] = useState<"in_house" | "external" | "">(ticket.repair_method ?? "");
  const [vendor, setVendor] = useState(ticket.external_vendor ?? "");
  const [warranty, setWarranty] = useState<"in_warranty" | "out_of_warranty" | "">(ticket.warranty ?? "");
  const [details, setDetails] = useState(ticket.repair_details ?? "");
  const [parts, setParts] = useState<Part[]>(ticket.parts.length ? ticket.parts.map((p) => ({ name: p.name, quantity: String(p.quantity), photo: null })) : []);
  const [photos, setPhotos] = useState<File[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const clearErr = (k: string) => setErrors((e) => ({ ...e, [k]: "" }));

  const submit = () => {
    const e: Record<string, string> = {};
    if (outcome === "completed" && !completedOn) e.completed_on = t("tickets.validate.completedOn");
    if (outcome === "cannot_complete" && !cannotReason.trim()) e.cannot_reason = t("tickets.validate.cannotReason");
    if (isRepair && !method) e.repair_method = t("tickets.validate.method");
    if (isRepair && method === "external" && !vendor.trim()) e.external_vendor = t("tickets.validate.vendor");
    if (isRepair && !warranty) e.warranty = t("tickets.validate.warranty");
    parts.forEach((p, i) => {
      if (!p.name.trim()) e[`parts.${i}.name`] = t("tickets.validate.partName");
    });
    if (!signature) e.signature = t("signature.required");
    if (Object.keys(e).length) {
      setErrors(e);
      setMessage(t("common.checkInput"));
      return;
    }

    const fd = new FormData();
    fd.set("result", outcome);
    if (outcome === "completed") fd.set("completed_on", completedOn);
    else fd.set("cannot_reason", cannotReason.trim());
    if (isRepair) {
      fd.set("repair_method", method);
      if (method === "external") fd.set("external_vendor", vendor.trim());
      fd.set("warranty", warranty);
    }
    if (details.trim()) fd.set("repair_details", details.trim());
    parts.forEach((p, i) => {
      fd.set(`parts[${i}][name]`, p.name.trim());
      fd.set(`parts[${i}][quantity]`, p.quantity || "1");
      if (p.photo) fd.set(`parts[${i}][photo]`, p.photo);
    });
    photos.forEach((f) => fd.append("photos[]", f));
    fd.set("signature", signature!);

    setMessage("");
    start(async () => {
      const res = await recordResult(ticket.id, fd);
      if (res) {
        setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, v]) => [k, v ?? ""])));
        setMessage(res.message ?? "");
      }
    });
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const radio = (name: string, value: string, checked: boolean, onPick: () => void, label: string) => (
    <label className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${checked ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onPick} className="accent-[var(--accent-500)]" />
      {label}
    </label>
  );

  return (
    <fieldset disabled={pending} className="space-y-5 border-t border-line pt-4 disabled:opacity-60">
      <h3 className="font-semibold">{t("tickets.result.title")}</h3>
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}

      {/* ผลการดำเนินงาน */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          {radio("outcome", "completed", outcome === "completed", () => setOutcome("completed"), t("tickets.result.completed"))}
          {outcome === "completed" && (
            <div className="pl-1">
              <label htmlFor="completed_on" className="mb-1 block text-xs text-muted">
                {t("tickets.result.completedOn")}
              </label>
              <DateInput
                id="completed_on"
                max={localToday()}
                value={completedOn}
                onChange={(d) => {
                  setCompletedOn(d);
                  clearErr("completed_on");
                }}
                className={`${input} ${errors.completed_on ? inputError : ""}`}
              />
              {err("completed_on")}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {radio("outcome", "cannot_complete", outcome === "cannot_complete", () => setOutcome("cannot_complete"), t("tickets.result.cannot"))}
          {outcome === "cannot_complete" && (
            <div className="pl-1">
              <label htmlFor="cannot_reason" className="mb-1 block text-xs text-muted">
                {t("tickets.result.cannotReason")}
              </label>
              <input
                id="cannot_reason"
                value={cannotReason}
                maxLength={2000}
                onChange={(e) => {
                  setCannotReason(e.target.value);
                  clearErr("cannot_reason");
                }}
                className={`${input} ${errors.cannot_reason ? inputError : ""}`}
              />
              {err("cannot_reason")}
            </div>
          )}
        </div>
      </div>

      {isRepair && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">
              {t("tickets.result.method")} <span className="text-red-500">*</span>
            </p>
            <div className="space-y-2">
              {radio("method", "in_house", method === "in_house", () => (setMethod("in_house"), clearErr("repair_method")), t("tickets.result.inHouse"))}
              {radio("method", "external", method === "external", () => (setMethod("external"), clearErr("repair_method")), t("tickets.result.external"))}
              {method === "external" && (
                <input
                  aria-label={t("tickets.result.vendor")}
                  placeholder={t("tickets.result.vendor")}
                  value={vendor}
                  maxLength={255}
                  onChange={(e) => {
                    setVendor(e.target.value);
                    clearErr("external_vendor");
                  }}
                  className={`${input} ${errors.external_vendor ? inputError : ""}`}
                />
              )}
            </div>
            {err("repair_method")}
            {err("external_vendor")}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">
              {t("tickets.result.warranty")} <span className="text-red-500">*</span>
            </p>
            <div className="space-y-2">
              {radio("warranty", "in_warranty", warranty === "in_warranty", () => (setWarranty("in_warranty"), clearErr("warranty")), t("tickets.result.inWarranty"))}
              {radio("warranty", "out_of_warranty", warranty === "out_of_warranty", () => (setWarranty("out_of_warranty"), clearErr("warranty")), t("tickets.result.outOfWarranty"))}
            </div>
            {err("warranty")}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="repair_details" className="mb-1 block text-sm font-medium">
          {t("tickets.result.details")}
        </label>
        <textarea id="repair_details" rows={4} maxLength={5000} value={details} onChange={(e) => setDetails(e.target.value)} className={input} />
      </div>

      {/* อะไหล่ / วัสดุที่เปลี่ยน (รูปละ 1) */}
      <div>
        <p className="mb-2 text-sm font-medium">{t("tickets.result.parts")}</p>
        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 rounded-xl bg-subtle p-2">
              <span className="mt-2 w-5 text-center text-xs text-muted">{i + 1}.</span>
              <div className="min-w-40 flex-1">
                <input
                  aria-label={t("tickets.result.partName")}
                  placeholder={t("tickets.result.partName")}
                  value={p.name}
                  maxLength={255}
                  onChange={(e) => {
                    setParts((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
                    clearErr(`parts.${i}.name`);
                  }}
                  className={`${input} ${errors[`parts.${i}.name`] ? inputError : ""}`}
                />
                {err(`parts.${i}.name`)}
              </div>
              <input
                aria-label={t("tickets.result.qty")}
                type="number"
                min={1}
                max={999}
                value={p.quantity}
                onChange={(e) => setParts((list) => list.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                className={`${input} w-20`}
              />
              <div className="w-28">
                <PhotoPicker
                  files={p.photo ? [p.photo] : []}
                  max={1}
                  onChange={(files) => setParts((list) => list.map((x, j) => (j === i ? { ...x, photo: files[0] ?? null } : x)))}
                  onError={setMessage}
                />
              </div>
              <button
                type="button"
                onClick={() => setParts((list) => list.filter((_, j) => j !== i))}
                aria-label={t("upload.remove")}
                className="mt-1 cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-danger-500"
              >
                <TrashIcon width={15} height={15} />
              </button>
            </div>
          ))}
        </div>
        {parts.length < 10 && (
          <button type="button" onClick={() => setParts((list) => [...list, { name: "", quantity: "1", photo: null }])} className={`${btn.secondary} ${btn.sm} mt-2`}>
            <PlusIcon width={13} height={13} className="text-accent-500" />
            {t("tickets.result.addPart")}
          </button>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t("tickets.result.photos")}</p>
        <PhotoPicker files={photos} onChange={setPhotos} max={4} onError={setMessage} />
        {err("photos")}
      </div>

      <div className="max-w-xl">
        <p className="mb-1 text-sm font-medium">
          {t("signature.label")} — {t("tickets.detail.sigStaff")} <span className="text-red-500">*</span>
        </p>
        <SignaturePad invalid={Boolean(errors.signature)} onChange={(s) => (setSignature(s), s && clearErr("signature"))} />
        {err("signature")}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {pending ? t("common.saving") : t("tickets.result.save")}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
      </div>
    </fieldset>
  );
}
