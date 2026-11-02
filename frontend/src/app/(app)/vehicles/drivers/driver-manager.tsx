"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDriver, saveDriver, type DriverValues } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { PencilIcon, PlusIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { BranchChoices, VehicleDriver } from "@/lib/types";

const EMPTY = (choices: BranchChoices): DriverValues => ({ name: "", nickname: "", branch_id: choices.defaultId ? String(choices.defaultId) : "", is_active: true });

/** รายชื่อคนขับรถ: เพิ่ม / แก้ไข (ชื่อ-สกุล, ชื่อเล่น, สาขา, ใช้งาน) / ลบ (เฉพาะที่ยังไม่เคยถูกเลือก) */
export function DriverManager({ drivers, choices }: { drivers: VehicleDriver[]; choices: BranchChoices }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [pending, start] = useTransition();
  // editing: null = ปิดฟอร์ม, 0 = เพิ่มใหม่, id = แก้ไข
  const [editing, setEditing] = useState<number | null>(null);
  const [v, setV] = useState<DriverValues>(EMPTY(choices));
  const [errors, setErrors] = useState<Partial<Record<keyof DriverValues, string>>>({});
  const [saved, setSaved] = useState(false);

  const open = (d: VehicleDriver | null) => {
    setEditing(d ? d.id : 0);
    setV(d ? { name: d.name, nickname: d.nickname ?? "", branch_id: d.branch ? String(d.branch.id) : "", is_active: d.is_active } : EMPTY(choices));
    setErrors({});
    setSaved(false);
  };
  const set = <K extends keyof DriverValues>(k: K, value: DriverValues[K]) => {
    setV((x) => ({ ...x, [k]: value }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const save = () => {
    if (!v.name.trim()) return setErrors({ name: t("vehicle.drivers.nameRequired") });
    start(async () => {
      const res = await saveDriver(editing || null, v);
      if (res.ok) {
        setEditing(null);
        setSaved(true);
        return router.refresh();
      }
      setErrors(res.errors ?? {});
      if (!res.errors) await showAlert(res.message ?? t("common.saveFailed"));
    });
  };
  const remove = async (d: VehicleDriver) => {
    if (!(await confirm(t("vehicle.drivers.confirmDelete", { name: d.name })))) return;
    start(async () => {
      const res = await deleteDriver(d.id);
      if (!res.ok) return void (await showAlert(res.errors?.name ?? res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };
  const branchOptions = (
    <>
      {choices.allowShared && <option value="">{t("vehicle.drivers.branchAll")}</option>}
      {choices.branches.map((b) => (
        <option key={b.id} value={String(b.id)}>
          {b.name}
        </option>
      ))}
    </>
  );

  const form = (
    <div className={`p-4 ${card}`}>
      {/* ช่องกรอก + ใช้งาน + ปุ่ม ในแถวเดียว (จอเล็กขึ้นบรรทัดใหม่) */}
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <div>
          <label htmlFor="driver-name" className="mb-1 block text-sm font-medium">
            {t("vehicle.drivers.name")} <span className="text-red-500">*</span>
          </label>
          <input id="driver-name" autoFocus value={v.name} maxLength={150} onChange={(e) => set("name", e.target.value)} className={`${input} ${errors.name ? inputError : ""}`} />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="driver-nickname" className="mb-1 block text-sm font-medium">
            {t("vehicle.drivers.nickname")}
          </label>
          <input id="driver-nickname" value={v.nickname} maxLength={50} onChange={(e) => set("nickname", e.target.value)} className={`${input} ${errors.nickname ? inputError : ""}`} />
          {errors.nickname && <p className="mt-1 text-xs text-red-500">{errors.nickname}</p>}
        </div>
        <div>
          <label htmlFor="driver-branch" className="mb-1 block text-sm font-medium">
            {t("vehicle.drivers.branch")}
          </label>
          <AppSelect id="driver-branch" value={v.branch_id} onValueChange={(x) => set("branch_id", x)} className={`${input} ${errors.branch_id ? inputError : ""}`}>
            {branchOptions}
          </AppSelect>
          {errors.branch_id && <p className="mt-1 text-xs text-red-500">{errors.branch_id}</p>}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm lg:mt-6 lg:h-[42px]">
          <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]" />
          {t("vehicle.drivers.active")}
        </label>
        <div className="flex justify-end gap-2 lg:mt-6">
        <button type="button" onClick={() => setEditing(null)} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
          <XIcon />
          {t("common.cancel")}
        </button>
        <button type="button" onClick={save} disabled={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("common.save")}
        </button>
        </div>
      </div>
    </div>
  );

  const label = (d: VehicleDriver) => (
    <>
      <span className="font-medium">{d.name}</span>
      {d.nickname && <span className="ml-1.5 text-muted">({d.nickname})</span>}
    </>
  );
  const status = (d: VehicleDriver) => (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${d.is_active ? tone.success.badge : tone.idle.badge}`}>{t(d.is_active ? "vehicle.drivers.active" : "vehicle.drivers.inactive")}</span>
  );
  const actions = (d: VehicleDriver) =>
    d.can_manage !== false && (
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => open(d)} className={`${btn.soft} ${btn.sm}`}>
          <PencilIcon width={14} height={14} />
          {t("meeting.booking.edit")}
        </button>
        {(d.bookings_count ?? 0) === 0 && (
          <button type="button" onClick={() => remove(d)} disabled={pending} className={`${btn.danger} ${btn.sm} disabled:cursor-not-allowed`}>
            <TrashIcon width={14} height={14} />
            {t("meeting.booking.delete")}
          </button>
        )}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {saved ? (
          <p role="status" className={alert.success}>
            {t("vehicle.drivers.saved")}
          </p>
        ) : (
          <span />
        )}
        {editing === null && (
          <button type="button" onClick={() => open(null)} className={btn.primary}>
            <PlusIcon />
            {t("vehicle.drivers.add")}
          </button>
        )}
      </div>
      {editing !== null && form}
      {drivers.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vehicle.drivers.empty")}</div>
      ) : (
        <>
          {/* จอใหญ่ = ตาราง / มือถือ = การ์ด */}
          <div className={`hidden md:block ${table.wrap}`}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("vehicle.drivers.name")}</th>
                  <th className={table.th}>{t("vehicle.drivers.branch")}</th>
                  <th className={table.th}>{t("vehicle.drivers.active")}</th>
                  <th className={table.th} />
                </tr>
              </thead>
              <tbody className={table.body}>
                {drivers.map((d) => (
                  <tr key={d.id} className={table.row}>
                    <td className={table.td}>
                      {label(d)}
                      <p className="text-xs text-faint">{t("vehicle.drivers.bookings", { n: fmt.number(d.bookings_count ?? 0) })}</p>
                    </td>
                    <td className={table.td}>{d.branch?.name ?? t("vehicle.drivers.branchAll")}</td>
                    <td className={table.td}>{status(d)}</td>
                    <td className={table.td}>{actions(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {drivers.map((d) => (
              <article key={d.id} className={`space-y-2 p-4 ${card}`}>
                <div className="flex items-start justify-between gap-2">
                  <p>{label(d)}</p>
                  {status(d)}
                </div>
                <p className="text-sm text-muted">{d.branch?.name ?? t("vehicle.drivers.branchAll")}</p>
                <p className="text-xs text-faint">{t("vehicle.drivers.bookings", { n: fmt.number(d.bookings_count ?? 0) })}</p>
                {actions(d)}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
