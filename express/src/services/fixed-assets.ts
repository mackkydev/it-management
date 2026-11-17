import { scalar } from "../db.js";

/**
 * Fixed Assets จาก SyteLine — เงื่อนไขแท็บ "ต้องจัดการ" ใช้ร่วมกันระหว่างหน้ารายการ (counts) และตัวเลขเมนู /fixed-assets
 * - unlinked = ยังไม่ผูกสินทรัพย์ ยังพบในต้นทาง และยังไม่จำหน่าย (จำหน่ายแล้วไม่ต้องตามผูก)
 * - disposed_active = SyteLine จำหน่ายแล้ว แต่สินทรัพย์ที่ผูกในระบบเรายังไม่ได้เป็นจำหน่าย/สูญหาย
 * - missing = ไม่พบในการดึงครั้งล่าสุด (หลุดขอบเขต / ถูกลบที่ต้นทาง)
 */
export const FA_FROM = `fixed_assets f
  LEFT JOIN assets a ON a.id = f.asset_id AND a.deleted_at IS NULL
  LEFT JOIN branches b ON b.id = f.branch_id
  LEFT JOIN fixed_asset_classdepts cd ON cd.site = f.site AND cd.class_dept = CONCAT(f.fa_class, '-', f.fa_dept)`;

export const FA_TABS = {
  all: "1 = 1",
  unlinked: "f.asset_id IS NULL AND f.missing_since IS NULL AND (f.fa_status IS NULL OR f.fa_status <> 'Disposed')",
  disposed_active: "f.fa_status = 'Disposed' AND a.id IS NOT NULL AND a.status NOT IN ('disposed', 'lost')",
  missing: "f.missing_since IS NOT NULL",
} as const;
export type FaTab = keyof typeof FA_TABS;

export const faCount = async (tab: FaTab) => Number(await scalar(`SELECT COUNT(*) FROM ${FA_FROM} WHERE ${FA_TABS[tab]}`));

/** ตัวเลขเมนู /fixed-assets (ผู้มี fixed_assets.link) = ยังไม่ผูก + จำหน่ายแล้วแต่ยังใช้งาน */
export async function fixedAssetBadgeCount(): Promise<number> {
  return (await faCount("unlinked")) + (await faCount("disposed_active"));
}
