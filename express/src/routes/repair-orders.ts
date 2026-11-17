import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, lockNamed, scalar, select, transaction, update } from "../db.js";
import { me, pageParam, shortMeta } from "../http.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, displayDate, iso, localToday, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { exists, int, regex, validate, type Rule } from "../lib/validator.js";
import { can, type UserRow } from "../models/user.js";
import { assetIdByNumber } from "../services/asset-repairs.js";
import { audit } from "../services/audit.js";
import { markNoticesRead, notifyUsers } from "../services/notifications.js";
import { usersWithPermissions } from "../services/permissions.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";
import { itStaffOptions, notify, PRE_APPROVAL, TICKET_APPROVAL_COLUMNS, type TicketRow } from "../services/ticket-workflow.js";

/**
 * งานฝ่าย IT → รายการส่งซ่อม (repair_orders.view ดู / repair_orders.manage บันทึก)
 *   เลือกของจากสินทรัพย์ หรือใบแจ้งซ่อมที่กำลังดำเนินการ → POST /repair-orders = sent → POST /repair-orders/:uuid/return = returned
 *   ผูกใบแจ้งงาน = ทั้งสองขั้นลงประวัติใบงาน (it_ticket_events.repair_order_id — ลิงก์เฉพาะผู้มี repair_orders.view) + แจ้งเตือนผู้เกี่ยวข้อง
 */
export const repairOrderRoutes = Router();

const STATUSES = ["sent", "returned", "cancelled"];
const PER_PAGE = 25;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d)$/;
/** ตรงกับ EVENT_FILE_* ของหน้าเว็บ (file-pickers.tsx) — ไฟล์ละ ≤ 1MB สูงสุด 10 ไฟล์ */
const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png,webp", "max:1024"];
const FILES_MAX = 10;
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

interface OrderRow {
  id: number;
  uuid: string;
  asset_id: number | null;
  ticket_id: number | null;
  item_no: string | null;
  item_name: string;
  symptom: string;
  item_details: string | null;
  document_no: string | null;
  item_serial: string | null;
  vendor_id: number;
  sent_on: string;
  sent_time: string;
  status: string;
  returned_at: string | null;
  return_note: string | null;
  asset_prev_status: string | null;
  cancelled_at: string | null;
  cancelled_by_id: number | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  vendor_name: string;
  vendor_type: string;
  vendor_contact: string;
  vendor_phone: string;
  asset_uuid: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  holder: string | null;
  ticket_uuid: string | null;
  ticket_no: string | null;
  sent_by_id: number | null;
  sender_name: string | null;
  follow_up_days: number;
  follow_up_on: string;
  created_by: number;
  created_by_name: string;
  sent_by_name: string | null;
  received_by_id: number | null;
  received_by_name: string | null;
}

interface FileRow {
  id: number;
  repair_order_id: number;
  kind: string;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

const SELECT = `SELECT r.*, v.name AS vendor_name, v.vendor_type, v.contact_name AS vendor_contact, v.contact_phone AS vendor_phone,
    a.uuid AS asset_uuid, a.brand, a.model, a.serial_number, a.user_name AS holder, t.uuid AS ticket_uuid, t.ticket_no,
    s.name AS sent_by_name, cr.name AS created_by_name, rb.name AS received_by_name, cb.name AS cancelled_by_name
  FROM repair_orders r
  JOIN vendors v ON v.id = r.vendor_id
  LEFT JOIN users s ON s.id = r.sent_by_id
  JOIN users cr ON cr.id = r.created_by
  LEFT JOIN users rb ON rb.id = r.received_by_id
  LEFT JOIN users cb ON cb.id = r.cancelled_by_id
  LEFT JOIN assets a ON a.id = r.asset_id
  LEFT JOIN it_tickets t ON t.id = r.ticket_id`;

interface PartRow {
  repair_order_id: number;
  name: string;
  quantity: number;
}
/** อะไหล่ที่ร้านเปลี่ยน (กรอกตอนรับคืน) — ไม่เกินจำนวนนี้ ตรงกับรายการอะไหล่ของบันทึกผลใบงาน */
const PARTS_MAX = 10;
const partsOf = (orderIds: number[]) =>
  orderIds.length
    ? select<PartRow>("SELECT repair_order_id, name, quantity FROM repair_order_parts WHERE repair_order_id IN (?) ORDER BY id", [orderIds])
    : Promise.resolve([] as PartRow[]);
const partJson = (parts: PartRow[], orderId: number) =>
  parts.filter((p) => Number(p.repair_order_id) === Number(orderId)).map((p) => ({ name: p.name, quantity: Number(p.quantity) }));

const fileJson = (uuid: string, f: FileRow) => ({ id: Number(f.id), kind: f.kind, name: f.original_name, mime: f.mime, size: Number(f.size), url: `/repair-orders/${uuid}/files/${f.id}` });

function json(r: OrderRow, files: FileRow[], u: UserRow, parts: PartRow[] = []) {
  return {
    id: r.uuid,
    status: r.status,
    item_no: r.item_no,
    item_name: r.item_name,
    symptom: r.symptom,
    item_details: r.item_details,
    document_no: r.document_no,
    brand: r.brand,
    model: r.model,
    // S/N ของสินทรัพย์มาก่อน — ไม่มีจึงใช้ที่กรอกเอง
    serial_number: r.serial_number || r.item_serial,
    item_serial: r.item_serial,
    serial_from_asset: Boolean(r.serial_number),
    holder: r.holder,
    asset_id: r.asset_uuid,
    ticket: r.ticket_uuid ? { id: r.ticket_uuid, ticket_no: r.ticket_no } : null,
    vendor: { id: Number(r.vendor_id), name: r.vendor_name, vendor_type: r.vendor_type, contact_name: r.vendor_contact, contact_phone: r.vendor_phone },
    sent_on: dateOnly(r.sent_on),
    sent_time: r.sent_time,
    // ผู้ส่งซ่อม (เจ้าของอุปกรณ์): ชื่อที่พิมพ์ — แถวเดิมใช้ชื่อผู้ใช้; id = เลือกจากผู้ใช้ในระบบ
    sent_by: { id: r.sent_by_id === null ? null : Number(r.sent_by_id), name: r.sender_name ?? r.sent_by_name ?? "" },
    // ผู้บันทึกงานซ่อม = ผู้สร้างรายการ (เปลี่ยนไม่ได้)
    created_by: { id: Number(r.created_by), name: r.created_by_name },
    // ไม่ผูกสินทรัพย์ / ใบแจ้งงาน = อุปกรณ์ที่ไม่อยู่ในระบบ (กรอกชื่อเอง)
    manual: !r.asset_id && !r.ticket_id,
    // แจ้งเตือนตามงาน: จำนวนวันหลังวันที่ส่งซ่อม → วันกำหนด, ถึงกำหนดแล้วยังไม่รับคืน = follow_up_due
    follow_up_days: Number(r.follow_up_days),
    follow_up_on: dateOnly(r.follow_up_on),
    follow_up_due: r.status === "sent" && (dateOnly(r.follow_up_on) ?? "") <= localToday(),
    returned_at: iso(r.returned_at),
    received_by: r.received_by_id ? { id: Number(r.received_by_id), name: r.received_by_name } : null,
    return_note: r.return_note,
    parts: partJson(parts, r.id),
    cancelled_at: iso(r.cancelled_at),
    cancelled_by: r.cancelled_by_id ? { id: Number(r.cancelled_by_id), name: r.cancelled_by_name } : null,
    cancel_reason: r.cancel_reason,
    files: files.map((f) => fileJson(r.uuid, f)),
    // ส่งซ่อมอยู่เท่านั้น: รับคืน / แก้ไข / ยกเลิก
    can_return: r.status === "sent" && can(u, "repair_orders.manage"),
  };
}

const filesOf = (orderIds: number[]) =>
  orderIds.length ? select<FileRow>("SELECT * FROM repair_order_files WHERE repair_order_id IN (?) ORDER BY id", [orderIds]) : Promise.resolve([] as FileRow[]);

const uploads = (v: unknown): UploadedFile[] =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : [];

async function saveFiles(order: { id: number; uuid: string }, files: UploadedFile[], kind: "send" | "return", userId: number) {
  const now = nowDb();
  for (const file of files) {
    const stored = await storeUploadIn(`repair-orders/${order.uuid}/${kind}`, file);
    await insert("repair_order_files", { repair_order_id: order.id, kind, ...stored, uploaded_by: userId, created_at: now, updated_at: now });
  }
}

async function findOrder(uuid: string): Promise<OrderRow> {
  const row = isUuid(uuid) ? await first<OrderRow>(`${SELECT} WHERE r.uuid = ?`, [uuid]) : null;
  if (!row) throw notFound();
  return row;
}

/** ข้อมูลของที่ส่งซ่อมจากสินทรัพย์ — เลขที่ทรัพย์สิน: คอมพิวเตอร์ = cpu_tag (asset_tag คือ Host Name) */
interface AssetItem {
  id: number;
  uuid: string;
  status: string;
  asset_tag: string;
  cpu_tag: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  user_name: string | null;
}
const ASSET_COLUMNS = "a.id, a.uuid, a.status, a.asset_tag, a.cpu_tag, a.name, a.brand, a.model, a.serial_number, a.user_name";
const assetNo = (a: AssetItem) => a.cpu_tag || a.asset_tag;
const assetById = (id: number) => first<AssetItem>(`SELECT ${ASSET_COLUMNS} FROM assets a WHERE a.id = ? AND a.deleted_at IS NULL`, [id]);

interface TicketItem {
  id: number;
  uuid: string;
  ticket_no: string;
  asset_id: number | null;
  asset_tag: string | null;
  device_name: string | null;
  symptom: string | null;
  requester_id?: number | null;
  requester_name?: string | null;
}
const TICKET_COLUMNS = "t.id, t.uuid, t.ticket_no, t.asset_id, t.asset_tag, t.device_name, t.symptom";
/** ตัวเลือก / ค้นหาในฟอร์มส่งซ่อม: + ผู้แจ้งงาน (เติมเป็นผู้ส่งซ่อมให้) */
const TICKET_LOOKUP_COLUMNS = `${TICKET_COLUMNS}, t.requester_id, (SELECT u.name FROM users u WHERE u.id = t.requester_id) AS requester_name`;
/** ส่งซ่อมจากใบแจ้งงานได้เฉพาะเรื่องซ่อมที่ฝ่าย IT เห็นแล้วและยังไม่ปิด (ก่อนอนุมัติ / ปิดงาน / ไม่อนุมัติ / ยกเลิก = ไม่ได้) */
const SENDABLE_TICKET = `t.type = 'repair' AND t.source IS NULL AND t.status NOT IN (${[...PRE_APPROVAL, "completed", "rejected", "cancelled"].map((s) => `'${s}'`).join(", ")})`;
/** ตัวเลือกในฟอร์มส่งซ่อม — ไม่เกินจำนวนนี้ (ใบเก่ากว่านี้ค้นจากเลขที่ใบแจ้งงานได้) */
const OPEN_TICKETS_MAX = 200;

/** สินทรัพย์ของใบแจ้งซ่อม: ที่ผูกไว้ หรือจับคู่จากเลขที่ผู้แจ้งพิมพ์ */
const assetOfTicket = async (t: TicketItem) => {
  const id = t.asset_id ?? (await assetIdByNumber(t.asset_tag));
  return id ? assetById(Number(id)) : null;
};

const assetLookup = (a: AssetItem) => ({
  kind: "asset" as const,
  asset_id: a.uuid,
  ticket_id: null as string | null,
  ticket_no: null as string | null,
  item_no: assetNo(a) as string | null,
  item_name: a.name,
  brand: a.brand,
  model: a.model,
  serial_number: a.serial_number,
  holder: a.user_name,
  requester: null as { id: number; name: string } | null,
  symptom: null as string | null,
});

const ticketLookup = async (t: TicketItem) => {
  const a = await assetOfTicket(t);
  return {
    ...(a ? assetLookup(a) : { asset_id: null, brand: null, model: null, serial_number: null, holder: null, item_no: t.asset_tag, item_name: t.device_name || t.asset_tag || t.ticket_no }),
    kind: "ticket" as const,
    ticket_id: t.uuid,
    ticket_no: t.ticket_no,
    symptom: t.symptom,
    // ผู้แจ้งงาน = ผู้ส่งซ่อม (เจ้าของอุปกรณ์) ตั้งต้นในฟอร์ม
    requester: t.requester_id && t.requester_name ? { id: Number(t.requester_id), name: t.requester_name } : null,
  };
};

/** รับคืน / ยกเลิก: สินทรัพย์กลับเป็นสถานะก่อนส่งซ่อม — ถ้ามีคนเปลี่ยนสถานะไปแล้วระหว่างซ่อม (ไม่ใช่ in_repair) ไม่ทับ */
const restoreAssetStatus = async (order: OrderRow) => {
  // เครื่องเดียวกันยังมีรายการอื่นส่งซ่อมอยู่ = คงสถานะส่งซ่อม
  if (order.asset_id && (await scalar("SELECT 1 FROM repair_orders WHERE asset_id = ? AND status = 'sent' AND id <> ? LIMIT 1", [order.asset_id, order.id])) !== null) return;
  if (order.asset_id) await update("assets", { status: order.asset_prev_status ?? "active", updated_at: nowDb() }, "id = ? AND status = 'in_repair'", [order.asset_id]);
};

/** เครื่องที่ส่งซ่อมอยู่ (รอรับคืน) ทั้งหมด */
export const pendingRepairOrders = async () => Number(await scalar("SELECT COUNT(*) FROM repair_orders WHERE status = 'sent'"));

/* ------------------------------------------------------------ แจ้งเตือนตามงาน */

/** จำนวนวันตั้งต้น / สูงสุด ของการแจ้งเตือนตามงาน */
export const FOLLOW_UP_DEFAULT_DAYS = 7;
const FOLLOW_UP_MAX_DAYS = 365;
const FOLLOW_UP_RULE: Rule[] = ["nullable", "integer", "min:1", `max:${FOLLOW_UP_MAX_DAYS}`];

/** ส่งซ่อมอยู่และถึงวันกำหนดตามงานแล้ว (follow_up_on = sent_on + follow_up_days, index status + follow_up_on) */
const FOLLOW_UP_DUE = "r.status = 'sent' AND r.follow_up_on <= ?";

/**
 * ผู้ตามงานของแต่ละรายการ = ผู้บันทึก (ยังใช้งานและมี repair_orders.manage) — ไม่เข้าเงื่อนไข = ผู้มี repair_orders.manage ทุกคน (กันงานค้างโดยไม่มีใครรู้)
 * ใช้ทั้งแจ้งเตือนที่กระดิ่ง และตัวเลขเมนู / แท็บ (เงื่อนไขเดียวกัน)
 */
async function followUpWatchers(): Promise<{ managers: number[]; of: (createdBy: number) => number[] }> {
  const managers = (await usersWithPermissions(["repair_orders.manage"])).map((p) => Number(p.id));
  const set = new Set(managers);
  return { managers, of: (createdBy) => (set.has(Number(createdBy)) ? [Number(createdBy)] : managers) };
}

/**
 * บันทึกผลใบแจ้งซ่อม "ซ่อมโดยช่างภายนอก" — รายการส่งซ่อม/เคลม (ไม่รวมที่ยกเลิก) ของใบงานนี้ หรือของสินทรัพย์เครื่องเดียวกัน
 * เลือกแล้วหน้าเว็บเติมชื่อ Vendor + รายละเอียดการซ่อม (อาการ / ผลรับคืน) — ล่าสุดก่อน ≤ 20
 */
export async function repairOrdersForTicket(ticketId: number, assetId: number | null) {
  const rows = await select<{ id: number; uuid: string; ticket_id: number | null; status: string; vendor_name: string; document_no: string | null; item_name: string; symptom: string; return_note: string | null; sent_on: string; sent_time: string; returned_at: string | null }>(
    `SELECT r.id, r.uuid, r.ticket_id, r.status, v.name AS vendor_name, r.document_no, r.item_name, r.symptom, r.return_note, r.sent_on, r.sent_time, r.returned_at
      FROM repair_orders r JOIN vendors v ON v.id = r.vendor_id
      WHERE r.status <> 'cancelled' AND (r.ticket_id = ?${assetId ? " OR r.asset_id = ?" : ""})
      ORDER BY r.ticket_id = ? DESC, r.sent_on DESC, r.id DESC LIMIT 20`,
    assetId ? [ticketId, assetId, ticketId] : [ticketId, ticketId],
  );
  const parts = await partsOf(rows.map((r) => Number(r.id)));
  return rows.map((r) => ({
    id: r.uuid,
    // ส่งซ่อมจากใบงานนี้เอง (ไม่ใช่แค่เครื่องเดียวกัน) — บันทึกผลตั้งต้นเป็นช่างภายนอก + เลือกรายการนี้ให้
    own: Number(r.ticket_id) === Number(ticketId),
    status: r.status as "sent" | "returned",
    vendor: r.vendor_name,
    document_no: r.document_no,
    item_name: r.item_name,
    symptom: r.symptom,
    return_note: r.return_note,
    sent_on: dateOnly(r.sent_on),
    sent_time: r.sent_time,
    returned_at: iso(r.returned_at),
    parts: partJson(parts, r.id),
  }));
}

/** อะไหล่ที่ร้านเปลี่ยนของรายการส่งซ่อมที่รับคืนแล้วของใบงานนี้ — แบบฟอร์มพิมพ์ใช้เมื่อผลงานไม่มีรายการอะไหล่ */
export const returnedPartsForTicket = async (ticketId: number) =>
  (
    await select<PartRow>(
      "SELECT p.repair_order_id, p.name, p.quantity FROM repair_order_parts p JOIN repair_orders r ON r.id = p.repair_order_id WHERE r.ticket_id = ? AND r.status = 'returned' ORDER BY r.returned_at, p.id",
      [ticketId],
    )
  ).map((p) => ({ name: p.name, quantity: Number(p.quantity) }));

/** อัปเดตความคืบหน้าใบงาน: รายการส่งซ่อมที่อ้างได้ = ของใบนี้ / เครื่องเดียวกัน ไม่รวมที่ยกเลิก */
export const repairOrderIdForTicket = async (uuid: string, ticketId: number, assetId: number | null) =>
  isUuid(uuid)
    ? ((await scalar<number>(
        `SELECT id FROM repair_orders WHERE uuid = ? AND status <> 'cancelled' AND (ticket_id = ?${assetId ? " OR asset_id = ?" : ""})`,
        assetId ? [uuid, ticketId, assetId] : [uuid, ticketId],
      )) ?? null)
    : null;

/** ตัวเลขเมนู /it/repair-orders + แท็บ "ส่งซ่อมอยู่" = รายการที่ถึงกำหนดตามงานและฉันเป็นผู้ตามงาน */
export async function dueFollowUpCount(u: UserRow): Promise<number> {
  if (!can(u, "repair_orders.manage")) return 0;
  const rows = await select<{ created_by: number }>(`SELECT r.created_by FROM repair_orders r WHERE ${FOLLOW_UP_DUE}`, [localToday()]);
  if (!rows.length) return 0;
  const w = await followUpWatchers();
  return rows.filter((r) => w.of(r.created_by).includes(u.id)).length;
}

/** scheduler ทุกชั่วโมง: ถึงกำหนดตามงานแล้วยังไม่รับคืน → แจ้งผู้ตามงานที่กระดิ่ง ครั้งเดียวต่อวันกำหนด (follow_up_notified_for) */
export async function notifyRepairFollowUps(): Promise<number> {
  const rows = await select<OrderRow & { follow_up_notified_for: string | null }>(
    `${SELECT} WHERE ${FOLLOW_UP_DUE} AND (r.follow_up_notified_for IS NULL OR r.follow_up_notified_for <> r.follow_up_on) ORDER BY r.follow_up_on, r.id`,
    [localToday()],
  );
  if (!rows.length) return 0;
  const w = await followUpWatchers();
  for (const r of rows) {
    // แจ้งเตือนตามงานของวันกำหนดเดิม (ก่อนแก้จำนวนวัน) อ่านแล้ว — เหลือรายการล่าสุดรายการเดียว
    await markNoticesRead("repair_order_id", r.uuid, { events: ["follow_up"] });
    await notifyUsers(w.of(r.created_by), "repair_order.follow_up", {
      kind: "repair_order",
      event: "follow_up",
      repair_order_id: r.uuid,
      item: r.item_name,
      vendor: r.vendor_name,
      sent_on: dateOnly(r.sent_on),
      days: Number(r.follow_up_days),
    });
    await exec("UPDATE repair_orders SET follow_up_notified_for = follow_up_on WHERE id = ?", [r.id]);
  }
  return rows.length;
}

/** บันทึกลงประวัติใบแจ้งงาน — แจ้งเตือน (notify) เรียกหลัง commit */
async function logOnTicket(ticketId: number, orderId: number, userId: number, action: "repair_sent" | "repair_returned" | "repair_updated" | "repair_cancelled", comment: string) {
  const now = nowDb();
  await update("it_tickets", { updated_at: now }, "id = ?", [ticketId]);
  await insert("it_ticket_events", { it_ticket_id: ticketId, user_id: userId, action, comment, repair_order_id: orderId, created_at: now });
}
const ticketForNotify = (ticketId: number) => first<TicketRow>(`SELECT t.*, ${TICKET_APPROVAL_COLUMNS} FROM it_tickets t WHERE t.id = ?`, [ticketId]);

const respond = async (req: Request, orderId: number) => {
  const row = (await first<OrderRow>(`${SELECT} WHERE r.id = ?`, [orderId]))!;
  return json(row, await filesOf([orderId]), me(req), await partsOf([orderId]));
};

/** ฟอร์มส่งซ่อม: vendor ที่เปิดใช้งาน + เจ้าหน้าที่ IT (ผู้ส่งซ่อม) + ใบแจ้งซ่อมที่ยังไม่ปิด (ส่งซ่อมอยู่แล้วก็ส่งเพิ่มได้) */
repairOrderRoutes.get("/repair-orders/form-options", async (req, res) => {
  authorize(can(me(req), "repair_orders.manage"));
  const [vendors, staff, tickets] = await Promise.all([
    select<{ id: number; name: string; vendor_type: string }>("SELECT id, name, vendor_type FROM vendors WHERE is_active = true AND deleted_at IS NULL ORDER BY name"),
    itStaffOptions(),
    select<TicketItem>(
      `SELECT ${TICKET_LOOKUP_COLUMNS} FROM it_tickets t
        WHERE ${SENDABLE_TICKET}
        ORDER BY t.id DESC LIMIT ${OPEN_TICKETS_MAX}`,
    ),
  ]);
  res.json({
    data: {
      vendors: vendors.map((v) => ({ id: Number(v.id), name: v.name, vendor_type: v.vendor_type })),
      staff: staff.map((s) => ({ id: Number(s.id), name: s.name })),
      tickets: await Promise.all(tickets.map(ticketLookup)),
    },
  });
});

/** ค้นหาของที่จะส่งซ่อม — ตามเลข/ชื่อสินทรัพย์ หรือเลขที่ใบแจ้งงาน (ใบที่กำลังซ่อม) */
repairOrderRoutes.get("/repair-orders/lookup", async (req, res) => {
  authorize(can(me(req), "repair_orders.manage"));
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (!q) return res.json({ data: [] });
  const like = `%${likeEscape(q)}%`;
  const tickets = await select<TicketItem>(
    `SELECT ${TICKET_LOOKUP_COLUMNS} FROM it_tickets t
      WHERE ${SENDABLE_TICKET} AND (t.ticket_no LIKE ? OR t.asset_tag LIKE ? OR t.device_name LIKE ?
        OR EXISTS (SELECT 1 FROM assets a WHERE a.id = t.asset_id AND (a.asset_tag LIKE ? OR a.cpu_tag LIKE ? OR a.monitor_tag LIKE ?)))
      ORDER BY t.id DESC LIMIT 10`,
    [like, like, like, like, like, like],
  );
  const assets = await select<AssetItem>(
    `SELECT ${ASSET_COLUMNS} FROM assets a WHERE a.deleted_at IS NULL AND a.status NOT IN ('lost', 'disposed') AND (a.asset_tag LIKE ? OR a.cpu_tag LIKE ? OR a.monitor_tag LIKE ? OR a.name LIKE ? OR a.serial_number LIKE ?) ORDER BY a.asset_tag LIMIT 10`,
    [like, like, like, like, like],
  );
  res.json({ data: [...(await Promise.all(tickets.map(ticketLookup))), ...assets.map(assetLookup)] });
});

/** ช่องผู้ส่งซ่อม (เจ้าของอุปกรณ์): ผู้ใช้ที่ใช้งานอยู่ซึ่งชื่อ / อีเมล / แผนก ตรงกับที่พิมพ์ (≤ 10) */
repairOrderRoutes.get("/repair-orders/people", async (req, res) => {
  authorize(can(me(req), "repair_orders.manage"));
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (!q) return res.json({ data: [] });
  const like = `%${likeEscape(q)}%`;
  const rows = await select<{ id: number; name: string; department: string | null }>(
    "SELECT id, name, department FROM users WHERE is_active = true AND (name LIKE ? OR email LIKE ? OR department LIKE ?) ORDER BY name LIMIT 10",
    [like, like, like],
  );
  res.json({ data: rows.map((r) => ({ id: Number(r.id), name: r.name, department: r.department })) });
});

/**
 * ผู้ส่งซ่อม (เจ้าของอุปกรณ์): พิมพ์ชื่อเอง (sender_name — บังคับ) หรือเลือกจากผู้ใช้ในระบบ (sent_by_id — ชื่อใช้ตามผู้ใช้)
 * keepId = ค่าเดิมของรายการ (ผู้ใช้ที่ถูกปิดใช้งานไปแล้วคงไว้ได้)
 */
async function senderOf(req: Request, data: Record<string, unknown>, keepId: number | null = null): Promise<{ sent_by_id: number | null; sender_name: string }> {
  const id = int(data.sent_by_id);
  if (id) {
    const user = await first<{ name: string; is_active: number | boolean }>("SELECT name, is_active FROM users WHERE id = ?", [id]);
    if (!user || (!user.is_active && id !== keepId)) throw ValidationError.withMessages({ sent_by_id: trans(req.locale, "eam.repair_order.sender_inactive") });
    return { sent_by_id: id, sender_name: user.name };
  }
  const name = String(data.sender_name ?? "").trim();
  if (!name) throw ValidationError.withMessages({ sent_by_id: trans(req.locale, "eam.repair_order.sender_required") });
  return { sent_by_id: null, sender_name: name };
}

repairOrderRoutes.get("/repair-orders", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.view"));
  const status = STATUSES.includes(String(req.query.status)) ? String(req.query.status) : "sent";
  const where = ["r.status = ?"];
  const params: unknown[] = [status];
  const search = String(req.query.search ?? "").trim().slice(0, 100);
  if (search) {
    const like = `%${likeEscape(search)}%`;
    where.push("(r.item_no LIKE ? OR r.item_name LIKE ? OR r.symptom LIKE ? OR r.item_details LIKE ? OR r.document_no LIKE ? OR r.item_serial LIKE ? OR v.name LIKE ? OR t.ticket_no LIKE ? OR a.serial_number LIKE ?)");
    params.push(like, like, like, like, like, like, like, like, like);
  }
  const page = pageParam(req);
  const from = `FROM repair_orders r JOIN vendors v ON v.id = r.vendor_id LEFT JOIN assets a ON a.id = r.asset_id LEFT JOIN it_tickets t ON t.id = r.ticket_id WHERE ${where.join(" AND ")}`;
  const total = Number(await scalar(`SELECT COUNT(*) ${from}`, params));
  const order = status === "sent" ? "r.sent_on, r.sent_time, r.id" : status === "returned" ? "r.returned_at DESC, r.id DESC" : "r.cancelled_at DESC, r.id DESC";
  const rows = await select<OrderRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params);
  const files = await filesOf(rows.map((r) => Number(r.id)));
  const parts = await partsOf(rows.map((r) => Number(r.id)));
  res.json({
    data: rows.map((r) => json(r, files.filter((f) => Number(f.repair_order_id) === Number(r.id)), u, parts)),
    meta: { ...shortMeta(total, page, PER_PAGE, rows.length), counts: { sent: await dueFollowUpCount(u) } },
  });
});

repairOrderRoutes.get("/repair-orders/:uuid", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.view"));
  const row = await findOrder(req.params.uuid);
  res.json({ data: json(row, await filesOf([Number(row.id)]), u) });
});

repairOrderRoutes.get("/repair-orders/:uuid/files/:id", async (req, res) => {
  authorize(can(me(req), "repair_orders.view"));
  const order = await findOrder(req.params.uuid);
  const file = /^\d+$/.test(req.params.id) ? await first<FileRow>("SELECT * FROM repair_order_files WHERE id = ? AND repair_order_id = ?", [Number(req.params.id), order.id]) : null;
  if (!file) throw notFound();
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

/**
 * ส่งซ่อม (multipart): ticket หรือ asset (uuid) — หรือ manual = อุปกรณ์ที่ไม่อยู่ในระบบ (item_name บังคับ + item_details)
 * + symptom + vendor_id + sent_on + sent_time + ผู้ส่งซ่อม (sender_name / sent_by_id — senderOf) + files[]; ผู้บันทึก = ผู้ที่ login
 */
repairOrderRoutes.post("/repair-orders", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.manage"));
  const data = await validate(
    req.input,
    {
      ticket: ["nullable", "string", "max:36"],
      asset: ["nullable", "string", "max:36"],
      manual: ["nullable", "boolean"],
      item_name: ["nullable", "string", "max:255"],
      symptom: ["required", "string", "max:2000"],
      item_details: ["nullable", "string", "max:2000"],
      document_no: ["nullable", "string", "max:100"],
      serial_number: ["nullable", "string", "max:100"],
      follow_up_days: FOLLOW_UP_RULE,
      vendor_id: ["required", "integer", exists("vendors", "id", "is_active = true AND deleted_at IS NULL")],
      sent_on: ["required", regex(DATE)],
      sent_time: ["required", regex(TIME)],
      sent_by_id: ["nullable", "integer"],
      sender_name: ["nullable", "string", "max:255"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
    },
    { locale: req.locale },
  );

  const fail = (key: string): never => {
    throw ValidationError.withMessages({ item: trans(req.locale, `eam.repair_order.${key}`) });
  };
  const manual = data.manual === true || data.manual === "1" || data.manual === "true";
  const ticketUuid = manual ? "" : String(data.ticket ?? "");
  const assetUuid = manual ? "" : String(data.asset ?? "");
  const manualName = String(data.item_name ?? "").trim();
  if (manual && !manualName) throw ValidationError.withMessages({ item_name: trans(req.locale, "eam.repair_order.item_name_required") });
  if (!manual && !ticketUuid && !assetUuid) fail("item_required");
  const sender = await senderOf(req, data);

  const created = await transaction(async () => {
    await lockNamed("repair_orders");
    let ticket: TicketItem | null = null;
    let asset: AssetItem | null = null;
    if (manual) {
      // อุปกรณ์ที่ไม่อยู่ในระบบ — ไม่ผูกสินทรัพย์ / ใบแจ้งงาน
    } else if (ticketUuid) {
      ticket = isUuid(ticketUuid) ? await first<TicketItem>(`SELECT ${TICKET_COLUMNS} FROM it_tickets t WHERE t.uuid = ? AND ${SENDABLE_TICKET} FOR UPDATE`, [ticketUuid]) : null;
      if (!ticket) return fail("ticket_not_sendable");
      asset = await assetOfTicket(ticket);
    } else {
      asset = isUuid(assetUuid) ? await first<AssetItem>(`SELECT ${ASSET_COLUMNS} FROM assets a WHERE a.uuid = ? AND a.deleted_at IS NULL`, [assetUuid]) : null;
      if (!asset) return fail("item_required");
    }
    if (asset && ["lost", "disposed"].includes(asset.status)) fail("asset_not_sendable");
    // ใบงาน / เครื่องเดียวกันส่งซ่อม-เคลมได้หลายรายการพร้อมกัน (เช่น เคลมจอ + ซ่อมเครื่องคนละร้าน)
    // สถานะก่อนส่งซ่อมของเครื่อง = ของรายการที่ยังส่งอยู่ก่อนหน้า (เครื่องเป็น in_repair เพราะรายการนั้น)
    const openPrev = asset
      ? await first<{ asset_prev_status: string | null }>("SELECT asset_prev_status FROM repair_orders WHERE asset_id = ? AND status = 'sent' ORDER BY id LIMIT 1", [asset.id])
      : null;

    const now = nowDb();
    const uuid = randomUUID();
    const itemName = manual ? manualName : asset?.name ?? (ticket!.device_name || ticket!.asset_tag || ticket!.ticket_no);
    const id = await insert("repair_orders", {
      uuid,
      asset_id: asset?.id ?? null,
      ticket_id: ticket?.id ?? null,
      item_no: manual ? null : asset ? assetNo(asset) : ticket!.asset_tag,
      item_name: itemName,
      symptom: String(data.symptom).trim(),
      item_details: String(data.item_details ?? "").trim() || null,
      document_no: String(data.document_no ?? "").trim() || null,
      item_serial: asset?.serial_number ? null : String(data.serial_number ?? "").trim() || null,
      vendor_id: int(data.vendor_id),
      sent_on: data.sent_on,
      sent_time: data.sent_time,
      follow_up_days: int(data.follow_up_days) ?? FOLLOW_UP_DEFAULT_DAYS,
      ...sender,
      status: "sent",
      // เดิมตั้ง "ส่งซ่อม" ไว้เองแล้ว = รับคืนกลับเป็น "ใช้งาน"
      asset_prev_status: asset ? (openPrev ? (openPrev.asset_prev_status ?? "active") : asset.status === "in_repair" ? "active" : asset.status) : null,
      created_by: u.id,
      created_at: now,
      updated_at: now,
    });
    if (asset) await update("assets", { status: "in_repair", updated_at: now }, "id = ?", [asset.id]);
    await saveFiles({ id, uuid }, uploads(data.files), "send", u.id);
    if (ticket) {
      const vendor = await scalar<string>("SELECT name FROM vendors WHERE id = ?", [int(data.vendor_id)]);
      const when = `${displayDate(String(data.sent_on), req.locale)} ${data.sent_time}`;
      await logOnTicket(ticket.id, id, u.id, "repair_sent", trans(req.locale, "eam.repair_order.sent_comment", { item: itemName, vendor: String(vendor), when }));
    }
    return { id, ticketId: ticket?.id ?? null };
  });

  await audit(req, { action: "repair_order.created", subjectType: "repair_order", subjectId: created.id, after: { ticket_id: created.ticketId, document_no: data.document_no ?? null, vendor_id: int(data.vendor_id), sent_on: data.sent_on, sent_time: data.sent_time, ...sender, manual } });
  if (created.ticketId) await notify((await ticketForNotify(created.ticketId))!, "repair_sent", u);
  res.status(201).json({ data: await respond(req, created.id) });
});

/** ล็อกแถวแล้วตรวจว่ายังส่งซ่อมอยู่ — ต้องเรียกใน transaction */
async function assertStillSent(req: Request, orderId: number) {
  const current = await scalar<string>("SELECT status FROM repair_orders WHERE id = ? FOR UPDATE", [orderId]);
  if (current !== "sent") throw ValidationError.withMessages({ status: trans(req.locale, "eam.repair_order.not_editable") });
}

/** แก้ไขรายการที่ส่งซ่อมอยู่ (multipart) — เปลี่ยนของที่ส่งไม่ได้ (ยกเลิกแล้วส่งใหม่); เปลี่ยน Vendor / วันเวลา = ลงประวัติใบงาน + แจ้งเตือน */
repairOrderRoutes.put("/repair-orders/:uuid", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.manage"));
  const order = await findOrder(req.params.uuid);
  const data = await validate(
    req.input,
    {
      symptom: ["required", "string", "max:2000"],
      item_details: ["nullable", "string", "max:2000"],
      document_no: ["nullable", "string", "max:100"],
      serial_number: ["nullable", "string", "max:100"],
      follow_up_days: FOLLOW_UP_RULE,
      vendor_id: ["required", "integer", exists("vendors", "id", "deleted_at IS NULL")],
      sent_on: ["required", regex(DATE)],
      sent_time: ["required", regex(TIME)],
      sent_by_id: ["nullable", "integer"],
      sender_name: ["nullable", "string", "max:255"],
      // อุปกรณ์ที่ไม่อยู่ในระบบ: แก้ชื่ออุปกรณ์ได้ (ของที่ผูกสินทรัพย์ / ใบงาน เปลี่ยนไม่ได้)
      item_name: ["nullable", "string", "max:255"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
      remove_file_ids: ["nullable", "array"],
      "remove_file_ids.*": ["integer"],
    },
    { locale: req.locale },
  );
  const vendorId = int(data.vendor_id)!;
  // ค่าเดิมที่ถูกปิดใช้งานไปแล้วคงไว้ได้ — เปลี่ยนใหม่ต้องเป็นที่เปิดใช้งาน
  if (vendorId !== Number(order.vendor_id) && (await scalar("SELECT 1 FROM vendors WHERE id = ? AND is_active = true", [vendorId])) === null) {
    throw ValidationError.withMessages({ vendor_id: trans(req.locale, "eam.repair_order.vendor_inactive") });
  }
  const sender = await senderOf(req, data, order.sent_by_id === null ? null : Number(order.sent_by_id));
  const manual = !order.asset_id && !order.ticket_id;
  const itemName = manual ? String(data.item_name ?? "").trim() || order.item_name : order.item_name;
  const before = { item_name: order.item_name, symptom: order.symptom, item_details: order.item_details, document_no: order.document_no, item_serial: order.item_serial, vendor_id: Number(order.vendor_id), sent_on: dateOnly(order.sent_on), sent_time: order.sent_time, sent_by_id: order.sent_by_id === null ? null : Number(order.sent_by_id), sender_name: order.sender_name, follow_up_days: Number(order.follow_up_days) };
  const after = { item_name: itemName, symptom: String(data.symptom).trim(), item_details: String(data.item_details ?? "").trim() || null, document_no: String(data.document_no ?? "").trim() || null, item_serial: order.serial_number ? null : String(data.serial_number ?? "").trim() || null, vendor_id: vendorId, sent_on: String(data.sent_on), sent_time: String(data.sent_time), ...sender, follow_up_days: int(data.follow_up_days) ?? Number(order.follow_up_days) };
  const announced = before.vendor_id !== after.vendor_id || before.sent_on !== after.sent_on || before.sent_time !== after.sent_time;
  const removeIds = Object.values((data.remove_file_ids ?? {}) as Record<string, unknown>).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let removed: FileRow[] = [];

  await transaction(async () => {
    await assertStillSent(req, Number(order.id));
    const now = nowDb();
    await update("repair_orders", { ...after, updated_at: now }, "id = ?", [order.id]);
    removed = removeIds.length ? await select<FileRow>("SELECT * FROM repair_order_files WHERE repair_order_id = ? AND kind = 'send' AND id IN (?)", [order.id, removeIds]) : [];
    if (removed.length) await exec("DELETE FROM repair_order_files WHERE id IN (?)", [removed.map((f) => f.id)]);
    await saveFiles(order, uploads(data.files), "send", u.id);
    if (order.ticket_id && announced) {
      const vendor = await scalar<string>("SELECT name FROM vendors WHERE id = ?", [vendorId]);
      const when = `${displayDate(after.sent_on, req.locale)} ${after.sent_time}`;
      await logOnTicket(Number(order.ticket_id), Number(order.id), u.id, "repair_updated", trans(req.locale, "eam.repair_order.updated_comment", { item: order.item_name, vendor: String(vendor), when }));
    }
  });

  for (const f of removed) await deleteStored(f.path);
  // เปลี่ยนวันกำหนดตามงาน (วันที่ส่ง / จำนวนวัน) = แจ้งเตือนเดิมอ่านแล้ว — ถึงกำหนดใหม่ scheduler แจ้งอีกครั้ง
  if (before.sent_on !== after.sent_on || before.follow_up_days !== after.follow_up_days) await markNoticesRead("repair_order_id", order.uuid, { events: ["follow_up"] });
  await audit(req, { action: "repair_order.updated", subjectType: "repair_order", subjectId: order.id, before, after: { ...after, removed_files: removed.map((f) => f.original_name) } });
  if (order.ticket_id && announced) await notify((await ticketForNotify(Number(order.ticket_id)))!, "repair_updated", u);
  res.json({ data: await respond(req, Number(order.id)) });
});

/** ยกเลิกรายการที่ส่งซ่อมอยู่ (ต้องมีเหตุผล) — เก็บแถวไว้เป็นประวัติ, สินทรัพย์กลับสถานะเดิม, ลงประวัติใบงาน + แจ้งเตือน */
repairOrderRoutes.post("/repair-orders/:uuid/cancel", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.manage"));
  const order = await findOrder(req.params.uuid);
  const data = await validate(req.input, { reason: ["required", "string", "max:2000"] }, { locale: req.locale });
  const reason = String(data.reason).trim();
  if (!reason) throw ValidationError.withMessages({ reason: trans(req.locale, "eam.repair_order.reason_required") });

  await transaction(async () => {
    await assertStillSent(req, Number(order.id));
    const now = nowDb();
    await update("repair_orders", { status: "cancelled", cancelled_at: now, cancelled_by_id: u.id, cancel_reason: reason, updated_at: now }, "id = ?", [order.id]);
    await restoreAssetStatus(order);
    if (order.ticket_id) await logOnTicket(Number(order.ticket_id), Number(order.id), u.id, "repair_cancelled", trans(req.locale, "eam.repair_order.cancelled_comment", { item: order.item_name, vendor: order.vendor_name, reason }));
  });

  await markNoticesRead("repair_order_id", order.uuid);
  await audit(req, { action: "repair_order.cancelled", subjectType: "repair_order", subjectId: order.id, after: { ticket_id: order.ticket_id, reason } });
  if (order.ticket_id) await notify((await ticketForNotify(Number(order.ticket_id)))!, "repair_cancelled", u);
  res.json({ data: await respond(req, Number(order.id)) });
});

/** รับเครื่องคืน (multipart): return_note + parts[i][name|quantity] (อะไหล่ที่ร้านเปลี่ยน — แถวชื่อว่างข้าม) + files[] — ลงประวัติใบงานแม้ใบงานปิดไปแล้ว */
repairOrderRoutes.post("/repair-orders/:uuid/return", async (req, res) => {
  const u = me(req);
  authorize(can(u, "repair_orders.manage"));
  const order = await findOrder(req.params.uuid);
  const data = await validate(
    req.input,
    {
      return_note: ["nullable", "string", "max:2000"],
      parts: ["nullable", "array", `max:${PARTS_MAX}`],
      "parts.*.name": ["nullable", "string", "max:255"],
      "parts.*.quantity": ["nullable", "integer", "min:1", "max:999"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
    },
    { locale: req.locale },
  );
  const parts = Object.values((data.parts ?? {}) as Record<string, Record<string, unknown>>)
    .map((p) => ({ name: String(p?.name ?? "").trim(), quantity: Number(p?.quantity) || 1 }))
    .filter((p) => p.name);

  await transaction(async () => {
    const current = await scalar<string>("SELECT status FROM repair_orders WHERE id = ? FOR UPDATE", [order.id]);
    if (current !== "sent") throw ValidationError.withMessages({ status: trans(req.locale, "eam.repair_order.already_returned") });
    const now = nowDb();
    await update("repair_orders", { status: "returned", returned_at: now, received_by_id: u.id, return_note: String(data.return_note ?? "").trim() || null, updated_at: now }, "id = ?", [order.id]);
    await restoreAssetStatus(order);
    await saveFiles(order, uploads(data.files), "return", u.id);
    for (const p of parts) await insert("repair_order_parts", { repair_order_id: order.id, name: p.name, quantity: p.quantity, created_at: now });
    if (order.ticket_id) await logOnTicket(Number(order.ticket_id), Number(order.id), u.id, "repair_returned", trans(req.locale, "eam.repair_order.returned_comment", { item: order.item_name, vendor: order.vendor_name }));
  });

  // รับคืนแล้ว = แจ้งเตือนตามงานจบ
  await markNoticesRead("repair_order_id", order.uuid);
  await audit(req, { action: "repair_order.returned", subjectType: "repair_order", subjectId: order.id, after: { ticket_id: order.ticket_id, parts } });
  if (order.ticket_id) await notify((await ticketForNotify(Number(order.ticket_id)))!, "repair_returned", u);
  res.json({ data: await respond(req, Number(order.id)) });
});
