import sharp from "sharp";
import type { UploadedFile } from "../lib/uploaded-file.js";

/** รูปประกอบ (ห้องประชุม / รถ): ≤ 4 รูปต่อรายการ, ≤ 1MB ต่อรูป */
export const MAX_PHOTOS = 4;

/** ไอคอน (License ซอฟต์แวร์): หมุนตาม EXIF → ย่อไม่เกิน 256px → WebP (ไม่มี metadata) */
export async function processIcon(file: UploadedFile): Promise<Buffer> {
  return sharp(file.buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

/** ประมวลผลรูปใหม่: หมุนตาม EXIF → ย่อไม่เกิน 1600px → WebP (ไม่คัดลอก metadata เช่น GPS) */
export async function processPhoto(file: UploadedFile): Promise<Buffer> {
  return sharp(file.buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}
