"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { transferVehicle } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, ArrowRightIcon, BuildingIcon, CheckCircleIcon, HistoryIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vehicle, VehicleTransfer } from "@/lib/types";

/**
 * ย้ายรถไปสาขาอื่น + ประวัติการย้าย (หน้าแก้ไขรถ)
 * ปลายทางเลือกได้ทุกสาขา ("ใช้ร่วมกันทุกสาขา" เฉพาะผู้ที่ขอบเขตทุกสาขา) — การจองที่ยังไม่ถึงของรถคันนี้คงไว้ (แจ้งเตือนก่อนย้าย)
 */
export function VehicleTransferPanel({
  vehicle,
  branches,
  allowShared,
  history,
}: {
  vehicle: Vehicle;
  branches: { id: number; name: string }[];
  allowShared: boolean;
  history: VehicleTransfer[];
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ branch_id?: string; note?: string }>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();

  const current = vehicle.branch?.id ?? null;
  const shared = t("meeting.rooms.noBranch");
  const targets = branches.filter((b) => b.id !== current);
  const branchName = (b: { name: string } | null) => b?.name ?? shared;
  const upcoming = vehicle.upcoming_bookings ?? 0;

  const submit = async () => {
    if (target === "" && !(allowShared && current !== null)) return setErrors({ branch_id: t("vehicle.transfer.chooseBranch") });
    const to = target === "" ? null : Number(target);
    const toName = to === null ? shared : (branches.find((b) => b.id === to)?.name ?? "");
    if (!(await confirm(t("vehicle.transfer.confirm", { name: vehicle.name, from: branchName(vehicle.branch), to: toName })))) return;
    start(async () => {
      const res = await transferVehicle(vehicle.id, to, note);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.message && !res.errors ? { ok: false, text: res.message } : null);
        return;
      }
      setOpen(false);
      setTarget("");
      setNote("");
      setErrors({});
      setMessage({ ok: true, text: res.message ?? "" });
      router.refresh();
    });
  };

  return (
    <section className={`space-y-4 p-5 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <BuildingIcon className="text-accent-500" />
            {t("vehicle.transfer.title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t("vehicle.transfer.current", { branch: branchName(vehicle.branch) })}</p>
        </div>
        {!open && (
          <button type="button" onClick={() => (setOpen(true), setMessage(null))} className={`${btn.soft} ${btn.sm}`}>
            <ArrowRightIcon width={14} height={14} />
            {t("vehicle.transfer.button")}
          </button>
        )}
      </div>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? alert.success : alert.error}>
          {message.ok ? <CheckCircleIcon className="shrink-0" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {message.text}
        </p>
      )}

      {open && (
        <fieldset disabled={saving} className="grid grid-cols-1 gap-4 rounded-xl bg-subtle p-4 disabled:opacity-60 sm:grid-cols-2">
          <div>
            <label htmlFor="transfer_branch" className="mb-1 block text-sm font-medium">
              {t("vehicle.transfer.to")} <span className="text-red-500">*</span>
            </label>
            <AppSelect
              id="transfer_branch"
              value={target}
              onValueChange={(v) => (setTarget(v), setErrors((e) => ({ ...e, branch_id: undefined })))}
              className={`${input} ${errors.branch_id ? inputError : ""}`}
            >
              <option value="">{allowShared && current !== null ? shared : t("vehicle.transfer.choose")}</option>
              {targets.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </AppSelect>
            {errors.branch_id && <p className="mt-1 text-xs font-medium text-red-500">{errors.branch_id}</p>}
          </div>
          <div>
            <label htmlFor="transfer_note" className="mb-1 block text-sm font-medium">
              {t("vehicle.transfer.note")}
            </label>
            <input
              id="transfer_note"
              maxLength={1000}
              value={note}
              onChange={(e) => (setNote(e.target.value), setErrors((x) => ({ ...x, note: undefined })))}
              placeholder={t("vehicle.transfer.notePlaceholder")}
              className={`${input} ${errors.note ? inputError : ""}`}
            />
            {errors.note && <p className="mt-1 text-xs font-medium text-red-500">{errors.note}</p>}
          </div>
          {upcoming > 0 && (
            <p className={`sm:col-span-2 ${alert.warning}`}>
              <AlertIcon className="shrink-0" />
              {t("vehicle.transfer.upcoming", { n: fmt.number(upcoming) })}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => (setOpen(false), setErrors({}))} className={btn.secondary}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={submit} className={btn.primary}>
              {saving ? <SpinnerIcon /> : <ArrowRightIcon />}
              {t("vehicle.transfer.submit")}
            </button>
          </div>
        </fieldset>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
          <HistoryIcon width={14} height={14} />
          {t("vehicle.transfer.history")}
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-faint">{t("vehicle.transfer.historyEmpty")}</p>
        ) : (
          <ol className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="rounded-xl bg-subtle px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  {branchName(h.from)}
                  <ArrowRightIcon width={14} height={14} className="text-accent-500" />
                  {branchName(h.to)}
                </div>
                <p className="text-xs text-muted">
                  {[h.created_at ? fmt.dateTime(h.created_at) : null, h.user_name].filter(Boolean).join(" · ")}
                </p>
                {h.note && <p className="mt-0.5 text-xs text-ink">{h.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
