import path from "node:path";

/** ไฟล์ที่อัปโหลด (จาก multer memoryStorage) + การตรวจชนิดไฟล์จากเนื้อไฟล์จริง (ไม่เชื่อนามสกุล/Content-Type จาก client) */
export class UploadedFile {
  readonly detected: { mime: string; ext: string } | null;

  constructor(
    public readonly originalName: string,
    public readonly buffer: Buffer,
    /** true เมื่อไฟล์เกินขนาดที่รับได้ (เทียบกับ upload_max_filesize ของ PHP) */
    public readonly tooLarge = false,
  ) {
    this.detected = detect(buffer, originalName);
  }

  get size(): number {
    return this.buffer.length;
  }

  /** นามสกุลจากเนื้อไฟล์ เหมือน UploadedFile::guessExtension() */
  guessExtension(): string | null {
    return this.detected?.ext ?? null;
  }

  get mime(): string {
    return this.detected?.mime ?? "application/octet-stream";
  }

  isImage(): boolean {
    return ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/webp"].includes(this.mime);
  }
}

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const OLE: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  return buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
}

/** ตรวจชนิดไฟล์จาก magic bytes — ครอบคลุมชนิดที่ระบบรับ (รูป, PDF, Office, zip, ข้อความ) */
export function detect(buf: Buffer, originalName = ""): { mime: string; ext: string } | null {
  const clientExt = path.extname(originalName).slice(1).toLowerCase();
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: "gif" };
  if (startsWith(buf, [0x42, 0x4d])) return { mime: "image/bmp", ext: "bmp" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp" };
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    // Office Open XML เป็น zip — แยกชนิดจากนามสกุล (ถ้าเป็นชนิด OOXML) ไม่งั้นถือเป็น zip
    return OOXML[clientExt] ? { mime: OOXML[clientExt], ext: clientExt } : { mime: "application/zip", ext: "zip" };
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return OLE[clientExt] ? { mime: OLE[clientExt], ext: clientExt } : { mime: "application/x-ole-storage", ext: "doc" };
  }
  // ข้อความล้วน (ไม่มี NUL byte และเป็น UTF-8 ที่ถูกต้อง)
  if (buf.length > 0 && !buf.includes(0) && Buffer.from(buf.toString("utf8"), "utf8").equals(buf)) {
    return clientExt === "csv" ? { mime: "text/csv", ext: "csv" } : { mime: "text/plain", ext: "txt" };
  }
  return null;
}

/** mime ตามนามสกุล (ใช้ตอนส่งไฟล์ที่เก็บไว้กลับ) */
export function mimeFromPath(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
    pdf: "application/pdf", zip: "application/zip", txt: "text/plain", csv: "text/csv", ...OOXML, ...OLE,
  };
  return map[ext] ?? "application/octet-stream";
}
