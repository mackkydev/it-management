/**
 * ธีมสีแบบกำหนดเอง: รับสี hex ที่ผู้ใช้เลือก → สร้างชุดสี accent 50–900 โทน pastel
 * และเลือกสีสถานะของระบบที่ "ไม่ชนกับสีธีม" ให้อัตโนมัติ
 * ใช้ได้ทั้งฝั่ง server (render ตั้งแต่แรก ไม่กระพริบ) และ client (เปลี่ยนสีแบบ realtime)
 */

export const HEX_RE = /^#[0-9a-f]{6}$/i;

interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** แปลง sRGB hex → OKLCH (สูตรจาก Björn Ottosson) */
export function hexToOklch(hex: string): Oklch {
  const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** ความสว่าง/ความสดของแต่ละเฉด — อ้างอิงสัดส่วนของ palette Tailwind */
const SHADES: [shade: number, lightness: number, chromaScale: number][] = [
  [50, 0.975, 0.14],
  [100, 0.945, 0.28],
  [200, 0.895, 0.5],
  [300, 0.82, 0.75],
  [400, 0.72, 0.92],
  [500, 0.63, 1],
  [600, 0.555, 0.95],
  [700, 0.485, 0.85],
  [800, 0.415, 0.72],
  [900, 0.365, 0.6],
];

/** ชุดสี accent จากสีเดียว (ใช้ hue + ความสดของสีที่เลือก, ความสว่างไล่ตามเฉด) */
export function accentPalette(hex: string): Record<string, string> {
  const { c, h } = hexToOklch(hex);
  const chroma = Math.min(Math.max(c, 0.02), 0.22);
  const vars: Record<string, string> = {};
  for (const [shade, l, scale] of SHADES) {
    vars[`--accent-${shade}`] = `oklch(${l} ${(chroma * scale).toFixed(4)} ${h.toFixed(1)})`;
  }
  return vars;
}

/** hue (OKLCH) ของ palette Tailwind ที่ใช้เป็นสีสถานะได้ */
const PALETTE_HUE: Record<string, number> = {
  red: 25, rose: 16, orange: 47, amber: 70, yellow: 86, lime: 131, green: 150,
  emerald: 163, teal: 182, cyan: 215, sky: 237, blue: 260, violet: 293, fuchsia: 322,
};

/** ตัวเลือกของแต่ละสถานะ เรียงตามลำดับความเหมาะสม (สีแรกคือค่าปกติ) */
const STATUS_CANDIDATES: Record<"success" | "info" | "warning" | "danger", string[]> = {
  success: ["emerald", "green", "lime", "teal"],
  info: ["sky", "cyan", "teal", "violet", "blue"],
  warning: ["amber", "yellow", "orange"],
  danger: ["red", "rose", "orange", "fuchsia"],
};

/** ระยะ hue ขั้นต่ำ: ห่างจากสีธีม / ห่างจากสถานะอื่นที่เลือกไปแล้ว */
const MIN_FROM_THEME = 30;
const MIN_BETWEEN_STATUSES = 20;

const STATUS_SHADES = [50, 100, 200, 300, 400, 500, 700, 800];

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * เลือกสีสถานะที่ไม่ชนกับสีธีม:
 *  1) ตัวเลือกแรก (ตามลำดับความเหมาะสม) ที่ห่างจากธีม ≥ 30° และไม่ซ้ำกับสถานะอื่น
 *  2) ถ้าไม่มี → ใช้ตัวที่ห่างจากสีธีมมากที่สุด
 * ถ้าสีที่เลือกแทบไม่มีความสด (เทา) ใช้ค่าปกติทั้งหมด
 */
export function statusPaletteFor(hex: string): Record<string, string> {
  const { c, h } = hexToOklch(hex);
  const chosen: Record<string, string> = {};
  const used: number[] = [];

  for (const [status, candidates] of Object.entries(STATUS_CANDIDATES)) {
    let pick = candidates[0];
    if (c >= 0.04) {
      const free = candidates.filter((p) => used.every((u) => hueDistance(PALETTE_HUE[p], u) >= MIN_BETWEEN_STATUSES));
      const pool = free.length ? free : candidates;
      pick =
        pool.find((p) => hueDistance(PALETTE_HUE[p], h) >= MIN_FROM_THEME) ??
        pool.reduce((best, p) => (hueDistance(PALETTE_HUE[p], h) > hueDistance(PALETTE_HUE[best], h) ? p : best));
    }
    used.push(PALETTE_HUE[pick]);
    chosen[status] = pick;
  }

  const vars: Record<string, string> = {};
  for (const [status, palette] of Object.entries(chosen)) {
    for (const shade of STATUS_SHADES) {
      vars[`--st-${status}-${shade}`] = `var(--color-${palette}-${shade})`;
    }
  }
  return vars;
}

/** CSS variables ทั้งหมดของธีมกำหนดเอง (ใส่เป็น style ของ <html>) */
export function customThemeVars(hex: string): Record<string, string> {
  return { ...accentPalette(hex), ...statusPaletteFor(hex) };
}
