"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { loadLoanDevices, loanAction, loanStep } from "@/app/actions/loans";
import { AppSelect } from "@/components/app-select";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { DocumentLink } from "@/components/document-viewer";
import { PhotoPicker } from "@/components/file-pickers";
import { CheckCircleIcon, InboxIcon, PencilIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { LOAN_ACCESSORIES, type Loan, type LoanAccessory, type LoanDevice } from "@/lib/types";
import { LoanStatusBadge } from "./loan-status";
import { deviceLabel, overlaps, periodText } from "./loan-utils";

/** รูปตอนส่งมอบ / รับคืน ต่อครั้ง (LOAN_MAX_PHOTOS ใน express/src/routes/loans.ts) */
const MAX_PHOTOS = 6;
type Mode = "view" | "prepare" | "return";

/**
 * รายละเอียดการยืม (กล่องลอย) — ปุ่มตาม can_* จาก API:
 *   ผู้ยืม: แก้ไข / ยกเลิก (ระหว่างรอเตรียมเครื่อง), คืนเครื่อง (หลังรับเครื่องแล้ว → แจ้งเจ้าหน้าที่ IT)
 *   loans.manage: เตรียมเครื่อง (เลือกเครื่องที่ว่าง + อุปกรณ์เสริม + รูป) / ยืนยันรับคืน (ตรวจอุปกรณ์เสริมครบ + หมายเหตุ + รูป)
 */
export function LoanDialog({ loan: initial, onClose, onChanged }: { loan: Loan; onClose: () => void; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [l, setL] = useState(initial);
  const [mode, setMode] = useState<Mode>("view");
  const [pending, start] = useTransition();
  const period = periodText(l, fmt.date);
  const device = deviceLabel(l.asset, t("loan.board.noDevice"));
  const accName = (a: LoanAccessory) => t(`loan.accessories.${a}`);

  const act = async (action: "cancel" | "request-return") => {
    const msg = action === "cancel" ? t("loan.actions.confirmCancel", { device, period }) : t("loan.actions.confirmRequestReturn", { device });
    if (!(await confirm(msg))) return;
    start(async () => {
      const res = await loanAction(l.id, action);
      if (!res.loan) return void (await showAlert(res.errors?.status ?? res.message ?? t("common.saveFailed")));
      setL(res.loan);
      onChanged();
    });
  };
  const done = (loan: Loan) => {
    setL(loan);
    setMode("view");
    onChanged();
  };

  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  const title = mode === "prepare" ? t("loan.prepare.title", { name: l.user.name }) : mode === "return" ? t("loan.returnCheck.title", { name: l.user.name }) : device;

  return (
    <ModalShell id="loan-dialog" title={title} subtitle={mode === "view" ? undefined : `${device} · ${period}`} onClose={onClose} busy={pending} size="lg">
      <div className="space-y-3 overflow-y-auto p-5">
        {mode === "prepare" && <PrepareForm loan={l} onDone={done} onCancel={() => setMode("view")} />}
        {mode === "return" && <ReturnForm loan={l} onDone={done} onCancel={() => setMode("view")} />}
        {mode === "view" && (
          <>
            <LoanStatusBadge loan={l} />
            <dl className="divide-y divide-line">
              {row(t("loan.detail.device"), device)}
              {row(t("loan.detail.when"), period)}
              {row(t("loan.detail.borrower"), l.user.name)}
              {row(t("loan.detail.department"), l.department || "-")}
              {row(t("loan.detail.purpose"), <span className="whitespace-pre-line">{l.purpose}</span>)}
              {l.note && row(t("loan.detail.note"), <span className="whitespace-pre-line">{l.note}</span>)}
              {l.accessories.length > 0 && row(t("loan.detail.accessories"), l.accessories.map(accName).join(", "))}
              {l.handed_out_at && row(t("loan.detail.handedOut"), `${fmt.dateTime(l.handed_out_at)}${l.handed_out_by ? ` · ${l.handed_out_by}` : ""}`)}
              {l.return_requested_at && row(t("loan.detail.returnRequested"), fmt.dateTime(l.return_requested_at))}
              {l.returned_at && row(t("loan.detail.returned"), `${fmt.dateTime(l.returned_at)}${l.returned_by ? ` · ${l.returned_by}` : ""}`)}
              {l.status === "returned" && l.accessories.length > 0 && row(t("loan.detail.returnedAccessories"), l.returned_accessories.map(accName).join(", ") || "-")}
              {l.return_note && row(t("loan.detail.returnNote"), <span className="whitespace-pre-line">{l.return_note}</span>)}
              {l.photos.length > 0 &&
                row(
                  t("loan.photos"),
                  <span className="flex flex-wrap gap-2">
                    {l.photos.map((p) => (
                      <DocumentLink key={p.id} href={`/files/loans/${l.id}/photos/${p.id}`} kind="image" title={`${t("loan.photos")} — ${t(`loan.photoStage.${p.stage}`)}`} className="block cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ไม่ใช้ next/image) */}
                        <img src={`/files/loans/${l.id}/photos/${p.id}`} alt={t(`loan.photoStage.${p.stage}`)} className="h-16 w-16 rounded-lg object-cover ring-1 ring-line" />
                      </DocumentLink>
                    ))}
                  </span>,
                )}
            </dl>

            {(l.can_edit || l.can_cancel || l.can_hand_out || l.can_return || l.can_request_return) && (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {l.can_edit && (
                  <Link href={`/loans/${l.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                    <PencilIcon width={14} height={14} />
                    {t("loan.actions.edit")}
                  </Link>
                )}
                {l.can_cancel && (
                  <button type="button" disabled={pending} onClick={() => act("cancel")} className={`${btn.secondary} ${btn.sm}`}>
                    <XIcon width={14} height={14} />
                    {t("loan.actions.cancel")}
                  </button>
                )}
                {l.can_request_return && (
                  <button type="button" disabled={pending} onClick={() => act("request-return")} className={`${btn.primary} ${btn.sm}`}>
                    {pending ? <SpinnerIcon width={14} height={14} /> : <InboxIcon width={14} height={14} />}
                    {t("loan.actions.requestReturn")}
                  </button>
                )}
                {l.can_hand_out && (
                  <button type="button" disabled={pending} onClick={() => setMode("prepare")} className={`${btn.primary} ${btn.sm}`}>
                    <InboxIcon width={14} height={14} />
                    {t("loan.actions.handOut")}
                  </button>
                )}
                {l.can_return && (
                  <button type="button" disabled={pending} onClick={() => setMode("return")} className={`${btn.primary} ${btn.sm}`}>
                    <CheckCircleIcon width={14} height={14} />
                    {t("loan.actions.return")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

/** ติ๊กอุปกรณ์เสริม */
function AccessoryChecks({ options, value, onChange, error }: { options: readonly LoanAccessory[]; value: LoanAccessory[]; onChange: (v: LoanAccessory[]) => void; error?: string }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((a) => (
          <label key={a} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm ring-1 ring-line hover:bg-subtle">
            <input
              type="checkbox"
              checked={value.includes(a)}
              onChange={(e) => onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))}
              className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
            />
            {t(`loan.accessories.${a}`)}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}

/** เจ้าหน้าที่ IT เตรียมเครื่อง: เลือกเครื่องที่ว่างช่วงนั้น + อุปกรณ์เสริม + รูป (อัปโหลด / ถ่าย) → ส่งมอบ */
function PrepareForm({ loan, onDone, onCancel }: { loan: Loan; onDone: (l: Loan) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<LoanDevice[] | null>(null);
  const [assetId, setAssetId] = useState(loan.asset ? String(loan.asset.id) : "");
  const [accessories, setAccessories] = useState<LoanAccessory[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, start] = useTransition();

  useEffect(() => {
    let alive = true;
    loadLoanDevices().then((d) => alive && setDevices(d));
    return () => {
      alive = false;
    };
  }, []);
  /** ไม่ว่างช่วงของการยืมนี้: ถือเครื่องอยู่ (ยังไม่ยืนยันคืน) หรือมีการจองเครื่องนั้นซ้อนช่วง */
  const busyOf = (d: LoanDevice) => Boolean(d.on_loan) || (d.busy ?? []).some((b) => b.id !== loan.id && overlaps(b, loan));

  const submit = () => {
    if (!assetId) return setErrors({ asset_id: t("loan.form.validate.device") });
    const form = new FormData();
    form.set("asset_id", assetId);
    for (const a of accessories) form.append("accessories[]", a);
    for (const p of photos) form.append("photos[]", p);
    setErrors({});
    setMessage("");
    start(async () => {
      const res = await loanStep(loan.id, "hand-out", form);
      if (!res.ok || !res.loan) {
        setErrors((res.errors ?? {}) as Record<string, string>);
        setMessage(res.errors ? "" : (res.message ?? ""));
        return;
      }
      onDone(res.loan);
    });
  };

  return (
    <form action={submit} className="space-y-4">
      {message && <p className={alert.error}>{message}</p>}
      <div>
        <label htmlFor="prepare-asset" className="mb-1 block text-sm font-medium">
          {t("loan.prepare.device")} <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AppSelect id="prepare-asset" value={assetId} onValueChange={(v) => (setAssetId(v), setErrors((e) => ({ ...e, asset_id: "" })))} disabled={!devices} className={`${input} ${errors.asset_id ? inputError : ""}`}>
              <option value="">{t("loan.prepare.deviceChoose")}</option>
              {(devices ?? []).map((d) => (
                <option key={d.id} value={String(d.id)} disabled={busyOf(d) && String(d.id) !== assetId}>
                  {`${d.asset_tag} · ${d.name}${busyOf(d) ? ` — ${t("loan.prepare.deviceBusy")}` : ""}`}
                </option>
              ))}
            </AppSelect>
          </div>
          {!devices && <SpinnerIcon className="shrink-0 text-accent-400" />}
        </div>
        {errors.asset_id && <p className="mt-1 text-xs font-medium text-red-500">{errors.asset_id}</p>}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("loan.prepare.accessories")}</p>
        <AccessoryChecks options={LOAN_ACCESSORIES} value={accessories} onChange={setAccessories} error={errors.accessories} />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("loan.prepare.photos")}</p>
        <PhotoPicker files={photos} onChange={setPhotos} max={MAX_PHOTOS} onError={setMessage} />
        {errors.photos && <p className="mt-1 text-xs font-medium text-red-500">{errors.photos}</p>}
      </div>
      <p className={alert.info}>{t("loan.prepare.hint")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={saving} className={btn.primary}>
          {saving ? <SpinnerIcon /> : <InboxIcon />}
          {t("loan.prepare.save")}
        </button>
      </div>
    </form>
  );
}

/** เจ้าหน้าที่ IT ยืนยันรับคืน: ติ๊กอุปกรณ์เสริมที่คืนให้ครบ (ไม่ครบ = ต้องกรอกหมายเหตุ) + รูป → เครื่องว่าง */
function ReturnForm({ loan, onDone, onCancel }: { loan: Loan; onDone: (l: Loan) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [returned, setReturned] = useState<LoanAccessory[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, start] = useTransition();
  const missing = loan.accessories.filter((a) => !returned.includes(a));

  const submit = () => {
    if (missing.length && !note.trim()) return setErrors({ note: t("loan.returnCheck.missing") });
    const form = new FormData();
    // บอก API ว่าตรวจแล้ว (ไม่ติ๊กเลย = คืนไม่ครบ)
    form.set("accessories_checked", "1");
    for (const a of returned) form.append("returned_accessories[]", a);
    if (note.trim()) form.set("note", note.trim());
    for (const p of photos) form.append("photos[]", p);
    setErrors({});
    setMessage("");
    start(async () => {
      const res = await loanStep(loan.id, "return", form);
      if (!res.ok || !res.loan) {
        setErrors((res.errors ?? {}) as Record<string, string>);
        setMessage(res.errors ? "" : (res.message ?? ""));
        return;
      }
      onDone(res.loan);
    });
  };

  return (
    <form action={submit} className="space-y-4">
      {message && <p className={alert.error}>{message}</p>}
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("loan.returnCheck.accessories")}</p>
        {loan.accessories.length === 0 ? (
          <p className="text-sm text-muted">{t("loan.returnCheck.none")}</p>
        ) : (
          <AccessoryChecks options={loan.accessories} value={returned} onChange={(v) => (setReturned(v), setErrors({}))} error={errors.returned_accessories} />
        )}
      </div>
      <div>
        <label htmlFor="return-note" className="mb-1 block text-sm font-medium">
          {t("loan.actions.returnNote")} {missing.length > 0 && <span className="text-red-500">*</span>}
        </label>
        <textarea id="return-note" rows={2} maxLength={2000} value={note} onChange={(e) => (setNote(e.target.value), setErrors({}))} className={`${input} ${errors.note ? inputError : ""}`} />
        {errors.note && <p className="mt-1 text-xs font-medium text-red-500">{errors.note}</p>}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("loan.returnCheck.photos")}</p>
        <PhotoPicker files={photos} onChange={setPhotos} max={MAX_PHOTOS} onError={setMessage} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={saving} className={btn.primary}>
          {saving ? <SpinnerIcon /> : <CheckCircleIcon />}
          {t("loan.returnCheck.save")}
        </button>
      </div>
    </form>
  );
}
