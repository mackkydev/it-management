"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createRepairOrder, lookupRepairItem, updateRepairOrder } from "@/app/actions/repair-orders";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { DocumentPicker, EVENT_FILE_ACCEPT, EVENT_FILE_MAX_BYTES, EVENT_FILES_MAX } from "@/components/file-pickers";
import { AlertIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { SuggestInput, type SuggestItem } from "@/components/suggest-input";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { RepairLookupItem, RepairOrder } from "@/lib/types";
import { TIME_OPTIONS } from "../../vehicles/vehicle-utils";

type Field = "item" | "symptom" | "vendor_id" | "sent_on" | "sent_time" | "sent_by_id";
type Errors = Partial<Record<Field | "files", string>>;

interface Props {
  vendors: { id: number; name: string; vendor_type: string }[];
  staff: { id: number; name: string }[];
  /** ค่าตั้งต้น: ผู้บันทึก + วันเวลาปัจจุบัน (เวลาไทย) */
  defaults: { sent_by_id: number; sent_on: string; sent_time: string };
  /** แก้ไขรายการเดิม — เปลี่ยนของที่ส่งไม่ได้ (ยกเลิกแล้วส่งใหม่) */
  order?: RepairOrder;
}

const orderItem = (r: RepairOrder): RepairLookupItem => ({
  kind: r.ticket ? "ticket" : "asset",
  asset_id: r.asset_id,
  ticket_id: r.ticket?.id ?? null,
  ticket_no: r.ticket?.ticket_no ?? null,
  item_no: r.item_no,
  item_name: r.item_name,
  brand: r.brand,
  model: r.model,
  serial_number: r.serial_number,
  holder: r.holder,
  symptom: r.symptom,
});

/** ฟอร์มส่งซ่อม: ค้นหาจากเลขสินทรัพย์ หรือเลขที่ใบแจ้งงาน → ดึงข้อมูลเครื่อง (ใบแจ้งงาน = เติมอาการเสียให้) → เลือก Vendor / วันเวลา / ผู้ส่ง + แนบใบส่งซ่อม */
export function RepairForm({ vendors, staff, defaults, order }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<RepairLookupItem | null>(order ? orderItem(order) : null);
  const [symptom, setSymptom] = useState(order?.symptom ?? "");
  const [vendorId, setVendorId] = useState(order ? String(order.vendor.id) : "");
  const [removed, setRemoved] = useState<number[]>([]);
  const [sentOn, setSentOn] = useState(defaults.sent_on);
  const [sentTime, setSentTime] = useState(defaults.sent_time);
  const [sentBy, setSentBy] = useState(String(defaults.sent_by_id));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const clear = (f: Field | "files") => setErrors((e) => ({ ...e, [f]: "" }));

  const load = async (q: string): Promise<SuggestItem<RepairLookupItem>[]> =>
    (await lookupRepairItem(q)).map((x) => ({
      value: x.ticket_no ?? x.item_no ?? x.item_name,
      hint: [t(`repairOrders.form.kind.${x.kind}`), x.ticket_no ? x.item_no : null, x.item_name].filter(Boolean).join(" · "),
      data: x,
    }));

  const pick = (s: SuggestItem<RepairLookupItem>) => {
    if (!s.data) return;
    setItem(s.data);
    setQuery("");
    clear("item");
    // ใบแจ้งงาน: เติมอาการจากใบ (แก้ได้) — ไม่ทับข้อความที่พิมพ์ไว้แล้ว
    if (s.data.symptom && !symptom.trim()) {
      setSymptom(s.data.symptom);
      clear("symptom");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (!item) found.item = t("repairOrders.validate.item");
    if (!symptom.trim()) found.symptom = t("repairOrders.validate.symptom");
    if (!vendorId) found.vendor_id = t("repairOrders.validate.vendor");
    if (!sentOn) found.sent_on = t("repairOrders.validate.sentOn");
    if (!sentTime) found.sent_time = t("repairOrders.validate.sentTime");
    if (!sentBy) found.sent_by_id = t("repairOrders.validate.sentBy");
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    const fd = new FormData();
    if (!order) {
      if (item!.ticket_id) fd.set("ticket", item!.ticket_id);
      else fd.set("asset", item!.asset_id ?? "");
    }
    removed.forEach((id) => fd.append("remove_file_ids[]", String(id)));
    fd.set("symptom", symptom.trim());
    fd.set("vendor_id", vendorId);
    fd.set("sent_on", sentOn);
    fd.set("sent_time", sentTime);
    fd.set("sent_by_id", sentBy);
    files.forEach((f) => fd.append("files[]", f));
    setMessage("");
    start(async () => {
      const r = order ? await updateRepairOrder(order.id, fd) : await createRepairOrder(fd);
      if (!r) return;
      setErrors((r.errors ?? {}) as Errors);
      setMessage(r.errors?.item ?? r.message ?? "");
    });
  };

  const field = (id: Field, label: string, control: ReactNode, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        <span className="text-red-500"> *</span>
      </label>
      {control}
      {errors[id] && <p className="mt-1 text-xs font-medium text-red-500">{errors[id]}</p>}
    </div>
  );
  const cls = (f: Field) => `${input} ${errors[f] ? inputError : ""}`;
  const info = (label: string, value: string | null) =>
    value ? (
      <div>
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      <fieldset disabled={pending} aria-busy={pending} className={`space-y-4 p-4 transition-opacity disabled:opacity-60 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("repairOrders.form.itemSection")}</h2>
        {item ? (
          <div className="rounded-xl bg-subtle p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="text-xs font-medium text-accent-700 dark:text-accent-300">{t(`repairOrders.form.kind.${item.kind}`)}</span>
              {!order && (
                <button type="button" onClick={() => setItem(null)} className={`${btn.secondary} ${btn.sm}`}>
                  <XIcon width={13} height={13} />
                  {t("repairOrders.form.change")}
                </button>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {info(t("repairOrders.col.ticket"), item.ticket_no)}
              {info(t("repairOrders.form.itemNo"), item.item_no)}
              {info(t("repairOrders.form.itemName"), item.item_name)}
              {info(t("repairOrders.form.brandModel"), [item.brand, item.model].filter(Boolean).join(" ") || null)}
              {info(t("repairOrders.form.serial"), item.serial_number)}
              {info(t("repairOrders.form.holder"), item.holder)}
            </dl>
          </div>
        ) : (
          field(
            "item",
            t("repairOrders.form.search"),
            <SuggestInput
              id="item"
              value={query}
              onChange={(v) => {
                setQuery(v);
                clear("item");
              }}
              load={load}
              onPick={pick}
              allowNew={false}
              placeholder={t("repairOrders.form.searchPlaceholder")}
              className={cls("item")}
            />,
          )
        )}
        {field(
          "symptom",
          t("repairOrders.form.symptom"),
          <textarea
            id="symptom"
            rows={3}
            maxLength={2000}
            value={symptom}
            onChange={(e) => {
              setSymptom(e.target.value);
              clear("symptom");
            }}
            placeholder={t("repairOrders.form.symptomPlaceholder")}
            className={cls("symptom")}
          />,
        )}
      </fieldset>

      <fieldset disabled={pending} aria-busy={pending} className={`p-4 transition-opacity disabled:opacity-60 sm:p-6 ${card}`}>
        <h2 className="mb-4 font-semibold">{t("repairOrders.form.sendSection")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(
            "vendor_id",
            t("repairOrders.form.vendor"),
            <>
              <AppSelect
                id="vendor_id"
                value={vendorId}
                onValueChange={(v) => {
                  setVendorId(v);
                  clear("vendor_id");
                }}
                className={cls("vendor_id")}
              >
                <option value="">{t("repairOrders.form.chooseVendor")}</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.vendor_type})
                  </option>
                ))}
              </AppSelect>
              {vendors.length === 0 && <p className="mt-1 text-xs text-muted">{t("repairOrders.form.noVendors")}</p>}
            </>,
          )}
          {field(
            "sent_by_id",
            t("repairOrders.form.sentBy"),
            <AppSelect
              id="sent_by_id"
              value={sentBy}
              onValueChange={(v) => {
                setSentBy(v);
                clear("sent_by_id");
              }}
              className={cls("sent_by_id")}
            >
              <option value="">{t("repairOrders.form.chooseStaff")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </AppSelect>,
          )}
          {field(
            "sent_on",
            t("repairOrders.form.sentOn"),
            <DateInput
              id="sent_on"
              value={sentOn}
              onChange={(v) => {
                setSentOn(v);
                clear("sent_on");
              }}
              className={cls("sent_on")}
            />,
          )}
          {field(
            "sent_time",
            t("repairOrders.form.sentTime"),
            <AppSelect
              id="sent_time"
              value={sentTime}
              onValueChange={(v) => {
                setSentTime(v);
                clear("sent_time");
              }}
              className={cls("sent_time")}
            >
              {TIME_OPTIONS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </AppSelect>,
          )}
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">{t("repairOrders.form.files")}</p>
            {order && order.files.some((f) => f.kind === "send" && !removed.includes(f.id)) && (
              <ul className="mb-2 space-y-1.5">
                {order.files
                  .filter((f) => f.kind === "send" && !removed.includes(f.id))
                  .map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                      <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                        {f.name}
                      </a>
                      <button type="button" onClick={() => setRemoved((x) => [...x, f.id])} aria-label={t("repairOrders.form.removeFile", { name: f.name })} className="cursor-pointer text-faint hover:text-danger-500">
                        <XIcon width={14} height={14} />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <DocumentPicker
              files={files}
              onChange={(f) => (setFiles(f), setMessage(""))}
              max={EVENT_FILES_MAX}
              maxBytes={EVENT_FILE_MAX_BYTES}
              accept={EVENT_FILE_ACCEPT}
              hint={t("upload.eventFileHint", { max: EVENT_FILES_MAX })}
              onError={setMessage}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex gap-2 sm:justify-end">
        <Link href={order ? `/it/repair-orders/${order.id}` : "/it/repair-orders"} className={`${btn.secondary} flex-1 sm:flex-none`}>
          <XIcon className="text-faint" />
          {t("common.cancel")}
        </Link>
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} flex-1 disabled:cursor-not-allowed sm:flex-none`}>
          {pending ? <SpinnerIcon /> : <SendIcon />}
          {pending ? t("common.saving") : order ? t("common.save") : t("repairOrders.form.submit")}
        </button>
      </div>
    </form>
  );
}
