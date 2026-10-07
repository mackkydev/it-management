import { exec, first, insert, isUuid, select, update } from "../db.js";
import { ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import { localToday, nowDb } from "../lib/time.js";
import { activeCount, LICENSE_CATEGORY } from "./asset-licenses.js";

/**
 * ซอฟต์แวร์ที่ติดตั้งบนเครื่อง (ฟอร์มสินทรัพย์หมวดคอมพิวเตอร์)
 * - OS / Office / Anti Virus / Software อื่นๆ เลือกจากสินทรัพย์หมวด Software ที่มีข้อมูล license
 * - เก็บเป็น license_installations ของเครื่องนี้ (slot = os / office / antivirus, NULL = อื่นๆ) → นับ seat ใช้ไป/คงเหลือ
 * - ช่องข้อความ assets.os / office / antivirus = ชื่อ license ที่ผูก (ใช้ในรายการ/Excel) — ค่าจาก Excel ที่ยังไม่ผูกคงไว้ได้
 */
export const SOFTWARE_SLOTS = ["os", "office", "antivirus"] as const;
export type SoftwareSlot = (typeof SOFTWARE_SLOTS)[number];

export interface SoftwareRef {
  id: string;
  asset_tag: string;
  name: string;
}
export type SoftwareSet = Record<SoftwareSlot, SoftwareRef | null> & { others: SoftwareRef[] };

interface InstalledRow {
  id: number;
  license_asset_id: number;
  slot: string | null;
  uuid: string;
  asset_tag: string;
  name: string;
}

const installedOn = (assetId: number) =>
  select<InstalledRow>(
    `SELECT i.id, i.license_asset_id, i.slot, a.uuid, a.asset_tag, a.name
       FROM license_installations i JOIN assets a ON a.id = i.license_asset_id AND a.deleted_at IS NULL
      WHERE i.device_asset_id = ? AND i.uninstalled_at IS NULL
      ORDER BY i.installed_at, i.id`,
    [assetId],
  );

/** ซอฟต์แวร์ที่ติดตั้งอยู่บนเครื่อง (ใช้งานอยู่) แยกตามช่อง */
export async function loadSoftware(assetId: number): Promise<SoftwareSet> {
  const out: SoftwareSet = { os: null, office: null, antivirus: null, others: [] };
  for (const r of await installedOn(assetId)) {
    const ref = { id: r.uuid, asset_tag: r.asset_tag, name: r.name };
    if ((SOFTWARE_SLOTS as readonly string[]).includes(r.slot ?? "") && !out[r.slot as SoftwareSlot]) out[r.slot as SoftwareSlot] = ref;
    else out.others.push(ref);
  }
  return out;
}

/** license ทั้งหมด (Software ที่มีข้อมูล license) + จำนวนที่ใช้/คงเหลือ — ตัวเลือกในฟอร์ม */
export async function softwareOptions() {
  const rows = await select<{ uuid: string; asset_tag: string; name: string; model: string | null; seats: number | null; used: number }>(
    `SELECT a.uuid, a.asset_tag, a.name, a.model, li.seats,
            (SELECT COUNT(*) FROM license_installations i WHERE i.license_asset_id = a.id AND i.uninstalled_at IS NULL) AS used
       FROM assets a JOIN asset_licenses li ON li.asset_id = a.id
      WHERE a.category = ? AND a.deleted_at IS NULL
      ORDER BY a.name, a.id`,
    [LICENSE_CATEGORY],
  );
  return rows.map((r) => ({
    id: r.uuid,
    asset_tag: r.asset_tag,
    name: r.name,
    model: r.model,
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
      "SELECT a.uuid FROM assets a JOIN asset_licenses li ON li.asset_id = a.id WHERE a.uuid IN (?) AND a.category = ? AND a.deleted_at IS NULL",
      [ids, LICENSE_CATEGORY],
    )).map((r) => r.uuid),
  );
  const errors: Record<string, string> = {};
  for (const s of SOFTWARE_SLOTS) if (want[s] && !found.has(want[s]!)) errors[`software.${s}`] = trans(locale, "eam.license.not_license");
  if (want.others.some((x) => !found.has(x))) errors["software.others"] = trans(locale, "eam.license.not_license");
  return errors;
}

/**
 * ให้การติดตั้งบนเครื่องตรงกับที่เลือก (เรียกใน transaction ของการบันทึกสินทรัพย์)
 * - ตัวที่มีอยู่แล้ว = คงไว้ (ปรับช่องถ้าย้ายช่อง), ตัวใหม่ = ติดตั้งวันนี้ (ตรวจ seat), ตัวที่เอาออก = ถอนการติดตั้งวันนี้ (เก็บประวัติ)
 * - คืนชื่อ license ของแต่ละช่อง ไว้เขียนลงคอลัมน์ข้อความ os / office / antivirus
 */
export async function syncSoftware(
  device: { id: number; custodian_id: number | null; branch_id: number | null },
  input: unknown,
  userId: number,
  locale: Locale,
): Promise<Record<SoftwareSlot, string | null>> {
  const want = parseSoftwareInput(input);
  const desired: { slot: SoftwareSlot | null; uuid: string; field: string }[] = [];
  for (const s of SOFTWARE_SLOTS) if (want[s]) desired.push({ slot: s, uuid: want[s]!, field: `software.${s}` });
  for (const uuid of want.others) if (!desired.some((d) => d.uuid === uuid)) desired.push({ slot: null, uuid, field: "software.others" });

  const licenses = desired.length
    ? await select<{ id: number; uuid: string; name: string }>("SELECT id, uuid, name FROM assets WHERE uuid IN (?)", [desired.map((d) => d.uuid)])
    : [];
  const byUuid = new Map(licenses.map((l) => [l.uuid, l]));
  const current = await installedOn(device.id);
  const kept = new Set<number>();
  const today = localToday();
  const names: Record<SoftwareSlot, string | null> = { os: null, office: null, antivirus: null };

  for (const d of desired) {
    const lic = byUuid.get(d.uuid);
    if (!lic) continue;
    if (d.slot) names[d.slot] = lic.name;
    const existing = current.find((c) => !kept.has(c.id) && c.license_asset_id === lic.id && c.slot === d.slot) ?? current.find((c) => !kept.has(c.id) && c.license_asset_id === lic.id);
    if (existing) {
      kept.add(existing.id);
      if (existing.slot !== d.slot) await update("license_installations", { slot: d.slot, updated_at: nowDb() }, "id = ?", [existing.id]);
      continue;
    }
    // ล็อกแถว license กันติดตั้งพร้อมกันจนเกินจำนวน seat
    const locked = await first<{ seats: number | null }>("SELECT seats FROM asset_licenses WHERE asset_id = ? FOR UPDATE", [lic.id]);
    const seats = locked?.seats ?? null;
    if (seats !== null && (await activeCount(lic.id)) >= seats) {
      throw ValidationError.withMessages({ [d.field]: trans(locale, "eam.license.software_seats_full", { name: lic.name, seats }) });
    }
    const now = nowDb();
    const id = await insert("license_installations", {
      license_asset_id: lic.id,
      device_asset_id: device.id,
      user_id: device.custodian_id,
      branch_id: device.branch_id,
      installed_at: today,
      slot: d.slot,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
    kept.add(id);
  }

  const removed = current.filter((c) => !kept.has(c.id)).map((c) => c.id);
  if (removed.length) await exec("UPDATE license_installations SET uninstalled_at = ?, updated_at = ? WHERE id IN (?)", [today, nowDb(), removed]);
  return names;
}
