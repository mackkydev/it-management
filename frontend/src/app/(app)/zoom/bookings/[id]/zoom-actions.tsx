"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { acceptZoomBooking, cancelZoomBooking, removeZoomLink, sendZoomLink, zoomBusy } from "@/app/actions/zoom";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, PencilIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ZoomBooking } from "@/lib/types";
import { parseZoomInvitation, type ZoomMeetingInfo } from "../../zoom-utils";
import { MasterDataSelect } from "@/components/master-data-select";

type Busy = "accept" | "link" | "busy" | "cancel" | "acknowledge" | "remove" | null;

/**
 * ปุ่มของหน้าการจอง ZOOM — ผู้จอง: แก้ไข (ก่อนรับงาน / IT ส่งกลับให้แก้วันเวลา) / ยกเลิก / กดรับ
 * ฝ่าย IT (zoom.manage): รับงาน → วางลิงก์ประชุม + หมายเหตุ แล้วบันทึก (แจ้งผู้จอง + ผู้จัดการ IT ซึ่งอนุมัติที่หน้าใบแจ้งงาน) / แจ้งกลับให้แก้วันเวลา
 *   ผู้จองยกเลิกหลังส่งลิงก์แล้ว → ยืนยัน "ยกเลิกลิงก์ใน ZOOM แล้ว"
 */
export function ZoomActions({ booking: z, accounts = [] }: { booking: ZoomBooking; accounts?: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  // ข้อความเชิญจาก ZOOM ที่วาง → ดึง ลิงก์ (Join Zoom Meeting) / Topic / Meeting ID / Passcode มาใส่ช่อง (แก้เองได้)
  const [invitation, setInvitation] = useState(z.link_note ?? "");
  const [info, setInfo] = useState<ZoomMeetingInfo>({ link: z.meeting_link ?? "", topic: z.meeting_topic ?? "", meeting_id: z.meeting_id ?? "", passcode: z.passcode ?? "" });
  const setField = (k: keyof ZoomMeetingInfo, v: string) => {
    setInfo((x) => ({ ...x, [k]: v }));
    if (k === "link") setErrors((x) => ({ ...x, meeting_link: "" }));
  };
  const paste = (text: string) => {
    setInvitation(text);
    const p = parseZoomInvitation(text);
    // ดึงได้เฉพาะหัวข้อที่พบ — ช่องที่ไม่พบคงค่าเดิม
    setInfo((x) => ({ link: p.link || x.link, topic: p.topic || x.topic, meeting_id: p.meeting_id || x.meeting_id, passcode: p.passcode || x.passcode }));
    if (p.link) setErrors((x) => ({ ...x, meeting_link: "" }));
  };
  const [account, setAccount] = useState(z.zoom_account ?? "");
  const [reason, setReason] = useState("");
  const [showBusy, setShowBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [, start] = useTransition();

  const run = (kind: Exclude<Busy, null>, fn: () => Promise<{ ok?: boolean; message?: string; errors?: Partial<Record<string, string>> }>, done: string) => {
    setBusy(kind);
    setMessage("");
    start(async () => {
      const res = await fn();
      setBusy(null);
      // ฝ่าย IT ส่ง / แก้ลิงก์สำเร็จ = กลับหน้ารวมคำขอ (แท็บส่งลิงก์แล้ว) — ปุ่มอื่นอยู่หน้าเดิม
      if (res.ok) return router.push(kind === "link" ? `/zoom/manage?status=confirmed&done=${done}` : `/zoom/bookings/${z.id}?done=${done}`);
      setErrors(Object.fromEntries(Object.entries(res.errors ?? {}).map(([k, v]) => [k, v ?? ""])));
      setMessage(res.message ?? t("common.saveFailed"));
    });
  };

  const accept = () => run("accept", () => acceptZoomBooking(z.id), "accepted");
  const saveLink = () => {
    const found = { ...(account ? {} : { zoom_account: t("zoom.validate.account") }), ...(/^https?:\/\/\S+$/i.test(info.link.trim()) ? {} : { meeting_link: t("zoom.validate.link") }) };
    if (Object.keys(found).length) return setErrors(found);
    run("link", () => sendZoomLink(z.id, { ...info, account, invitation }), z.status === "confirmed" ? "link_updated" : "linked");
  };
  const reply = async () => {
    if (!(await confirm(t("zoom.actions.busyConfirm")))) return;
    run("busy", () => zoomBusy(z.id, reason), "busy");
  };
  const removeLink = async () => {
    if (!(await confirm(t("zoom.actions.removeLinkConfirm")))) return;
    run("remove", () => removeZoomLink(z.id), "link_removed");
  };
  const cancel = async () => {
    if (!(await confirm(t("zoom.actions.cancelConfirm")))) return;
    run("cancel", () => cancelZoomBooking(z.id), "cancelled");
  };

  // กดรับ (ผู้จอง) อยู่ที่กล่องลิงก์ประชุม (CopyShare)
  const owner = z.can_edit || z.can_cancel;
  const it = z.can_accept || z.can_link || z.can_busy || z.can_remove_link;
  if (!owner && !it) return null;
  const spin = (k: Busy, icon: ReactNode) => (busy === k ? <SpinnerIcon width={14} height={14} /> : icon);

  return (
    <section className={`space-y-4 p-4 sm:p-5 ${card}`}>
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}

      {/* ฝ่าย IT */}
      {it && (
        <div className="space-y-4">
          <h2 className="font-semibold">{t("zoom.actions.itTitle")}</h2>
          {z.can_remove_link && (
            <div className="space-y-3 rounded-xl p-3 ring-1 ring-warning-200 dark:ring-warning-400/30">
              <p className="flex items-start gap-2 text-sm font-medium text-warning-700 dark:text-warning-300">
                <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
                {t("zoom.actions.removeLinkTitle")}
              </p>
              <dl className="grid grid-cols-1 gap-2 rounded-lg bg-subtle px-3 py-2.5 text-sm sm:grid-cols-3">
                {z.zoom_account && (
                  <div>
                    <dt className="text-xs text-muted">{t("zoom.actions.account")}</dt>
                    <dd className="font-medium">{z.zoom_account}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted">{t("zoom.actions.meetingId")}</dt>
                  <dd className="font-medium">{z.meeting_id || "-"}</dd>
                </div>
                <div className="sm:col-span-3">
                  <dt className="text-xs text-muted">{t("zoom.actions.link")}</dt>
                  <dd className="break-all font-medium">{z.meeting_link}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={removeLink} disabled={busy !== null} className={btn.primary}>
                  {spin("remove", <CheckCircleIcon width={16} height={16} />)}
                  {t("zoom.actions.removeLink")}
                </button>
                <p className="text-xs text-muted">{t("zoom.actions.removeLinkHint")}</p>
              </div>
            </div>
          )}
          {z.can_accept && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={accept} disabled={busy !== null} className={btn.primary}>
                {spin("accept", <CheckCircleIcon width={16} height={16} />)}
                {t("zoom.actions.accept")}
              </button>
              <p className="text-xs text-muted">{t("zoom.actions.acceptHint")}</p>
            </div>
          )}
          {z.can_link && (
            <div className="space-y-3 rounded-xl p-3 ring-1 ring-line">
              <div>
                <label htmlFor="zoom_account" className="mb-1 block text-sm font-medium">
                  {t("zoom.actions.account")} <span className="text-red-500">*</span>
                </label>
                <MasterDataSelect source="zoom_account">
                  <AppSelect
                    id="zoom_account"
                    value={account}
                    onValueChange={(x) => {
                      setAccount(x);
                      setErrors((e) => ({ ...e, zoom_account: "" }));
                    }}
                    className={`${input} ${errors.zoom_account ? inputError : ""}`}
                  >
                    <option value="">{t("zoom.actions.accountPlaceholder")}</option>
                    {[...new Set([...accounts, ...(z.zoom_account ? [z.zoom_account] : [])])].map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </AppSelect>
                </MasterDataSelect>
                {errors.zoom_account && <p className="mt-1 text-xs font-medium text-red-500">{errors.zoom_account}</p>}
              </div>
              <div>
                <label htmlFor="invitation" className="mb-1 block text-sm font-medium">
                  {t("zoom.actions.invitation")}
                </label>
                <textarea
                  id="invitation"
                  rows={5}
                  maxLength={5000}
                  value={invitation}
                  onChange={(e) => paste(e.target.value)}
                  placeholder={t("zoom.actions.invitationPlaceholder")}
                  className={`${input} font-mono text-xs`}
                />
                <p className="mt-1 text-xs text-muted">{t("zoom.actions.invitationHint")}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="meeting_link" className="mb-1 block text-sm font-medium">
                    {t("zoom.actions.link")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="meeting_link"
                    type="url"
                    inputMode="url"
                    maxLength={1000}
                    value={info.link}
                    onChange={(e) => setField("link", e.target.value)}
                    placeholder="https://zoom.us/j/…"
                    className={`${input} ${errors.meeting_link ? inputError : ""}`}
                  />
                  {errors.meeting_link && <p className="mt-1 text-xs font-medium text-red-500">{errors.meeting_link}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="meeting_topic" className="mb-1 block text-sm font-medium">
                    {t("zoom.actions.topic")}
                  </label>
                  <input id="meeting_topic" maxLength={255} value={info.topic} onChange={(e) => setField("topic", e.target.value)} placeholder={z.title} className={input} />
                </div>
                <div>
                  <label htmlFor="meeting_id" className="mb-1 block text-sm font-medium">
                    {t("zoom.actions.meetingId")}
                  </label>
                  <input id="meeting_id" maxLength={50} value={info.meeting_id} onChange={(e) => setField("meeting_id", e.target.value)} className={input} />
                </div>
                <div>
                  <label htmlFor="passcode" className="mb-1 block text-sm font-medium">
                    {t("zoom.actions.passcode")}
                  </label>
                  <input id="passcode" maxLength={50} value={info.passcode} onChange={(e) => setField("passcode", e.target.value)} className={input} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={saveLink} disabled={busy !== null} className={btn.primary}>
                  {spin("link", <SendIcon width={16} height={16} />)}
                  {z.status === "confirmed" ? t("zoom.actions.updateLink") : t("zoom.actions.sendLink")}
                </button>
                {z.status !== "confirmed" && <p className="text-xs text-muted">{t("zoom.actions.sendLinkHint")}</p>}
              </div>
            </div>
          )}
          {z.can_busy && (
            <div className="space-y-2">
              {!showBusy ? (
                <button type="button" onClick={() => setShowBusy(true)} disabled={busy !== null} className={btn.danger}>
                  <AlertIcon width={16} height={16} />
                  {t("zoom.actions.busy")}
                </button>
              ) : (
                <div className="space-y-2 rounded-xl p-3 ring-1 ring-danger-200 dark:ring-danger-400/30">
                  <label htmlFor="busy_reason" className="block text-sm font-medium">
                    {t("zoom.actions.busyReason")}
                  </label>
                  <textarea id="busy_reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("zoom.actions.busyPlaceholder")} className={input} />
                  <div className="flex gap-2">
                    <button type="button" onClick={reply} disabled={busy !== null} className={btn.danger}>
                      {spin("busy", <SendIcon width={16} height={16} />)}
                      {t("zoom.actions.busySend")}
                    </button>
                    <button type="button" onClick={() => setShowBusy(false)} disabled={busy !== null} className={btn.secondary}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ผู้จอง */}
      {owner && (
        <div className={`flex flex-wrap items-center gap-2 ${it ? "border-t border-line pt-4" : ""}`}>
          {z.can_edit && (
            <Link href={`/zoom/bookings/${z.id}/edit`} className={z.status === "needs_change" ? btn.primary : btn.soft}>
              <PencilIcon width={16} height={16} />
              {z.status === "needs_change" ? t("zoom.actions.changeTime") : t("zoom.actions.edit")}
            </Link>
          )}
          {z.can_cancel && (
            <button type="button" onClick={cancel} disabled={busy !== null} className={btn.secondary}>
              {spin("cancel", <XIcon width={16} height={16} />)}
              {t("zoom.actions.cancel")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
