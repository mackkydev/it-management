/**
 * ข้อมูลเครื่องของผู้ใช้ที่หน้าเว็บส่งต่อมา (API ไม่ได้รับ request จากเบราว์เซอร์ตรงๆ แต่ผ่าน Next.js)
 *   IP          = X-Forwarded-For (req.ip ตาม trust proxy) — ตัด "::ffff:" ของ IPv4 ที่มาทาง IPv6 ออก
 *   User-Agent  = X-Client-Agent (หน้าเว็บใส่ " [pwa]" ต่อท้ายเมื่อเปิดจากแอปที่ติดตั้ง) ไม่มี = User-Agent ของคำขอเอง
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
}

type HeaderSource = { get?: (name: string) => unknown };

export function clientAgent(req: HeaderSource): string | null {
  const read = (name: string) => {
    const v = typeof req.get === "function" ? req.get(name) : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const ua = read("x-client-agent") ?? read("user-agent");
  return ua ? ua.slice(0, 255) : null;
}
