import type { MetadataRoute } from "next";

/** PWA manifest (/manifest.webmanifest) — ติดตั้งเป็นแอปบนมือถือ/คอมได้ ไอคอนอยู่ที่ public/icons */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "IT-SYSTEM ระบบงานฝ่ายเทคโนโลยีสารสนเทศ",
    short_name: "IT-SYSTEM",
    description: "ระบบงานฝ่าย IT",
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#050816",
    theme_color: "#050816",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "แจ้งงาน IT", short_name: "แจ้งงาน", url: "/tickets/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "ใบแจ้งงานของฉัน", short_name: "ใบแจ้งงาน", url: "/tickets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
