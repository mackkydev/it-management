/* Service worker ของ IT-SYSTEM (PWA)
 * - หน้าเว็บ: ดึงจาก server ทุกครั้ง (ข้อมูลต้องสดและผ่านการตรวจสิทธิ์) — ออฟไลน์ = แสดง /offline.html
 * - /_next/static/*: ไฟล์ build ที่ชื่อมี hash → cache-first (เฉพาะ production; dev ไม่ cache เพื่อไม่ให้ HMR ค้าง)
 * - ไม่ cache API / ไฟล์แนบ / server actions / หน้าที่ต้อง login เด็ดขาด
 * เปลี่ยน VERSION เมื่อแก้ไฟล์นี้หรือ offline.html เพื่อให้ cache เดิมถูกล้าง
 */
const VERSION = "v1";
const SHELL = `it-system-shell-${VERSION}`;
const ASSETS = `it-system-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];
const CACHE_ASSETS = new URL(self.location.href).searchParams.get("mode") === "production";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("it-system-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (CACHE_ASSETS && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
