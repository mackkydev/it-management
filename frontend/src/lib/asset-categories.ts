import "server-only";

import { apiFetch } from "@/lib/api";

/** หมวดหมู่สินทรัพย์ที่แก้ได้ (ข้อมูล Drop Down) — ไม่รวม รหัสตายตัว CATEGORIES */
export const assetCategoryNames = () => apiFetch<{ data: { name: string }[] }>("/dropdown-options/asset_category").then((r) => r.data.map((o) => o.name));
