"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { deleteTicket, recordProgress, recordResult, requestCancel, ticketAction, type TicketResult } from "@/app/actions/tickets";
import { DateInput } from "@/components/date-input";
import { DocumentPicker, EVENT_FILE_ACCEPT, EVENT_FILE_MAX_BYTES, EVENT_FILES_MAX, PhotoPicker } from "@/components/file-pickers";
import { AppSelect } from "@/components/app-select";
import {
  AlertIcon,
  ArrowRightIcon,
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
import { Tooltip } from "@/components/tooltip";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { HelperPicker } from "./helpers-card";
import { OnsiteFields, type OnsiteValue } from "./onsite-card";
import { localToday } from "@/lib/date";
import type { TicketAction, TicketDetail } from "@/lib/types";
import { useConfirm } from "@/components/dialog-provider";

const ICONS: Record<TicketAction, ReactNode> = {
  approve: <CheckCircleIcon />,
  reject: <XIcon />,
  accept: <InboxIcon />,
  request_approval: <CheckCircleIcon />,
  forward: <ArrowRightIcon />,
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
const DANGER: TicketAction[] = ["request_approval", "reject", "return", "delete", "cancel_request", "cancel_confirm"];

/** ปุ่มการทำงานตามสิทธิ์และสถานะ (มาจาก API: ticket.actions) */
/** canSaveSignature = ผู้ใช้ยังไม่มีลายเซ็นในโปรไฟล์ → ช่องเซ็นมีปุ่ม "บันทึกเป็นลายเซ็นของฉัน" */
export function TicketActions({ ticket, canSaveSignature = false }: { ticket: TicketDetail; canSaveSignature?: boolean }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [active, setActive] = useState<TicketAction | null>(ticket.actions.includes("result") ? null : null);

  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const style = (a: TicketAction) => (DANGER.includes(a) ? btn.danger : a === "result" || a === "progress" || a === "edit" || a === "forward" ? btn.soft : btn.primary);
  // รับงานแทนผู้ที่ผู้แจ้งเลือกไว้ (คิวงาน IT) — ปุ่มบอกชื่อคนเดิม
  const label = (a: TicketAction) => (a === "accept" && ticket.take_over_from ? t("tickets.actions.takeOver", { name: ticket.take_over_from }) : t(`tickets.actions.${a}`));

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
              {label(a)}
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
        <ResultForm ticket={ticket} canSaveSignature={canSaveSignature} onCancel={() => setActive(null)} />
      ) : active && !INSTANT.includes(active) ? (
        <SimpleActionForm ticket={ticket} action={active as FormAction} canSaveSignature={canSaveSignature} onCancel={() => setActive(null)} />
      ) : null}
    </div>
  );
}

type FormAction = Exclude<TicketAction, "result" | "edit" | "delete" | "cancel_withdraw">;

/** อนุมัติ / ไม่อนุมัติ / รับงาน / ความคืบหน้า / อนุมัติผล (ลงลายเซ็น) / ส่งกลับ / ผู้แจ้งรับงาน / ขอยกเลิก / ยืนยัน-ปฏิเสธการยกเลิก */
function SimpleActionForm({ ticket, action, canSaveSignature, onCancel }: { ticket: TicketDetail; action: FormAction; canSaveSignature: boolean; onCancel: () => void }) {
  const { t, fmt } = useI18n();
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  // รับงาน: ติ๊กบันทึกลงปฏิทิน = ช่วงวันไปทำงานหน้างาน
  const [onsiteOn, setOnsiteOn] = useState(false);
  const [onsite, setOnsite] = useState<OnsiteValue>({
    start_on: localToday(),
    end_on: localToday(),
    note: "",
  });
  // รับงาน: ผู้ร่วมดำเนินการ (ทำงานมากกว่า 1 คน)
  const [helpersOn, setHelpersOn] = useState(false);
  const [helperIds, setHelperIds] = useState<number[]>([]);
  // โอนงาน: เจ้าหน้าที่ IT ที่รับงานต่อ
  const [forwardTo, setForwardTo] = useState("");
  // อัปเดตความคืบหน้า: ไฟล์/รูปประกอบ (เช่น ใบเสนอราคา ใบ PO)
  const [files, setFiles] = useState<File[]>([]);
  // อัปเดตความคืบหน้า: อ้างรายการส่งซ่อม → เติมข้อความแจ้งผู้แจ้งว่าส่งซ่อม (ไม่ทับที่พิมพ์เอง)
  const repairOrders = action === "progress" ? (ticket.repair_order_options ?? []) : [];
  const [repairOrderId, setRepairOrderId] = useState("");
  const [filledComment, setFilledComment] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const pickRepairOrder = (id: string) => {
    setRepairOrderId(id);
    setError("");
    const o = repairOrders.find((x) => x.id === id);
    const text = o
      ? [
          t("tickets.actions.progressRepairSent", { item: o.item_name, vendor: o.vendor, date: `${fmt.date(o.sent_on)} ${o.sent_time}`, doc: o.document_no ? ` (${o.document_no})` : "" }),
          t("tickets.result.repairOrderSymptom", { symptom: o.symptom }),
          o.status === "returned" && o.returned_at ? t("tickets.actions.progressRepairReturned", { vendor: o.vendor, date: fmt.date(o.returned_at) }) : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
    if (!comment.trim() || comment === filledComment) {
      setComment(text);
      setFilledComment(text);
    }
  };
  const commentRequired = action === "reject" || action === "request_approval" || action === "return" || action === "progress" || action === "cancel_request" || action === "cancel_reject";
  const needsSignature = action === "close";

  const progressForm = () => {
    const fd = new FormData();
    fd.set("comment", comment.trim());
    if (repairOrderId) fd.set("repair_order_id", repairOrderId);
    files.forEach((f) => fd.append("files[]", f));
    return fd;
  };

  const submit = () => {
    if (commentRequired && !comment.trim()) return setError(t("tickets.actions.commentRequired"));
    if (needsSignature && !signature) return setError(t("signature.required"));
    if (action === "accept" && onsiteOn && (!onsite.start_on || !onsite.end_on)) return setError(t("calendar.onsiteRequired"));
    if (action === "forward" && !forwardTo) return setError(t("tickets.actions.forwardRequired"));
    setError("");
    start(async () => {
      const res: TicketResult | undefined =
        action === "cancel_request"
          ? await requestCancel(ticket.id, comment)
          : action === "progress"
            ? await recordProgress(ticket.id, progressForm())
            : await ticketAction(ticket.id, action, {
                comment,
                signature,
                calendar: action === "accept" && onsiteOn ? onsite : null,
                helper_ids: action === "accept" && helpersOn ? helperIds : [],
                assignee_id: action === "forward" ? Number(forwardTo) : null,
              });
      if (res) setError(res.errors ? (Object.values(res.errors)[0] ?? res.message ?? "") : (res.message ?? ""));
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
      {action === "forward" && (
        <div className="space-y-1">
          <label htmlFor="forward-to" className="mb-1 block text-sm font-medium">
            {t("tickets.actions.forwardTo")} <span className="text-red-500">*</span>
          </label>
          <AppSelect id="forward-to" value={forwardTo} onValueChange={(v) => (setForwardTo(v), setError(""))} className={`${input} ${error && !forwardTo ? inputError : ""}`}>
            <option value="">{t("tickets.actions.forwardChoose")}</option>
            {(ticket.forward_options ?? []).map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.busy ? `${o.name} (${t(o.busy === "leave" ? "tickets.actions.busyLeave" : "tickets.actions.busyOnsite")})` : o.name}
              </option>
            ))}
          </AppSelect>
          <p className="text-xs text-muted">{t("tickets.actions.forwardHint")}</p>
        </div>
      )}
      {action === "accept" && ticket.take_over_from && (
        <p className={alert.warning}>
          <AlertIcon className="shrink-0" />
          {t("tickets.actions.takeOverHint", { name: ticket.take_over_from })}
        </p>
      )}
      {repairOrders.length > 0 && (
        <div>
          <label htmlFor="progress-repair-order" className="mb-1 block text-sm font-medium">
            {t("tickets.actions.progressRepairOrder")}
          </label>
          <AppSelect id="progress-repair-order" value={repairOrderId} onValueChange={pickRepairOrder} className={input}>
            <option value="">{t("tickets.actions.progressRepairOrderNone")}</option>
            {repairOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {t("tickets.result.repairOrderOption", {
                  vendor: o.vendor,
                  date: fmt.date(o.sent_on),
                  doc: o.document_no ? ` · ${o.document_no}` : "",
                  status: t(o.status === "returned" ? "tickets.result.repairOrderReturned" : "tickets.result.repairOrderSent"),
                })}
              </option>
            ))}
          </AppSelect>
          <p className="mt-1 text-xs text-muted">{t("tickets.actions.progressRepairOrderHint")}</p>
        </div>
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
          {action === "approve" && (
            // ข้อความด่วนตอนอนุมัติ — กดแล้วต่อท้ายความเห็น (แก้ต่อได้)
            <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("tickets.actions.quickPhrases")}>
              <span className="text-xs text-muted">{t("tickets.actions.quickPhrases")}:</span>
              {(["quickApprove1", "quickApprove2", "quickApprove3"] as const).map((key) => {
                const phrase = t(`tickets.actions.${key}`);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setComment((c) => (c.trim() ? `${c.trimEnd()} ${phrase}` : phrase));
                      setError("");
                    }}
                    className="cursor-pointer rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700 ring-1 ring-accent-200 hover:bg-accent-100 dark:bg-accent-400/10 dark:text-accent-300 dark:ring-accent-400/30 dark:hover:bg-accent-400/20"
                  >
                    {phrase}
                  </button>
                );
              })}
            </div>
          )}
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
      {action === "progress" && (
        <div>
          <p className="mb-1 text-sm font-medium">{t("tickets.actions.progressFiles")}</p>
          <DocumentPicker
            files={files}
            onChange={(f) => (setFiles(f), setError(""))}
            max={EVENT_FILES_MAX}
            maxBytes={EVENT_FILE_MAX_BYTES}
            accept={EVENT_FILE_ACCEPT}
            hint={t("upload.eventFileHint", { max: EVENT_FILES_MAX })}
            onError={setError}
          />
        </div>
      )}
      {action === "accept" && (
        // ตัวเลือกตอนรับงาน: แถวเดียวกัน 2 คอลัมน์ (3 ตัวเลือก = 3 คอลัมน์, เกินขึ้นบรรทัดใหม่) — จอเล็กเรียงลงทีละอัน
        <div
          className={`grid grid-cols-1 items-start gap-3 ${
            (ticket.helper_options?.length ?? 0) > 0 ? "md:grid-cols-2" : ""
          }`}
        >
        <div className="space-y-2 rounded-xl p-3 ring-1 ring-line">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={onsiteOn} onChange={(e) => setOnsiteOn(e.target.checked)} className="h-4 w-4 accent-[var(--accent-500)]" />
            {t("calendar.onsiteAccept")}
          </label>
          {onsiteOn ? <OnsiteFields value={onsite} onChange={setOnsite} /> : <p className="text-xs text-muted">{t("calendar.onsiteHint")}</p>}
        </div>
      {(ticket.helper_options?.length ?? 0) > 0 && (
        <div className="space-y-2 rounded-xl p-3 ring-1 ring-line">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={helpersOn} onChange={(e) => setHelpersOn(e.target.checked)} className="h-4 w-4 accent-[var(--accent-500)]" />
            {t("ticketHelpers.label")}
          </label>
          {helpersOn && <HelperPicker options={ticket.helper_options ?? []} value={helperIds} onChange={setHelperIds} />}
          <p className="text-xs text-muted">{t("ticketHelpers.hint")}</p>
        </div>
      )}
        </div>
      )}
      {needsSignature && (
        <div className="max-w-xl">
          <p className="mb-1 text-sm font-medium">
            {t("signature.label")} — {t("tickets.detail.sigItHead")} <span className="text-red-500">*</span>
          </p>
          <SignaturePad invalid={Boolean(error) && !signature} onChange={setSignature} saveToProfile={canSaveSignature} />
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
function ResultForm({ ticket, canSaveSignature, onCancel }: { ticket: TicketDetail; canSaveSignature: boolean; onCancel: () => void }) {
  const { t, fmt } = useI18n();
  const isRepair = ticket.type === "repair";
  const [outcome, setOutcome] = useState<"completed" | "cannot_complete">(ticket.result ?? "completed");
  const [completedOn, setCompletedOn] = useState(ticket.completed_on ?? localToday());
  // งานหลายวัน: ตั้งต้นตามที่บันทึกไว้ หรือช่วงออกหน้างานหลายวันในปฏิทิน (ออกต่างจังหวัด = นับทุกวัน)
  const onsite = ticket.calendar_event ?? null;
  const onsiteMulti = Boolean(onsite?.start_on && onsite.end_on && onsite.start_on < onsite.end_on);
  const [multiDay, setMultiDay] = useState(Boolean(ticket.work_start_on) || onsiteMulti);
  const [workStartOn, setWorkStartOn] = useState(ticket.work_start_on ?? (onsiteMulti ? onsite!.start_on! : ticket.accepted_at ? localToday(new Date(ticket.accepted_at)) : localToday()));
  const [skipOffDays, setSkipOffDays] = useState(ticket.work_start_on ? ticket.work_skip_off_days : !onsiteMulti);
  const [cannotReason, setCannotReason] = useState(ticket.cannot_reason ?? "");
  // ไม่สามารถดำเนินการได้เพราะผู้แจ้งยกเลิก = ไม่ต้องระบุสาเหตุ
  const [requesterCancelled, setRequesterCancelled] = useState(false);
  // เลือก "ไม่สามารถดำเนินการได้" / เอาติ๊กผู้แจ้งยกเลิกออก → โฟกัสช่องสาเหตุ (autoFocus ตอนช่องปรากฏ)
  const [focusReason, setFocusReason] = useState(false);
  const [documents, setDocuments] = useState<File[]>([]);
  // ซ่อมโดยช่างภายนอก: เลือกจากรายการส่งซ่อม/เคลม → เติมชื่อบริษัท + รายละเอียดการซ่อม + อะไหล่ที่ร้านเปลี่ยน (แก้ต่อได้)
  const repairOrders = ticket.repair_order_options ?? [];
  type RepairOption = (typeof repairOrders)[number];
  const detailsOf = (o: RepairOption) =>
    [
      t("tickets.result.repairOrderDetails", { vendor: o.vendor, date: `${fmt.date(o.sent_on)} ${o.sent_time}`, doc: o.document_no ? ` (${o.document_no})` : "" }),
      t("tickets.result.repairOrderSymptom", { symptom: o.symptom }),
      o.return_note ? t("tickets.result.repairOrderResult", { date: o.returned_at ? fmt.date(o.returned_at) : "-", note: o.return_note }) : "",
    ]
      .filter(Boolean)
      .join("\n");
  const partsOf = (o: RepairOption): Part[] => (o.parts ?? []).map((p) => ({ name: p.name, quantity: String(p.quantity), photo: null }));
  // ใบนี้มีการส่งซ่อมภายนอก (1.2) และยังไม่เคยบันทึกลักษณะงานซ่อม → ตั้งต้นเป็นช่างภายนอก + เลือกรายการล่าสุดของใบนี้ให้
  const [autoOrder] = useState(() => (isRepair && !ticket.repair_method ? repairOrders.find((o) => o.own) : undefined));
  const [method, setMethod] = useState<"in_house" | "external" | "">(ticket.repair_method ?? (autoOrder ? "external" : ""));
  const [vendor, setVendor] = useState(ticket.external_vendor ?? autoOrder?.vendor ?? "");
  const [repairOrderId, setRepairOrderId] = useState(autoOrder?.id ?? "");
  const [filledDetails, setFilledDetails] = useState(() => (autoOrder && !ticket.repair_details ? detailsOf(autoOrder) : ""));
  const [warranty, setWarranty] = useState<"in_warranty" | "out_of_warranty" | "">(ticket.warranty ?? "");
  const [details, setDetails] = useState(() => ticket.repair_details ?? (autoOrder ? detailsOf(autoOrder) : ""));
  const [parts, setParts] = useState<Part[]>(() =>
    ticket.parts.length
      ? ticket.parts.map((p) => ({
          name: p.name,
          quantity: String(p.quantity),
          photo: null,
        }))
      : autoOrder
        ? partsOf(autoOrder)
        : [],
  );
  // อะไหล่ที่เติมจากรายการส่งซ่อมครั้งล่าสุด — เลือกรายการใหม่แทนได้ถ้ายังไม่แก้รายการอะไหล่
  const [filledParts, setFilledParts] = useState<Part[] | null>(() => (!ticket.parts.length && autoOrder ? parts : null));
  const selectedOrder = method === "external" ? repairOrders.find((o) => o.id === repairOrderId) : undefined;
  const [photos, setPhotos] = useState<File[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const clearErr = (k: string) => setErrors((e) => ({ ...e, [k]: "" }));
  const done = outcome === "completed";

  // เลือกรายการส่งซ่อม/เคลม → ชื่อบริษัท = Vendor, รายละเอียดการซ่อม = ส่งที่ไหน/เมื่อไร + อาการ + ผลรับคืน
  // (ไม่ทับรายละเอียดที่พิมพ์เอง — แทนเฉพาะเมื่อยังว่างหรือยังเป็นข้อความที่เติมให้ครั้งก่อน)
  const pickRepairOrder = (id: string) => {
    setRepairOrderId(id);
    const o = repairOrders.find((x) => x.id === id);
    if (!o) return;
    setVendor(o.vendor);
    clearErr("external_vendor");
    const text = detailsOf(o);
    if (!details.trim() || details === filledDetails) {
      setDetails(text);
      setFilledDetails(text);
    }
    // อะไหล่จากการรับคืน: แทนเฉพาะเมื่อรายการอะไหล่ยังว่าง หรือยังเป็นชุดที่เติมให้ครั้งก่อน
    if (!parts.length || parts === filledParts) {
      const next = partsOf(o);
      setParts(next);
      setFilledParts(next);
    }
  };
  // ผู้แจ้งงานยกเลิก = ไม่มีสาเหตุ/เอกสารประกอบให้กรอก
  const cancelledByRequester = !done && requesterCancelled;

  // เลือก "ไม่สามารถดำเนินการได้" → เลื่อนไปที่ช่องสาเหตุ
  const pickCannot = () => {
    setOutcome("cannot_complete");
    setFocusReason(true);
  };

  const submit = () => {
    const e: Record<string, string> = {};
    if (outcome === "completed" && !completedOn) e.completed_on = t("tickets.validate.completedOn");
    if (outcome === "completed" && multiDay) {
      if (!workStartOn) e.work_start_on = t("tickets.validate.workStartOn");
      else if (completedOn && workStartOn >= completedOn) e.work_start_on = t("tickets.validate.workStartAfter");
    }
    if (!done && !requesterCancelled && !cannotReason.trim()) e.cannot_reason = t("tickets.validate.cannotReason");
    // ข้อมูลการซ่อม/อะไหล่ ใช้เฉพาะเมื่อทำสำเร็จ
    if (done && isRepair && !method) e.repair_method = t("tickets.validate.method");
    if (done && isRepair && method === "external" && !vendor.trim()) e.external_vendor = t("tickets.validate.vendor");
    if (done && isRepair && !warranty) e.warranty = t("tickets.validate.warranty");
    if (done) {
      parts.forEach((p, i) => {
        if (!p.name.trim()) e[`parts.${i}.name`] = t("tickets.validate.partName");
      });
    }
    if (!signature) e.signature = t("signature.required");
    // ของที่ส่งซ่อมภายนอกจากใบนี้ยังไม่รับคืน = บันทึกผลไม่ได้ — เลือกรายการนั้นให้เห็น (กรอบแดง)
    const outOrder = repairOrders.find((o) => o.own && o.status === "sent");
    if (outOrder) {
      e.repair_order = t("tickets.validate.repairNotReturned", { vendor: outOrder.vendor });
      if (done && isRepair) {
        setMethod("external");
        setRepairOrderId(outOrder.id);
      }
    }
    if (Object.keys(e).length) {
      setErrors(e);
      setMessage(e.repair_order ?? t("common.checkInput"));
      return;
    }

    const fd = new FormData();
    fd.set("result", outcome);
    if (outcome === "completed") {
      fd.set("completed_on", completedOn);
      if (multiDay) {
        fd.set("work_start_on", workStartOn);
        fd.set("work_skip_off_days", skipOffDays ? "1" : "0");
      }
    } else if (requesterCancelled) fd.set("requester_cancelled", "1");
    else fd.set("cannot_reason", cannotReason.trim());
    if (done) {
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
    }
    if (!cancelledByRequester) documents.forEach((f) => fd.append("documents[]", f));
    fd.set("signature", signature!);

    setMessage("");
    start(async () => {
      const res = await recordResult(ticket.id, fd);
      if (res) {
        const errs = Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, v]) => [k, v ?? ""]));
        const docErr = Object.entries(errs).find(([k]) => k.startsWith("documents."));
        if (docErr) errs.documents = docErr[1];
        setErrors(errs);
        setMessage(errs.repair_order || (res.message ?? ""));
      }
    });
  };

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const radio = (name: string, value: string, checked: boolean, onPick: () => void, label: string) => (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${checked ? "bg-accent-50 ring-accent-300 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"}`}
    >
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
              {/* งานหลายวัน → ชีต KPI แยกแถวรายวัน (หลังอนุมัติผล) */}
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={multiDay}
                  onChange={(e) => {
                    setMultiDay(e.target.checked);
                    clearErr("work_start_on");
                  }}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                />
                <span>
                  {t("tickets.result.multiDay")}
                  <span className="block text-xs text-muted">{t("tickets.result.multiDayHint")}</span>
                </span>
              </label>
              {multiDay && (
                <div className="mt-2 space-y-2 border-l-2 border-accent-200 pl-3 dark:border-accent-400/30">
                  <div>
                    <label htmlFor="work_start_on" className="mb-1 block text-xs text-muted">
                      {t("tickets.result.workStartOn")}
                    </label>
                    <DateInput
                      id="work_start_on"
                      max={completedOn || localToday()}
                      value={workStartOn}
                      onChange={(d) => {
                        setWorkStartOn(d);
                        clearErr("work_start_on");
                      }}
                      className={`${input} ${errors.work_start_on ? inputError : ""}`}
                    />
                    {err("work_start_on")}
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={skipOffDays} onChange={(e) => setSkipOffDays(e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
                    {t("tickets.result.skipOffDays")}
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {radio("outcome", "cannot_complete", outcome === "cannot_complete", pickCannot, t("tickets.result.cannot"))}
          {!done && (
            <div className="space-y-2 pl-1">
              {!requesterCancelled && (
                <div>
                  <label htmlFor="cannot_reason" className="mb-1 block text-xs text-muted">
                    {t("tickets.result.cannotReason")} <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="cannot_reason"
                    autoFocus={focusReason}
                    rows={3}
                    required
                    aria-invalid={Boolean(errors.cannot_reason)}
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
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requesterCancelled}
                  onChange={(e) => {
                    setRequesterCancelled(e.target.checked);
                    clearErr("cannot_reason");
                    setFocusReason(true);
                  }}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                />
                <span>
                  {t("tickets.result.requesterCancelled")}
                  {requesterCancelled && <span className="block text-xs text-muted">{t("tickets.result.requesterCancelledHint")}</span>}
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* ส่วนการซ่อม / อะไหล่ / รูปหลังซ่อม — เฉพาะเมื่อดำเนินการสำเร็จ */}
      {done && (
        <>
          {isRepair && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">
                  {t("tickets.result.method")} <span className="text-red-500">*</span>
                </p>
                <div className="space-y-2">
                  {radio("method", "in_house", method === "in_house", () => (setMethod("in_house"), clearErr("repair_method")), t("tickets.result.inHouse"))}
                  {radio("method", "external", method === "external", () => (setMethod("external"), clearErr("repair_method")), t("tickets.result.external"))}
                  {method === "external" && repairOrders.length > 0 && (
                    <AppSelect
                      aria-label={t("tickets.result.fromRepairOrder")}
                      value={repairOrderId}
                      onValueChange={pickRepairOrder}
                      className={`${input} ${errors.repair_order ? inputError : ""}`}
                    >
                      <option value="">{t("tickets.result.chooseRepairOrder")}</option>
                      {repairOrders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {t("tickets.result.repairOrderOption", {
                            vendor: o.vendor,
                            date: fmt.date(o.sent_on),
                            doc: o.document_no ? ` · ${o.document_no}` : "",
                            status: t(o.status === "returned" ? "tickets.result.repairOrderReturned" : "tickets.result.repairOrderSent"),
                          })}
                        </option>
                      ))}
                    </AppSelect>
                  )}
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
                      className={`${input} ${errors.external_vendor || errors.repair_order ? inputError : ""}`}
                    />
                  )}
                </div>
                {err("repair_order")}
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

          {isRepair && selectedOrder && (
            <div className="space-y-2 rounded-xl bg-subtle p-3 text-sm ring-1 ring-line">
              {autoOrder?.id === selectedOrder.id && (
                <p className="flex items-start gap-1.5 text-xs text-info-700 dark:text-info-300">
                  <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
                  {t("tickets.result.repairOrderAuto")}
                </p>
              )}
              <p className="font-medium">{t("tickets.result.repairOrderInfo")}</p>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">{t("tickets.result.vendor")}</dt>
                <dd>{selectedOrder.vendor}</dd>
                <dt className="text-muted">{t("tickets.result.repairOrderSentOn")}</dt>
                <dd>
                  {fmt.date(selectedOrder.sent_on)} {selectedOrder.sent_time}
                  {selectedOrder.document_no ? ` · ${selectedOrder.document_no}` : ""} ·{" "}
                  {t(selectedOrder.status === "returned" ? "tickets.result.repairOrderReturned" : "tickets.result.repairOrderSent")}
                </dd>
                <dt className="text-muted">{t("repairOrders.form.symptom")}</dt>
                <dd className="whitespace-pre-line">{selectedOrder.symptom}</dd>
                {selectedOrder.return_note && (
                  <>
                    <dt className="text-muted">{t("repairOrders.return.note")}</dt>
                    <dd className="whitespace-pre-line">{selectedOrder.return_note}</dd>
                  </>
                )}
                {(selectedOrder.parts ?? []).length > 0 && (
                  <>
                    <dt className="text-muted">{t("repairOrders.return.parts")}</dt>
                    <dd>
                      {(selectedOrder.parts ?? []).map((p) => `${p.name} × ${p.quantity}`).join(", ")}
                      {parts === filledParts && <span className="block text-xs text-muted">{t("tickets.result.repairOrderPartsFilled", { n: (selectedOrder.parts ?? []).length })}</span>}
                    </dd>
                  </>
                )}
              </dl>
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
            {/* การ์ดอะไหล่ แถวละ 3 (จอกลาง 2 / มือถือ 1) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parts.map((p, i) => (
                <div key={i} className="min-w-0 space-y-2 rounded-xl bg-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted">
                      {t("tickets.result.partName")} {i + 1}
                    </span>
                    <Tooltip label={t("upload.remove")}>
                      <button
                        type="button"
                        onClick={() => setParts((list) => list.filter((_, j) => j !== i))}
                        aria-label={t("upload.remove")}
                        className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-danger-500"
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    </Tooltip>
                  </div>
                  <div>
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
                  <div className="flex items-start gap-3">
                    <label className="w-20 shrink-0 text-xs text-muted">
                      {t("tickets.result.qty")}
                      <input
                        aria-label={t("tickets.result.qty")}
                        type="number"
                        min={1}
                        max={999}
                        value={p.quantity}
                        onChange={(e) => setParts((list) => list.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                        className={`${input} mt-1 text-center`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <PhotoPicker
                        files={p.photo ? [p.photo] : []}
                        max={1}
                        onChange={(files) => setParts((list) => list.map((x, j) => (j === i ? { ...x, photo: files[0] ?? null } : x)))}
                        onError={setMessage}
                      />
                    </div>
                  </div>
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
        </>
      )}

      {/* เอกสารประกอบ (หลายไฟล์ ไฟล์ละ ≤ 1MB) — กดดูย้อนหลังได้ที่รายการ "บันทึกผล" ในประวัติ; ผู้แจ้งงานยกเลิก = ไม่แสดง */}
      {!cancelledByRequester && (
        <div>
          <p className="mb-2 text-sm font-medium">{t("tickets.result.documents")}</p>
          <DocumentPicker
            files={documents}
            onChange={(f) => (setDocuments(f), clearErr("documents"))}
            max={EVENT_FILES_MAX}
            maxBytes={EVENT_FILE_MAX_BYTES}
            accept={EVENT_FILE_ACCEPT}
            hint={t("upload.eventFileHint", { max: EVENT_FILES_MAX })}
            onError={setMessage}
          />
          {err("documents")}
        </div>
      )}

      <div className="max-w-xl">
        <p className="mb-1 text-sm font-medium">
          {t("signature.label")} — {t("tickets.detail.sigStaff")} <span className="text-red-500">*</span>
        </p>
        <SignaturePad invalid={Boolean(errors.signature)} onChange={(s) => (setSignature(s), s && clearErr("signature"))} saveToProfile={canSaveSignature} />
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
