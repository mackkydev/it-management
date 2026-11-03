"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { SuggestItem } from "@/components/suggest-input";
import { CATEGORY_FORM, COMPUTER_DATE_FIELDS, COMPUTER_TEXT_FIELDS, type AssetFormValues, type AssetTagOption, type FieldErrors, type SoftwareOption, type UserOption, type Asset } from "@/lib/types";

export interface SaveResult {
  errors?: FieldErrors;
  message?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** แปลงค่าจากฟอร์มเป็น payload ของ API: ช่องว่าง → null, ตัดช่องว่างหัวท้าย */
function toPayload(v: AssetFormValues) {
  const text = (s: string) => (s.trim() === "" ? null : s.trim());
  const form = CATEGORY_FORM[v.category];
  return {
    asset_tag: v.asset_tag.trim(),
    name: v.name.trim(),
    category: v.category,
    brand: text(v.brand),
    model: text(v.model),
    serial_number: text(v.serial_number),
    status: v.status,
    location_id: v.location_id ? Number(v.location_id) : null,
    custodian_id: v.custodian_id ? Number(v.custodian_id) : null,
    purchase_date: text(v.purchase_date),
    purchase_cost: text(v.purchase_cost),
    warranty_expires_at: text(v.warranty_expires_at),
    notes: text(v.notes),
    is_loanable: v.is_loanable,
    is_shared: v.is_shared,
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    // ข้อมูลเครื่องคอมพิวเตอร์: หมวดอื่นส่งเป็น null (ไม่เก็บค่าค้างจากหมวดเดิม)
    ...Object.fromEntries([...COMPUTER_TEXT_FIELDS, ...COMPUTER_DATE_FIELDS].map((k) => [k, form?.computer ? text(v[k]) : null])),
    // แผนกใช้ทุกหมวด
    department: text(v.department),
    ...(v.source_asset_no ? { source_asset_no: v.source_asset_no } : {}),
    // ซอฟต์แวร์บนเครื่อง → API บันทึกเป็นการติดตั้ง license (ช่องที่ผูกแล้ว API เขียนชื่อ license ลง os / office / antivirus เอง)
    ...(form?.computer
      ? {
          software: {
            os: v.software.os?.id ?? null,
            office: v.software.office?.id ?? null,
            antivirus: v.software.antivirus?.id ?? null,
            others: v.software.others.map((o) => o.id),
          },
        }
      : {}),
  };
}

/** ตัวเลือก OS / Office / Anti Virus / Software อื่นๆ = license ทั้งหมด + seat คงเหลือ */
export async function loadSoftwareOptions(): Promise<SoftwareOption[]> {
  try {
    return (await apiFetch<{ data: SoftwareOption[] }>("/assets/software-options")).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

const toResult = (e: unknown) => toActionResult<keyof FieldErrors>(e, "assets.form.notFound");

export type ImportIssue = { row: number; message: string };
export type ImportResult =
  | { ok: true; created: number; updated: number; warnings: ImportIssue[] }
  | { ok: false; message: string; rows: ImportIssue[] };

/** นำเข้าทะเบียนคอมพิวเตอร์จาก Excel (multipart: file) — ผิดแม้แถวเดียว API ไม่บันทึกเลยและส่งรายการแถวที่ผิดกลับมา */
export async function importAssets(form: FormData): Promise<ImportResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    const { t } = await getI18n();
    return { ok: false, message: t("assets.import.noFile"), rows: [] };
  }
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const res = await apiFetch<{ data: { created: number; updated: number; warnings: ImportIssue[] } }>("/assets/import", { method: "POST", body });
    revalidatePath("/assets");
    return { ok: true, ...res.data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      const b = e.body as { message?: string; rows?: ImportIssue[]; errors?: Record<string, string[]> };
      return { ok: false, message: b.errors?.file?.[0] ?? b.message ?? "", rows: b.rows ?? [] };
    }
    const r = await toResult(e);
    return { ok: false, message: r.message ?? "", rows: [] };
  }
}

/** ค่ายี่ห้อ/รุ่นที่มีอยู่แล้ว (ช่องพิมพ์แล้วแนะนำ) */
export async function suggestAssetValues(field: "brand" | "model", q: string, brand = ""): Promise<string[]> {
  if (field !== "brand" && field !== "model") return [];
  const query = new URLSearchParams({ field, q: q.slice(0, 100) });
  if (field === "model" && brand.trim()) query.set("brand", brand.trim().slice(0, 100));
  try {
    return (await apiFetch<{ data: string[] }>(`/assets/suggestions?${query}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

/** เลขครุภัณฑ์จากทะเบียนสินทรัพย์ (ช่องเลขที่ทรัพย์สิน Monitor) */
export async function suggestAssetTags(q: string): Promise<AssetTagOption[]> {
  const query = new URLSearchParams({ q: q.slice(0, 100) });
  try {
    return (await apiFetch<{ data: AssetTagOption[] }>(`/assets/tag-suggestions?${query}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

/** ค้นสินทรัพย์ทุกหมวด ยกเว้น License — เลือกผูกกับเลขในใบแจ้งซ่อม */
export async function suggestAssetsToLink(q: string): Promise<SuggestItem[]> {
  const query = new URLSearchParams({ search: q.slice(0, 100), per_page: "10" });
  try {
    const { data } = await apiFetch<{ data: Asset[] }>(`/assets?${query}`);
    return data.map((a) => ({ value: a.asset_tag, hint: [a.name, a.brand, a.model].filter(Boolean).join(" · ") }));
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

/** ผูกใบแจ้งซ่อมที่พิมพ์เลขนี้เข้ากับสินทรัพย์ที่มีอยู่แล้ว */
export async function linkMissingAsset(assetNo: string, assetTag: string): Promise<SaveResult & { ok?: boolean }> {
  try {
    await apiFetch("/assets/missing/link", { method: "POST", body: JSON.stringify({ asset_no: assetNo, asset_tag: assetTag }) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  return { ok: true };
}

async function invalidId(): Promise<SaveResult> {
  const { t } = await getI18n();
  return { message: t("assets.form.invalidId") };
}

/** ค้นหาผู้ใช้สำหรับช่องผู้ถือครอง — เรียกผ่าน server เพื่อไม่ให้ token หลุดไป browser */
export async function searchUsers(search: string): Promise<UserOption[]> {
  const q = new URLSearchParams({ search: search.slice(0, 100), per_page: "10" });
  try {
    return (await apiFetch<{ data: UserOption[] }>(`/users?${q}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export async function createAsset(values: AssetFormValues): Promise<SaveResult> {
  try {
    await apiFetch("/assets", { method: "POST", body: JSON.stringify(toPayload(values)) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  redirect("/assets?saved=created");
}

export async function updateAsset(id: string, values: AssetFormValues): Promise<SaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    const movementReason = values.movement_reason.trim() || null;
    await apiFetch(`/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...toPayload(values), movement_reason: movementReason }),
    });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  revalidatePath(`/assets/${id}/edit`);
  redirect("/assets?saved=updated");
}

export async function deleteAsset(id: string): Promise<SaveResult> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/assets/${id}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/assets");
  redirect("/assets?saved=deleted");
}

/** โอนย้าย: เปลี่ยนสาขา + ผู้ถือครอง/ผู้ใช้งาน → ประวัติการโอนย้าย (POST /assets/{uuid}/movements) */
export async function transferAsset(id: string, v: { branch_id: number | null; custodian_id: number | null; reason: string }): Promise<SaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/assets/${id}/movements`, { method: "POST", body: JSON.stringify({ branch_id: v.branch_id, custodian_id: v.custodian_id, reason: v.reason || null }) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/assets/${id}`);
  return { ok: true };
}

