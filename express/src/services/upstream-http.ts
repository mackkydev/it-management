import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * HTTP client สำหรับเรียก REST API ต้นทาง (API User) — ป้องกัน SSRF
 * - บังคับ https:// และห้ามมี user:pass ใน URL
 * - IP ภายใน / loopback / link-local / multicast ถูกบล็อก ยกเว้น host/IP/CIDR ที่ Local Admin ใส่ใน allowlist ของการเชื่อมต่อ
 *   (ตรวจทั้งก่อนเรียก และตอนต่อ socket จริงผ่าน lookup — กัน DNS rebinding)
 * - redirect ตามได้ไม่เกิน maxRedirects (ทุก hop ตรวจซ้ำ), timeout, จำกัดขนาด response 1MB
 * - ไม่ log header/body (มี token/รหัสผ่าน)
 */

export type UpstreamErrorKind = "insecure" | "blocked" | "timeout" | "network" | "redirect" | "too_large";

export class UpstreamError extends Error {
  constructor(public readonly kind: UpstreamErrorKind) {
    super(`upstream ${kind}`);
  }
}

export interface UpstreamHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxRedirects: number;
  allowedHosts: string[];
}

export interface UpstreamHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const MAX_BODY = 1024 * 1024;

/* ---------------------------------------------------------------- IP ภายใน */

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

/** ::ffff:10.0.0.1 → 10.0.0.1 */
const unmap = (ip: string) => (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip);

export function isPrivateAddress(address: string): boolean {
  const ip = unmap(address);
  const family = isIP(ip);
  if (family === 0) return true; // ไม่ใช่ IP ที่อ่านได้ → ไม่ไว้ใจ
  return PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** allowlist: ชื่อ host (ตรงตัว ไม่สนตัวพิมพ์), IP หรือ CIDR */
export const ALLOWLIST_ENTRY = /^([A-Za-z0-9.-]+|[0-9a-fA-F:.]+(\/\d{1,3})?)$/;

export function isValidAllowEntry(entry: string): boolean {
  if (!ALLOWLIST_ENTRY.test(entry)) return false;
  const [ip, prefix] = entry.split("/");
  if (prefix === undefined) return true;
  const family = isIP(ip);
  return family !== 0 && Number(prefix) <= (family === 4 ? 32 : 128);
}

function allowChecker(entries: string[]): (address: string, hostname: string) => boolean {
  const hosts = new Set<string>();
  const ips = new BlockList();
  for (const e of entries) {
    const [ip, prefix] = e.trim().split("/");
    const family = isIP(ip);
    if (family === 0) hosts.add(e.trim().toLowerCase());
    else if (prefix === undefined) ips.addAddress(ip, family === 4 ? "ipv4" : "ipv6");
    else ips.addSubnet(ip, Number(prefix), family === 4 ? "ipv4" : "ipv6");
  }
  return (address, hostname) => {
    const ip = unmap(address);
    if (!isPrivateAddress(ip)) return true;
    if (hosts.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""))) return true;
    const family = isIP(ip);
    return family !== 0 && ips.check(ip, family === 4 ? "ipv4" : "ipv6");
  };
}

/* ---------------------------------------------------------------- hooks สำหรับเทสต์ */

type Resolver = (hostname: string) => Promise<string[]>;
type Transport = (req: UpstreamHttpRequest & { guard: (address: string, hostname: string) => boolean }) => Promise<UpstreamHttpResponse>;

const systemResolve: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (err, addresses) => (err ? reject(new UpstreamError("network")) : resolve(addresses.map((a) => a.address)))),
  );

let resolver: Resolver = systemResolve;
let transport: Transport = httpsTransport;

/** เทสต์เท่านั้น: แทนที่ DNS / การส่ง HTTP จริงด้วย upstream จำลอง (null = กลับไปใช้ของจริง) */
export function setUpstreamTestHooks(hooks: { resolve?: Resolver; transport?: Transport } | null): void {
  resolver = hooks?.resolve ?? systemResolve;
  transport = hooks?.transport ?? httpsTransport;
}

/* ---------------------------------------------------------------- request */

/** ตรวจ URL ก่อนเรียก: https เท่านั้น, ไม่มี credential ใน URL, host ไม่ชี้ไป IP ภายใน (ยกเว้น allowlist) */
export async function guardUrl(raw: string, allowedHosts: string[]): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamError("insecure");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new UpstreamError("insecure");
  const allowed = allowChecker(allowedHosts);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolver(host);
  if (addresses.length === 0 || addresses.some((a) => !allowed(a, host))) throw new UpstreamError("blocked");
  return url;
}

export async function upstreamFetch(req: UpstreamHttpRequest): Promise<UpstreamHttpResponse> {
  const guard = allowChecker(req.allowedHosts);
  let current = { ...req };
  for (let hop = 0; ; hop++) {
    await guardUrl(current.url, req.allowedHosts);
    const res = await transport({ ...current, guard });
    const location = res.headers.location;
    if (![301, 302, 303, 307, 308].includes(res.status) || typeof location !== "string") return res;
    if (hop >= req.maxRedirects) throw new UpstreamError("redirect");
    const next = new URL(location, current.url).toString();
    current = res.status === 303 ? { ...current, url: next, method: "GET", body: undefined } : { ...current, url: next };
  }
}

function httpsTransport(req: UpstreamHttpRequest & { guard: (address: string, hostname: string) => boolean }): Promise<UpstreamHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(req.url);
    // ตรวจ IP อีกครั้งตอนต่อจริง (DNS อาจตอบไม่เหมือนรอบก่อน)
    const lookup = (hostname: string, options: LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
      dnsLookup(hostname, options, (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => {
        if (err) return cb(err, address, family);
        const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
        if (list.some((a) => !req.guard(a, hostname))) return cb(new UpstreamError("blocked") as NodeJS.ErrnoException, address, family);
        cb(null, address, family);
      });
    };
    const r = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers: { ...req.headers, ...(req.body !== undefined ? { "Content-Length": Buffer.byteLength(req.body) } : {}) },
        lookup: lookup as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) r.destroy(new UpstreamError("too_large"));
          else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", (e) => reject(e instanceof UpstreamError ? e : new UpstreamError("network")));
      },
    );
    r.setTimeout(req.timeoutMs, () => r.destroy(new UpstreamError("timeout")));
    r.on("error", (e) => reject(e instanceof UpstreamError ? e : new UpstreamError("network")));
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}
