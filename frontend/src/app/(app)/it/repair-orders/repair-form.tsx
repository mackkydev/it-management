"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createRepairOrder, lookupRepairItem, searchRepairPeople, updateRepairOrder } from "@/app/actions/repair-orders";
import { DocumentLink } from "@/components/document-viewer";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { DocumentPicker, EVENT_FILE_ACCEPT, EVENT_FILE_MAX_BYTES, EVENT_FILES_MAX } from "@/components/file-pickers";
import { AlertIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { SuggestInput, type SuggestItem } from "@/components/suggest-input";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { RepairLookupItem, RepairOrder } from "@/lib/types";
import { TIME_OPTIONS } from "../../vehicles/vehicle-utils";
import { MasterDataSelect } from "@/components/master-data-select";

type Field = "item" | "item_name" | "symptom" | "vendor_id" | "sent_on" | "sent_time" | "sent_by_id";
type Errors = Partial<Record<Field | "files" | "item_details" | "document_no" | "serial_number" | "follow_up_days", string>>;

interface Props {
  vendors: { id: number; name: string; vendor_type: string }[];
  /** ใบแจ้งซ่อมที่ยังไม่ปิด — เลือกจาก dropdown ข้างช่องค้นหา */
  tickets?: RepairLookupItem[];
  /** ค่าตั้งต้น: วันเวลาปัจจุบัน (เวลาไทย) + ผู้บันทึกงานซ่อม (ผู้ที่ login — แก้ไข = ผู้สร้างรายการ, เปลี่ยนไม่ได้) */
  defaults: { sent_on: string; sent_time: string; recorder: string };
  /** แก้ไขรายการเดิม — เปลี่ยนของที่ส่งไม่ได้ (ยกเลิกแล้วส่งใหม่) */
  order?: RepairOrder;
  /** ส่งใหม่จากหน้าใบแจ้งซ่อม (?ticket=) — เลือกใบนั้นไว้ให้ + เติมอาการเสีย */
  initialItem?: RepairLookupItem | null;
}

/** วันกำหนดตามงาน = วันที่ส่ง + จำนวนวัน (YYYY-MM-DD) — ค่าไม่ครบ / ไม่ถูกต้อง = null */
function followUpDate(sentOn: string, days: string): string | null {
  const n = Number(days);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn) || !Number.isInteger(n) || n < 1 || n > 365) return null;
  const d = new Date(`${sentOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
  // S/N ของสินทรัพย์แก้ไม่ได้ — ที่กรอกเองอยู่ในช่องกรอก
  serial_number: r.serial_from_asset ? r.serial_number : null,
  holder: r.holder,
  symptom: r.symptom,
});

/** ฟอร์มส่งซ่อม: ค้นหาจากเลขสินทรัพย์ หรือเลขที่ใบแจ้งงาน → ดึงข้อมูลเครื่อง (ใบแจ้งงาน = เติมอาการเสียให้) → เลือก Vendor / วันเวลา / ผู้ส่ง + แนบใบส่งซ่อม */
export function RepairForm({ vendors, tickets = [], defaults, order, initialItem = null }: Props) {
  const { t, fmt } = useI18n();
  const [query, setQuery] = useState("");
  // อุปกรณ์ไม่ได้อยู่ในระบบ และไม่มีใบแจ้งงาน — ซ่อนช่องค้นหา/เลือกใบงาน แสดงช่องกรอกชื่อ + ข้อมูลอุปกรณ์แทน
  const [manual, setManual] = useState(order?.manual ?? false);
  const [itemName, setItemName] = useState(order?.manual ? order.item_name : "");
  const [item, setItem] = useState<RepairLookupItem | null>(order && !order.manual ? orderItem(order) : initialItem);
  const [symptom, setSymptom] = useState(order?.symptom ?? initialItem?.symptom ?? "");
  const [vendorId, setVendorId] = useState(order ? String(order.vendor.id) : "");
  const [filled, setFilled] = useState(order ? "" : (initialItem?.symptom ?? ""));
  const [itemDetails, setItemDetails] = useState(order?.item_details ?? "");
  const [documentNo, setDocumentNo] = useState(order?.document_no ?? "");
  // แจ้งเตือนตามงาน: จำนวนวันหลังวันที่ส่งซ่อม (ตั้งต้น 7)
  const [followUpDays, setFollowUpDays] = useState(String(order?.follow_up_days ?? 7));
  const [serial, setSerial] = useState(order?.item_serial ?? "");
  const [removed, setRemoved] = useState<number[]>([]);
  const [sentOn, setSentOn] = useState(defaults.sent_on);
  const [sentTime, setSentTime] = useState(defaults.sent_time);
  // ผู้ส่งซ่อม (เจ้าของอุปกรณ์): พิมพ์ชื่อเอง หรือเลือกจากผู้ใช้ที่ตรงกับที่พิมพ์ (เลือก = ผูก id, พิมพ์ต่อ = กลับเป็นชื่อพิมพ์เอง)
  // ส่งจากใบแจ้งงาน = ตั้งต้นเป็นผู้แจ้งงาน (แก้ได้)
  const [senderName, setSenderName] = useState(order?.sent_by.name ?? initialItem?.requester?.name ?? "");
  const [senderId, setSenderId] = useState<number | null>(order ? order.sent_by.id : (initialItem?.requester?.id ?? null));
  const [filledSender, setFilledSender] = useState(order ? "" : (initialItem?.requester?.name ?? ""));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const clear = (f: keyof Errors) => setErrors((e) => ({ ...e, [f]: "" }));

  const load = async (q: string): Promise<SuggestItem<RepairLookupItem>[]> =>
    (await lookupRepairItem(q)).map((x) => ({
      value: x.ticket_no ?? x.item_no ?? x.item_name,
      hint: [t(`repairOrders.form.kind.${x.kind}`), x.ticket_no ? x.item_no : null, x.item_name].filter(Boolean).join(" · "),
      data: x,
    }));

  const choose = (x: RepairLookupItem) => {
    setItem(x);
    setQuery("");
    clear("item");
    // ใบแจ้งงาน: เติมอาการจากใบ (แก้ได้) — ไม่ทับข้อความที่พิมพ์เอง แต่เปลี่ยนใบแล้วอาการที่เติมไว้เปลี่ยนตาม
    if (!symptom.trim() || symptom === filled) {
      setSymptom(x.symptom ?? "");
      setFilled(x.symptom ?? "");
      if (x.symptom) clear("symptom");
    }
    // ผู้ส่งซ่อม = ผู้แจ้งงานของใบที่เลือก — ไม่ทับชื่อที่พิมพ์/เลือกเอง
    if (!senderName.trim() || senderName === filledSender) {
      const r = x.requester ?? null;
      setSenderName(r?.name ?? "");
      setSenderId(r?.id ?? null);
      setFilledSender(r?.name ?? "");
      if (r) clear("sent_by_id");
    }
  };
  const pick = (s: SuggestItem<RepairLookupItem>) => {
    if (s.data) choose(s.data);
  };

  type Person = { id: number; name: string; department: string | null };
  const loadPeople = async (q: string): Promise<SuggestItem<Person>[]> =>
    (await searchRepairPeople(q)).map((p) => ({ value: p.name, hint: p.department ?? undefined, data: p }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (manual) {
      if (!itemName.trim()) found.item_name = t("repairOrders.validate.manualName");
    } else if (!item) found.item = t("repairOrders.validate.item");
    if (!symptom.trim()) found.symptom = t("repairOrders.validate.symptom");
    if (!vendorId) found.vendor_id = t("repairOrders.validate.vendor");
    if (!sentOn) found.sent_on = t("repairOrders.validate.sentOn");
    if (!sentTime) found.sent_time = t("repairOrders.validate.sentTime");
    if (!senderName.trim()) found.sent_by_id = t("repairOrders.validate.sentBy");
    const days = Number(followUpDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) found.follow_up_days = t("repairOrders.validate.followUpDays");
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    const fd = new FormData();
    if (manual) {
      if (!order) fd.set("manual", "1");
      fd.set("item_name", itemName.trim());
    } else if (!order) {
      if (item!.ticket_id) fd.set("ticket", item!.ticket_id);
      else fd.set("asset", item!.asset_id ?? "");
    }
    removed.forEach((id) => fd.append("remove_file_ids[]", String(id)));
    fd.set("symptom", symptom.trim());
    fd.set("item_details", itemDetails.trim());
    fd.set("document_no", documentNo.trim());
    fd.set("follow_up_days", String(Number(followUpDays)));
    if (!manual && !item!.serial_number) fd.set("serial_number", serial.trim());
    fd.set("vendor_id", vendorId);
    fd.set("sent_on", sentOn);
    fd.set("sent_time", sentTime);
    if (senderId) fd.set("sent_by_id", String(senderId));
    fd.set("sender_name", senderName.trim());
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
        {/* ส่งใหม่เท่านั้น — แก้ไขเปลี่ยนชนิดของที่ส่งไม่ได้ */}
        {!order && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={manual}
              onChange={(e) => {
                setManual(e.target.checked);
                setItem(null);
                setQuery("");
                setErrors((x) => ({ ...x, item: "", item_name: "" }));
              }}
              className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
            />
            {t("repairOrders.form.manual")}
          </label>
        )}
        {manual ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "item_name",
              t("repairOrders.form.manualName"),
              <input
                id="item_name"
                maxLength={255}
                value={itemName}
                onChange={(e) => {
                  setItemName(e.target.value);
                  clear("item_name");
                }}
                placeholder={t("repairOrders.form.manualNamePlaceholder")}
                className={cls("item_name")}
              />,
            )}
            <div>
              <label htmlFor="item_details" className="mb-1 block text-sm font-medium">
                {t("repairOrders.form.manualDetails")}
              </label>
              <textarea
                id="item_details"
                rows={3}
                maxLength={2000}
                value={itemDetails}
                onChange={(e) => {
                  setItemDetails(e.target.value);
                  clear("item_details");
                }}
                placeholder={t("repairOrders.form.manualDetailsPlaceholder")}
                className={`${input} ${errors.item_details ? inputError : ""}`}
              />
              {errors.item_details && <p className="mt-1 text-xs font-medium text-red-500">{errors.item_details}</p>}
            </div>
          </div>
        ) : item ? (
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
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {info(t("repairOrders.col.ticket"), item.ticket_no)}
              {info(t("repairOrders.form.itemNo"), item.item_no)}
              {info(t("repairOrders.form.itemName"), item.item_name)}
              {info(t("repairOrders.form.brand"), item.brand)}
              {info(t("repairOrders.form.model"), item.model ?? "—")}
              {item.serial_number ? (
                info(t("repairOrders.form.serial"), item.serial_number)
              ) : (
                <div>
                  <dt>
                    <label htmlFor="serial_number" className="text-xs text-muted">
                      {t("repairOrders.form.serial")}
                    </label>
                  </dt>
                  <dd className="mt-0.5">
                    <input
                      id="serial_number"
                      maxLength={100}
                      value={serial}
                      onChange={(e) => {
                        setSerial(e.target.value);
                        clear("serial_number");
                      }}
                      placeholder={t("repairOrders.form.serialPlaceholder")}
                      className={`${input} ${errors.serial_number ? inputError : ""}`}
                    />
                    {errors.serial_number && <p className="mt-1 text-xs font-medium text-red-500">{errors.serial_number}</p>}
                  </dd>
                </div>
              )}
              {info(t("repairOrders.form.holder"), item.holder)}
            </dl>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
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
            )}
            <div>
              <label htmlFor="open_ticket" className="mb-1 block text-sm font-medium">
                {t("repairOrders.form.openTickets")}
              </label>
              <AppSelect
                id="open_ticket"
                value=""
                disabled={tickets.length === 0}
                onValueChange={(v) => {
                  const x = tickets.find((tk) => tk.ticket_id === v);
                  if (x) choose(x);
                }}
                className={input}
              >
                <option value="">{t(tickets.length ? "repairOrders.form.chooseTicket" : "repairOrders.form.noTickets")}</option>
                {tickets.map((x) => (
                  <option key={x.ticket_id} value={x.ticket_id ?? ""}>
                    {[x.ticket_no, x.item_no, x.item_name].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ")}
                  </option>
                ))}
              </AppSelect>
            </div>
          </div>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field(
            "vendor_id",
            t("repairOrders.form.vendor"),
            <>
              <MasterDataSelect source="vendors">
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
              </MasterDataSelect>
              {vendors.length === 0 && <p className="mt-1 text-xs text-muted">{t("repairOrders.form.noVendors")}</p>}
            </>,
          )}
          {field(
            "sent_by_id",
            t("repairOrders.form.sentBy"),
            <SuggestInput<Person>
              id="sent_by_id"
              value={senderName}
              onChange={(v) => {
                setSenderName(v);
                setSenderId(null);
                clear("sent_by_id");
              }}
              load={loadPeople}
              onPick={(s) => {
                setSenderName(s.data?.name ?? s.value);
                setSenderId(s.data?.id ?? null);
                clear("sent_by_id");
              }}
              allowNew={false}
              maxLength={255}
              placeholder={t("repairOrders.form.sentByPlaceholder")}
              className={cls("sent_by_id")}
            />,
          )}
          {/* ผู้บันทึกงานซ่อม = ผู้สร้างรายการ — เปลี่ยนไม่ได้ */}
          <div>
            <label htmlFor="recorder" className="mb-1 block text-sm font-medium">
              {t("repairOrders.form.recorder")}
            </label>
            <input id="recorder" value={order?.created_by.name ?? defaults.recorder} disabled className={`${input} disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted`} />
          </div>
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
          <div>
            <label htmlFor="document_no" className="mb-1 block text-sm font-medium">
              {t("repairOrders.form.documentNo")}
            </label>
            <input
              id="document_no"
              maxLength={100}
              value={documentNo}
              onChange={(e) => {
                setDocumentNo(e.target.value);
                clear("document_no");
              }}
              className={`${input} ${errors.document_no ? inputError : ""}`}
            />
            {errors.document_no && <p className="mt-1 text-xs font-medium text-red-500">{errors.document_no}</p>}
          </div>
          {/* แจ้งเตือนตามงาน — ครบจำนวนวันนับจากวันที่ส่งแล้วยังไม่รับคืน = แจ้งที่กระดิ่ง + ตัวเลขเมนู */}
          <div>
            <label htmlFor="follow_up_days" className="mb-1 block text-sm font-medium">
              {t("repairOrders.form.followUpDays")}
              <span className="text-red-500"> *</span>
            </label>
            <input
              id="follow_up_days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={followUpDays}
              onChange={(e) => {
                setFollowUpDays(e.target.value);
                clear("follow_up_days");
              }}
              className={`${input} ${errors.follow_up_days ? inputError : ""}`}
            />
            {errors.follow_up_days ? (
              <p className="mt-1 text-xs font-medium text-red-500">{errors.follow_up_days}</p>
            ) : (
              followUpDate(sentOn, followUpDays) && <p className="mt-1 text-xs text-muted">{t("repairOrders.form.followUpHint", { date: fmt.date(followUpDate(sentOn, followUpDays)!) })}</p>
            )}
          </div>
          {/* อุปกรณ์นอกระบบ: ข้อมูลอุปกรณ์เพิ่มเติมอยู่ในส่วนสินค้าที่ส่งซ่อมแล้ว */}
          {!manual && (
          <div className="sm:col-span-2 lg:col-span-2">
            <label htmlFor="item_details" className="mb-1 block text-sm font-medium">
              {t("repairOrders.form.itemDetails")}
            </label>
            <textarea
              id="item_details"
              rows={3}
              maxLength={2000}
              value={itemDetails}
              onChange={(e) => {
                setItemDetails(e.target.value);
                clear("item_details");
              }}
              placeholder={t("repairOrders.form.itemDetailsPlaceholder")}
              className={`${input} ${errors.item_details ? inputError : ""}`}
            />
            {errors.item_details && <p className="mt-1 text-xs font-medium text-red-500">{errors.item_details}</p>}
          </div>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="mb-1 text-sm font-medium">{t("repairOrders.form.files")}</p>
            {order && order.files.some((f) => f.kind === "send" && !removed.includes(f.id)) && (
              <ul className="mb-2 space-y-1.5">
                {order.files
                  .filter((f) => f.kind === "send" && !removed.includes(f.id))
                  .map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
                      <DocumentLink href={`/files${f.url}`} name={f.name} className="min-w-0 flex-1 cursor-pointer truncate hover:underline">
                        {f.name}
                      </DocumentLink>
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
