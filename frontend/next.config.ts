import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self): ถ่ายรูปอุปกรณ์จากมือถือในฟอร์มแจ้งงาน
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // ใบแจ้งงาน: รูป ≤ 4 x 1MB + เอกสาร ≤ 5 x 5MB + อะไหล่ ≤ 10 x 1MB + ลายเซ็น
      bodySizeLimit: "45mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
