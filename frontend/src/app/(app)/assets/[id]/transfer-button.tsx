"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { transferAsset } from "@/app/actions/assets";
import { AppSelect } from "@/components/app-select";
import { SaveIcon, SpinnerIcon, TruckIcon, XIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Branch, UserOption } from "@/lib/types";
import { CustodianPicker } from "../custodian-picker";

/**
 * ปุ่ม "โอนย้าย" (ข้างปุ่มแก้ไข) — เปลี่ยนสาขาของสินทรัพย์ + ผู้ถือครอง/ผู้ใช้งาน แล้วบันทึกประวัติการโอนย้าย
 * (ผู้ถือครองใหม่ = ชื่อ-สกุลผู้ใช้งาน → ประวัติผู้ใช้งาน)
 */
export function TransferButton({
  assetId,
  branches,
  branchId,
  holder,
}: {
  assetId: string;
  branches: Branch[];
  branchId: number | null;
  holder: { id: number; name: string } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(branchId ? String(branchId) : "");
  const [user, setUser] = useState<{ id: number; name: string } | null>(holder);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const show = () => {
    setBranch(branchId ? String(branchId) : "");
    setUser(holder);
    setReason("");
    setErrors({});
    setMessage("");
    setOpen(true);
  };
  const changed = branch !== (branchId ? String(branchId) : "") || (user?.id ?? null) !== (holder?.id ?? null);
  const save = () => {
    if (!changed) return setMessage(t("assets.transfer.noChange"));
    start(async () => {
      const res = await transferAsset(assetId, { branch_id: branch ? Number(branch) : null, custodian_id: user?.id ?? null, reason: reason.trim() });
      if (res.ok) {
        setOpen(false);
        return router.refresh();
      }
      setErrors(res.errors ?? {});
      setMessage(res.message ?? "");
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={btn.soft}>
        <TruckIcon />
        {t("assets.transfer.button")}
      </button>
      {open && (
        <ModalShell id="transfer-title" title={t("assets.transfer.title")} subtitle={t("assets.transfer.hint")} onClose={() => setOpen(false)} busy={pending}>
          <fieldset disabled={pending} className="space-y-4">
            {message && <p className={alert.error}>{message}</p>}
            <div>
              <label htmlFor="transfer-branch" className="mb-1 block text-sm font-medium">
                {t("assets.col.branch")}
              </label>
              <AppSelect
                id="transfer-branch"
                value={branch}
                onValueChange={(v) => {
                  setBranch(v);
                  setErrors((e) => ({ ...e, branch_id: "" }));
                  setMessage("");
                }}
                className={`${input} ${errors.branch_id ? inputError : ""}`}
              >
                <option value="">{t("common.none")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </AppSelect>
              {errors.branch_id && <p className="mt-1 text-xs text-red-500">{errors.branch_id}</p>}
            </div>
            <div>
              <label htmlFor="transfer-holder" className="mb-1 block text-sm font-medium">
                {t("assets.detail.holder")}
              </label>
              <CustodianPicker
                id="transfer-holder"
                value={user}
                onChange={(u: UserOption | null) => {
                  setUser(u ? { id: u.id, name: u.name } : null);
                  setErrors((e) => ({ ...e, custodian_id: "" }));
                  setMessage("");
                }}
                className={`${input} ${errors.custodian_id ? inputError : ""}`}
              />
              {errors.custodian_id && <p className="mt-1 text-xs text-red-500">{errors.custodian_id}</p>}
            </div>
            <div>
              <label htmlFor="transfer-reason" className="mb-1 block text-sm font-medium">
                {t("assets.form.movementReason")}
              </label>
              <input
                id="transfer-reason"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("assets.form.movementReasonPlaceholder")}
                className={`${input} ${errors.reason ? inputError : ""}`}
              />
              {errors.reason && <p className="mt-1 text-xs text-red-500">{errors.reason}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className={`${btn.secondary} disabled:cursor-not-allowed`}>
                <XIcon className="text-faint" />
                {t("common.cancel")}
              </button>
              <button type="button" onClick={save} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
                {pending ? <SpinnerIcon /> : <SaveIcon />}
                {t("common.save")}
              </button>
            </div>
          </fieldset>
        </ModalShell>
      )}
    </>
  );
}
