import { select } from "../db.js";

/** ไฟล์แนบของสินทรัพย์ (ไฟล์ของ License อยู่ที่ license_files — services/licenses.ts) */
export interface AssetFileRow {
  id: number;
  asset_id: number;
  kind: string;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

export const loadFiles = (assetId: number) => select<AssetFileRow>("SELECT * FROM asset_files WHERE asset_id = ? ORDER BY id", [assetId]);

export function fileJson(assetUuid: string, f: AssetFileRow) {
  return { id: f.id, kind: f.kind, name: f.original_name, mime: f.mime, size: Number(f.size), url: `/assets/${assetUuid}/files/${f.id}` };
}
