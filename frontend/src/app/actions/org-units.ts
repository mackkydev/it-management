"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";

/** แผนก / ฝ่าย (ข้อมูลหลัก) — สิทธิ์ org.manage (API ตรวจซ้ำ) */
export type OrgTable = "departments" | "divisions" | "contract_categories" | "computer_type" | "brand" | "vault_category" | "meeting_purpose" | "meeting_equipment" | "vehicle_purpose" | "vehicle_extra" | "vehicle_type" | "vehicle_fuel";
export type OrgResult = ActionResult<"name" | "sort_order">;

const TABLES: OrgTable[] = ["departments", "divisions", "contract_categories", "computer_type", "brand", "vault_category", "meeting_purpose", "meeting_equipment", "vehicle_purpose", "vehicle_extra", "vehicle_type", "vehicle_fuel"];
/** path ของ API และหน้าเว็บ (หมวดหมู่สัญญาใช้ขีดกลาง) */
const PATH: Record<OrgTable, string> = {
  departments: "/departments",
  divisions: "/divisions",
  contract_categories: "/contract-categories",
  computer_type: "/dropdown-options/computer_type",
  brand: "/dropdown-options/brand",
  vault_category: "/dropdown-options/vault_category",
  meeting_purpose: "/dropdown-options/meeting_purpose",
  meeting_equipment: "/dropdown-options/meeting_equipment",
  vehicle_purpose: "/dropdown-options/vehicle_purpose",
  vehicle_extra: "/dropdown-options/vehicle_extra",
  vehicle_type: "/dropdown-options/vehicle_type",
  vehicle_fuel: "/dropdown-options/vehicle_fuel",
};
/** ฝ่าย/แผนก = หน้า ฝ่ายและแผนก, ที่เหลือ = หน้า ข้อมูล Drop Down */
const PAGE = (table: OrgTable) => (table === "departments" || table === "divisions" ? "/org-units" : "/dropdowns");
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

export async function saveOrgUnit(
  table: OrgTable,
  id: number | null,
  v: { name: string; is_active: boolean; sort_order: number; division_id?: number | null; department_ids?: number[] },
): Promise<OrgResult> {
  const { t } = await getI18n();
  if (!TABLES.includes(table) || (id !== null && !validId(id))) return { message: t("common.saveFailed") };
  try {
    await apiFetch(id ? `${PATH[table]}/${id}` : PATH[table], {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        name: v.name.trim(),
        is_active: v.is_active,
        sort_order: v.sort_order,
        ...(table === "departments" ? { division_id: v.division_id ?? null } : {}),
        // ฝ่าย: แผนกที่อยู่ในฝ่ายนี้ (ไม่ส่ง = ไม่แตะ)
        ...(table === "divisions" && v.department_ids ? { department_ids: v.department_ids.map(Number) } : {}),
      }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(PAGE(table));
  return { ok: true, message: t("orgUnits.saved") };
}

export async function deleteOrgUnit(table: OrgTable, id: number): Promise<OrgResult> {
  const { t } = await getI18n();
  if (!TABLES.includes(table) || !validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`${PATH[table]}/${id}`, { method: "DELETE" });
  } catch (e) {
    const r = await toActionResult<"name" | "sort_order">(e);
    return { ...r, message: r.errors?.name ?? r.message };
  }
  revalidatePath(PAGE(table));
  return { ok: true, message: t("orgUnits.deleted") };
}

export type OrgImportResult = { ok: true; created: number; updated: number } | { ok: false; message: string; rows: { row: number; message: string }[] };

/** นำเข้าฝ่าย + แผนกจาก Excel (multipart: file) */
export async function importOrgUnits(form: FormData): Promise<OrgImportResult> {
  const { t } = await getI18n();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: t("orgUnits.noFile"), rows: [] };
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const res = await apiFetch<{ data: { created: number; updated: number } }>("/org-units/import", { method: "POST", body });
    revalidatePath("/org-units");
    return { ok: true, ...res.data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      const b = e.body as { message?: string; rows?: { row: number; message: string }[] };
      return { ok: false, message: b.message ?? t("common.saveFailed"), rows: b.rows ?? [] };
    }
    return { ok: false, message: (await toActionResult(e)).message ?? t("common.saveFailed"), rows: [] };
  }
}
