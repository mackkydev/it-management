import { exec, first, insert, isUuid, select, update } from "../db.js";
import { ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import { localToday, nowDb } from "../lib/time.js";
import { activeCount } from "./licenses.js";

/**
 * ซอฟต์แวร์ที่ติดตั้งบนเครื่อง (ฟอร์มสินทรัพย์หมวดคอมพิวเตอร์)
 * - OS / Office / Anti Virus / Software อื่นๆ เลือกจาก License (ตาราง licenses)
 * - เก็บเป็น license_installations ของเครื่องนี้ (slot = os / office / antivirus, NULL = อื่นๆ) → นับ seat ใช้ไป/คงเหลือ
 * - ช่องข้อความ assets.os / office / antivirus = ชื่อ license ที่ผูก (ใช้ในรายการ/Excel) — ค่าจาก Excel ที่ยังไม่ผูกคงไว้ได้
 */
export const SOFTWARE_SLOTS = ["os", "office", "antivirus"] as const;
export type SoftwareSlot = (typeof SOFTWARE_SLOTS)[number];

export interface SoftwareRef {
  id: string;
  license_no: string | null;
  name: string;
  software_type?: string;
}
export type SoftwareSet = Record<SoftwareSlot, SoftwareRef | null> & { others: SoftwareRef[] };

interface InstalledRow {
  id: number;
  license_id: number;
  slot: string | null;
  uuid: string;
  license_no: string | null;
  name: string;
  software_type: string | null;
}

const installedOn = (assetId: number) =>
  select<InstalledRow>(
    `SELECT i.id, i.license_id, i.slot, li.uuid, li.license_no, li.name, li.software_type
       FROM license_installations i JOIN licenses li ON li.id = i.license_id AND li.deleted_at IS NULL
      WHERE i.device_asset_id = ? AND i.uninstalled_at IS NULL
      ORDER BY i.installed_at, i.id`,
    [assetId],
  );

/**
 * ซอฟต์แวร์ที่ติดตั้งอยู่บนเครื่อง (ใช้งานอยู่) แยกตามช่อง — ช่องที่บันทึกไว้ก่อน แล้วรายการที่ไม่มีช่อง (เช่น นำเข้า Excel / เลือกใน "อื่นๆ")
 * ลงช่องตามประเภทของ License (software_type os / office / antivirus) ถ้าช่องนั้นยังว่าง — ที่เหลือ = Software อื่นๆ
 */
export async function loadSoftware(assetId: number): Promise<SoftwareSet> {
  const out: SoftwareSet = { os: null, office: null, antivirus: null, others: [] };
  const rows = await installedOn(assetId);
  const isSlot = (v: string | null): v is SoftwareSlot => (SOFTWARE_SLOTS as readonly string[]).includes(v ?? "");
  const ref = (r: InstalledRow): SoftwareRef => ({ id: r.uuid, license_no: r.license_no, name: r.name, software_type: r.software_type ?? "other" });
  const rest: InstalledRow[] = [];
  for (const r of rows) {
    if (isSlot(r.slot) && !out[r.slot]) out[r.slot] = ref(r);
    else rest.push(r);
  }
  for (const r of rest) {
    if (isSlot(r.software_type) && !out[r.software_type]) out[r.software_type] = ref(r);
    else out.others.push(ref(r));
  }
  return out;
}

/** license ทั้งหมด (Software ที่มีข้อมูล license) + จำนวนที่ใช้/คงเหลือ — ตัวเลือกในฟอร์ม */
export async function softwareOptions() {
  const rows = await select<{ uuid: string; license_no: string | null; serial_number: string | null; name: string; model: string | null; seats: number | null; used: number; software_type: string }>(
    `SELECT li.uuid, li.license_no, li.serial_number, li.name, li.model, li.seats, li.software_type,
            (SELECT COUNT(*) FROM license_installations i WHERE i.license_id = li.id AND i.uninstalled_at IS NULL) AS used
       FROM licenses li
      WHERE li.deleted_at IS NULL
      ORDER BY li.name, li.id`,
  );
  return rows.map((r) => ({
    id: r.uuid,
    license_no: r.license_no,
    serial_number: r.serial_number,
    name: r.name,
    model: r.model,
    software_type: r.software_type,
    seats: r.seats,
    used: Number(r.used),
    available: r.seats === null ? null : Math.max(0, r.seats - Number(r.used)),
  }));
}

/** input.software → { os, office, antivirus, others } เป็น uuid (ค่าที่ไม่ใช่ uuid ถูกทิ้ง) */
export function parseSoftwareInput(v: unknown): Record<SoftwareSlot, string | null> & { others: string[] } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const id = (x: unknown) => (typeof x === "string" && isUuid(x) ? x : null);
  return {
    os: id(o.os),
    office: id(o.office),
    antivirus: id(o.antivirus),
    others: Array.isArray(o.others) ? [...new Set(o.others.map(id).filter((x): x is string => Boolean(x)))].slice(0, 50) : [],
  };
}

/** ตรวจว่า uuid ทุกตัวเป็น license จริง — คืน error ต่อช่อง */
export async function softwareErrors(input: unknown, locale: Locale): Promise<Record<string, string>> {
  const want = parseSoftwareInput(input);
  const ids = [...SOFTWARE_SLOTS.map((s) => want[s]), ...want.others].filter((x): x is string => Boolean(x));
  if (!ids.length) return {};
  const found = new Set(
    (await select<{ uuid: string }>(
      "SELECT uuid FROM licenses WHERE uuid IN (?) AND deleted_at IS NULL",
      [ids],
    )).map((r) => r.uuid),
  );
  const errors: Record<string, string> = {};
  for (const s of SOFTWARE_SLOTS) if (want[s] && !found.has(want[s]!)) errors[`software.${s}`] = trans(locale, "eam.license.not_license");
  if (want.others.some((x) => !found.has(x))) errors["software.others"] = trans(locale, "eam.license.not_license");
  return errors;
}

/** license ที่ต้องการให้ติดตั้งบนเครื่อง (ช่อง null = Software อื่นๆ) */
export interface WantedInstall {
  slot: SoftwareSlot | null;
  id: number;
  name: string;
}

const slotOf = (slot: string | null): SoftwareSlot | null => ((SOFTWARE_SLOTS as readonly string[]).includes(slot ?? "") ? (slot as SoftwareSlot) : null);

/**
 * ให้การติดตั้งบนเครื่องตรงกับที่ต้องการ — แตะเฉพาะช่องใน scope (null = Software อื่นๆ)
 * - ตัวที่มีอยู่แล้ว = คงไว้ (ปรับช่องถ้าย้ายช่อง), ตัวใหม่ = ติดตั้งวันนี้ (ตรวจ seat), ตัวที่เอาออก = ถอนการติดตั้งวันนี้ (เก็บประวัติ)
 * - seat เต็ม → onFull: throw = ยกเลิกทั้งหมด (ฟอร์ม) / ไม่ throw = ข้ามรายการนั้น (นำเข้า Excel)
 * - คืนรายการที่ติดตั้งอยู่หลังบันทึก (ไม่รวมตัวที่ข้ามเพราะ seat เต็ม)
 */
export async function applyInstallations(
  device: { id: number; custodian_id: number | null; branch_id: number | null },
  wanted: WantedInstall[],
  scope: ReadonlySet<SoftwareSlot | null>,
  userId: number,
  onFull: (w: WantedInstall, seats: number) => void,
): Promise<Set<WantedInstall>> {
  const current = await installedOn(device.id);
  const kept = new Set<number>();
  const applied = new Set<WantedInstall>();
  const today = localToday();

  for (const w of wanted) {
    const existing = current.find((c) => !kept.has(c.id) && c.license_id === w.id && slotOf(c.slot) === w.slot) ?? current.find((c) => !kept.has(c.id) && c.license_id === w.id);
    if (existing) {
      kept.add(existing.id);
      applied.add(w);
      if (existing.slot !== w.slot) await update("license_installations", { slot: w.slot, updated_at: nowDb() }, "id = ?", [existing.id]);
      continue;
    }
    // ล็อกแถว license กันติดตั้งพร้อมกันจนเกินจำนวน seat
    const locked = await first<{ seats: number | null }>("SELECT seats FROM licenses WHERE id = ? FOR UPDATE", [w.id]);
    const seats = locked?.seats ?? null;
    if (seats !== null && (await activeCount(w.id)) >= seats) {
      onFull(w, seats);
      continue;
    }
    const now = nowDb();
    const id = await insert("license_installations", {
      license_id: w.id,
      device_asset_id: device.id,
      user_id: device.custodian_id,
      branch_id: device.branch_id,
      installed_at: today,
      slot: w.slot,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
    kept.add(id);
    applied.add(w);
  }

  const removed = current.filter((c) => !kept.has(c.id) && scope.has(slotOf(c.slot))).map((c) => c.id);
  if (removed.length) await exec("UPDATE license_installations SET uninstalled_at = ?, updated_at = ? WHERE id IN (?)", [today, nowDb(), removed]);
  return applied;
}

const ALL_SCOPE: ReadonlySet<SoftwareSlot | null> = new Set([...SOFTWARE_SLOTS, null]);

/**
 * ให้การติดตั้งบนเครื่องตรงกับที่เลือกในฟอร์ม (เรียกใน transaction ของการบันทึกสินทรัพย์) — seat เต็ม = 422 ที่ช่องนั้น
 * - คืนชื่อ license ของแต่ละช่อง ไว้เขียนลงคอลัมน์ข้อความ os / office / antivirus
 */
export async function syncSoftware(
  device: { id: number; custodian_id: number | null; branch_id: number | null },
  input: unknown,
  userId: number,
  locale: Locale,
): Promise<Record<SoftwareSlot, string | null>> {
  const want = parseSoftwareInput(input);
  const desired: { slot: SoftwareSlot | null; uuid: string }[] = [];
  for (const s of SOFTWARE_SLOTS) if (want[s]) desired.push({ slot: s, uuid: want[s]! });
  for (const uuid of want.others) if (!desired.some((d) => d.uuid === uuid)) desired.push({ slot: null, uuid });

  const licenses = desired.length
    ? await select<{ id: number; uuid: string; name: string }>("SELECT id, uuid, name FROM licenses WHERE uuid IN (?)", [desired.map((d) => d.uuid)])
    : [];
  const byUuid = new Map(licenses.map((l) => [l.uuid, l]));
  const wanted: WantedInstall[] = desired.flatMap((d) => {
    const lic = byUuid.get(d.uuid);
    return lic ? [{ slot: d.slot, id: lic.id, name: lic.name }] : [];
  });

  await applyInstallations(device, wanted, ALL_SCOPE, userId, (w, seats) => {
    throw ValidationError.withMessages({ [w.slot ? `software.${w.slot}` : "software.others"]: trans(locale, "eam.license.software_seats_full", { name: w.name, seats }) });
  });
  const names: Record<SoftwareSlot, string | null> = { os: null, office: null, antivirus: null };
  for (const w of wanted) if (w.slot) names[w.slot] = w.name;
  return names;
}

/** license ทั้งหมด (สำหรับจับคู่ชื่อจาก Excel) */
export const licenseCatalog = () =>
  select<{ id: number; license_no: string | null; name: string }>("SELECT id, license_no, name FROM licenses WHERE deleted_at IS NULL ORDER BY id");

/** ชื่อ license ที่ติดตั้งอยู่ของหลายเครื่อง (ส่งออก Excel) — device id → ช่อง → ชื่อ */
export async function softwareNamesOf(deviceIds: number[]): Promise<Map<number, Record<SoftwareSlot, string | null> & { others: string[] }>> {
  const out = new Map<number, Record<SoftwareSlot, string | null> & { others: string[] }>();
  if (!deviceIds.length) return out;
  const rows = await select<{ device_asset_id: number; slot: string | null; name: string }>(
    `SELECT i.device_asset_id, i.slot, li.name
       FROM license_installations i JOIN licenses li ON li.id = i.license_id AND li.deleted_at IS NULL
      WHERE i.device_asset_id IN (?) AND i.uninstalled_at IS NULL
      ORDER BY i.installed_at, i.id`,
    [deviceIds],
  );
  for (const r of rows) {
    let set = out.get(Number(r.device_asset_id));
    if (!set) out.set(Number(r.device_asset_id), (set = { os: null, office: null, antivirus: null, others: [] }));
    const slot = slotOf(r.slot);
    if (slot && !set[slot]) set[slot] = r.name;
    else set.others.push(r.name);
  }
  return out;
}
