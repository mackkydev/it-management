import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self): ถ่ายรูปอุปกรณ์จากมือถือในฟอร์มแจ้งงาน
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  // HSTS: บังคับ https ต่อ 1 ปี (เบราว์เซอร์ไม่สนเมื่อเปิดผ่าน http เช่นในวงแลน / localhost) — ไม่ใส่ includeSubDomains กันกระทบโดเมนย่อยอื่นของบริษัท
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  // CSP ตั้งใน src/proxy.ts (ต้องสร้าง nonce ใหม่ทุก request)
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker (frontend/Dockerfile ตั้ง NEXT_OUTPUT=standalone): build เป็น server.js + ไฟล์ที่จำเป็นเท่านั้น — เครื่องพัฒนาใช้ next start ตามเดิม
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  experimental: {
    serverActions: {
      // ใบแจ้งงาน: รูป ≤ 4 x 1MB + เอกสาร ≤ 5 x 5MB + อะไหล่ ≤ 10 x 1MB + ลายเซ็น
      bodySizeLimit: "45mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // PWA: service worker ต้องไม่ถูก cache — แก้ sw.js แล้วเครื่องผู้ใช้ได้ตัวใหม่ทันที
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
