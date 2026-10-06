"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import { CATEGORY_FORM, COMPUTER_DATE_FIELDS, COMPUTER_TEXT_FIELDS, type AssetFormValues, type FieldErrors, type UserOption } from "@/lib/types";

export interface SaveResult {
  errors?: FieldErrors;
  message?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** แปลงค่าจากฟอร์มเป็น payload ของ API: ช่องว่าง → null, ตัดช่องว่างหัวท้าย */
function toPayload(v: AssetFormValues) {
  const text = (s: string) => (s.trim() === "" ? null : s.trim());
  const form = CATEGORY_FORM[v.category];
  const l = v.license;
  return {
    ...(form?.license
      ? {
          license: {
            billing: l.billing,
            start_date: text(l.start_date),
            expires_at: l.billing === "perpetual" ? null : text(l.expires_at),
            seats: l.seats ? Number(l.seats) : null,
            vendor: text(l.vendor),
            license_key: text(l.license_key), // ว่าง = คงค่าเดิม
            clear_license_key: l.clear_license_key,
            notify_days_before: l.notify_days_before ? Number(l.notify_days_before) : null,
          },
        }
      : {}),
    asset_tag: v.asset_tag.trim(),
    name: v.name.trim(),
    category: v.category,
    brand: text(v.brand),
    model: text(v.model),
    // ช่องที่หมวดนี้ซ่อน ส่งเป็น null (ไม่เก็บค่าค้างจากหมวดเดิม)
    serial_number: form?.hide?.includes("serial_number") ? null : text(v.serial_number),
    status: v.status,
    location_id: v.location_id ? Number(v.location_id) : null,
    custodian_id: v.custodian_id ? Number(v.custodian_id) : null,
    purchase_date: text(v.purchase_date),
    purchase_cost: text(v.purchase_cost),
    warranty_expires_at: form?.hide?.includes("warranty_expires_at") ? null : text(v.warranty_expires_at),
    notes: text(v.notes),
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    // ข้อมูลเครื่องคอมพิวเตอร์: หมวดอื่นส่งเป็น null (ไม่เก็บค่าค้างจากหมวดเดิม)
    ...Object.fromEntries([...COMPUTER_TEXT_FIELDS, ...COMPUTER_DATE_FIELDS].map((k) => [k, form?.computer ? text(v[k]) : null])),
  };
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

/** ดู license key (ถอดรหัส) — API ตรวจสิทธิ์ (ผู้จัดการ/IT) และจำกัดจำนวนครั้ง */
export async function revealLicenseKey(id: string): Promise<{ key?: string | null; message?: string }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    return { key: (await apiFetch<{ data: { license_key: string | null } }>(`/assets/${id}/license-key`, { method: "POST" })).data.license_key };
  } catch (e) {
    return toResult(e);
  }
}

/** อัปโหลดไฟล์ license (multipart files[]) */
export async function uploadAssetFiles(id: string, form: FormData): Promise<SaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id)) return invalidId();
  try {
    await apiFetch(`/assets/${id}/files`, { method: "POST", body: form });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/assets/${id}`);
  return { ok: true };
}

export async function deleteAssetFile(id: string, fileId: number): Promise<SaveResult & { ok?: boolean }> {
  if (!UUID_RE.test(id) || !Number.isInteger(fileId) || fileId <= 0) return invalidId();
  try {
    await apiFetch(`/assets/${id}/files/${fileId}`, { method: "DELETE" });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/assets/${id}`);
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
