/**
 * หมวดตั้งต้น (แก้ไม่ได้) ที่ใช้ร่วมกันระหว่างคลังบัญชี (credentials.category = key) และหมวดหมู่สัญญา (contract_categories.builtin_key)
 * ชื่อที่แสดงแปลตามภาษาที่หน้าเว็บ (vault.categories.<key>) — ลำดับนี้คือลำดับที่แสดง ("other" ท้ายสุด)
 */
export const BUILTIN_CATEGORIES = ["system", "server", "network", "email", "software", "cloud", "computer", "hosting", "hostname", "other"] as const;

/** ชื่อที่แสดงของหมวดตั้งต้น (ไทย / อังกฤษ) — ห้ามตั้งหมวดที่เพิ่มเองซ้ำกับชื่อเหล่านี้ */
const BUILTIN_LABELS: Record<(typeof BUILTIN_CATEGORIES)[number], [string, string]> = {
  system: ["ระบบงาน", "Business system"],
  server: ["เซิร์ฟเวอร์", "Server"],
  network: ["เครือข่าย", "Network"],
  email: ["อีเมล", "Email"],
  software: ["ซอฟต์แวร์/License", "Software/License"],
  cloud: ["Cloud", "Cloud"],
  computer: ["คอมพิวเตอร์", "Computer"],
  hosting: ["Hosting", "Hosting"],
  hostname: ["Hostname", "Hostname"],
  other: ["อื่นๆ", "Other"],
};

/** ชื่อนี้ซ้ำกับหมวดตั้งต้น (key หรือชื่อที่แสดงภาษาใดภาษาหนึ่ง — ไม่สนตัวพิมพ์) */
export const isBuiltinName = (name: string): boolean => {
  const n = name.trim().toLowerCase();
  return BUILTIN_CATEGORIES.some((k) => k === n || BUILTIN_LABELS[k].some((l) => l.toLowerCase() === n));
};
