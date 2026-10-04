import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { config } from "./config.js";
import { HttpError, unauthenticated, ValidationError } from "./lib/errors.js";
import type { Locale } from "./lib/i18n.js";
import { findToken } from "./lib/tokens.js";
import { UploadedFile } from "./lib/uploaded-file.js";
import { findUser, type UserRow } from "./models/user.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      tokenId?: number;
      locale: Locale;
      /** query + body + files หลัง trim และแปลง "" → null (เหมือน $request->all() ของ Laravel) */
      input: Record<string, any>;
    }
  }
}

/** ผู้ใช้ที่ login (หลัง middleware auth) */
export const me = (req: Request): UserRow => req.user!;

/* -------------------------------------------------- input (TrimStrings + ConvertEmptyStringsToNull) */

const NO_TRIM = new Set(["password", "password_confirmation", "current_password"]);

function normalize(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const v = NO_TRIM.has(key) ? value : value.trim();
    return v === "" ? null : v;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === "object" && !(value instanceof UploadedFile)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  return value;
}

/** "parts[0][name]" → ["parts","0","name"], "photos[]" → ["photos",""] */
function bracketPath(name: string): string[] {
  const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(name);
  if (!m) return [name];
  return [m[1], ...[...m[2].matchAll(/\[([^[\]]*)\]/g)].map((x) => x[1])];
}

function assign(target: Record<string, any>, name: string, value: unknown) {
  const keys = bracketPath(name);
  let node: any = target;
  keys.forEach((key, i) => {
    const last = i === keys.length - 1;
    const nextIsList = !last && (keys[i + 1] === "" || /^\d+$/.test(keys[i + 1]));
    if (key === "") {
      if (last) node.push(value);
      else {
        const child = nextIsList ? [] : {};
        node.push(child);
        node = child;
      }
      return;
    }
    if (last) node[key] = value;
    else node = node[key] ??= nextIsList ? [] : {};
  });
}

/** multipart: PHP upload_max_filesize = 10M (ไฟล์ใหญ่กว่านี้ → error "uploaded"), post_max_size = 48M */
const UPLOAD_MAX = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 48 * 1024 * 1024, files: 30, fieldSize: 1024 * 1024 } }).any();

export function parseInput(req: Request, res: Response, next: NextFunction) {
  const done = (err?: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      return next(code === "LIMIT_FILE_SIZE" ? new HttpError(413, "The POST data is too large.") : err);
    }
    const body: Record<string, any> = {};
    if (req.is("multipart/form-data") || req.is("application/x-www-form-urlencoded")) {
      // ชื่อฟิลด์แบบ PHP: parts[0][name], photos[]
      for (const [k, v] of Object.entries(req.body ?? {})) assign(body, k, v);
      for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) {
        // multer ถอดชื่อไฟล์เป็น latin1 — แปลงกลับเป็น UTF-8 (ชื่อไฟล์ภาษาไทย)
        const original = Buffer.from(f.originalname, "latin1").toString("utf8");
        assign(body, f.fieldname, new UploadedFile(original, f.buffer, f.size > UPLOAD_MAX));
      }
    } else if (req.body && typeof req.body === "object") {
      Object.assign(body, req.body);
    }
    req.input = normalize({ ...(req.query as Record<string, unknown>), ...body }) as Record<string, any>;
    next();
  };
  if (req.is("multipart/form-data")) upload(req, res, done);
  else done();
}

/* -------------------------------------------------- locale (SetLocale) */

const SUPPORTED: Locale[] = ["th", "en"];

export function locale(req: Request, res: Response, next: NextFunction) {
  const header = req.get("Accept-Language");
  let chosen: Locale = config.defaultLocale;
  if (header) {
    const langs = header
      .split(",")
      .map((part, i) => {
        const [tag, ...params] = part.trim().split(";");
        const q = params.find((p) => p.trim().startsWith("q="));
        return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1, i };
      })
      .filter((l) => l.tag && l.q > 0)
      .sort((a, b) => b.q - a.q || a.i - b.i);
    // Symfony getPreferredLanguage: ตรงตัวก่อน แล้วค่อยเทียบภาษาหลัก, ไม่ตรงเลย = ภาษาแรกที่รองรับ
    chosen =
      (langs.map((l) => l.tag).find((t) => SUPPORTED.includes(t as Locale)) as Locale | undefined) ??
      (langs.map((l) => l.tag.split(/[-_]/)[0]).find((t) => SUPPORTED.includes(t as Locale)) as Locale | undefined) ??
      SUPPORTED[0];
  }
  req.locale = chosen;
  res.setHeader("Content-Language", chosen);
  next();
}

/* -------------------------------------------------- security headers + CORS */

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store, private");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  const origin = req.get("Origin");
  if (origin && config.frontendUrls.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Requested-With");
      res.setHeader("Access-Control-Max-Age", "3600");
      return res.status(204).end();
    }
  }
  next();
}

/* -------------------------------------------------- auth:sanctum */

export async function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!bearer) throw unauthenticated();

  const token = await findToken(bearer);
  const user = token ? await findUser(token.userId) : null;
  if (!token || !user) throw unauthenticated();

  req.user = user;
  req.tokenId = token.id;
  next();
}

/* -------------------------------------------------- errors */

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: "Not Found" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ValidationError) {
    return res.status(422).json({ message: err.message, errors: err.errors });
  }
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    return res.status(err.status).json({ message: err.message });
  }
  // JSON ที่ส่งมาผิดรูปแบบ
  if ((err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON." });
  }
  console.error(err);
  return res.status(500).json({ message: "Server Error" });
}

/* -------------------------------------------------- pagination (LengthAwarePaginator / Paginator ของ Laravel) */

export function pageParam(req: Request): number {
  const p = Number(req.query.page);
  return Number.isInteger(p) && p >= 1 ? p : 1;
}

function pageUrl(req: Request, page: number | null): string | null {
  if (page === null) return null;
  const params = new URLSearchParams(req.query as Record<string, string>);
  params.set("page", String(page));
  return `${basePath(req)}?${params}`;
}

const basePath = (req: Request) => `${req.protocol}://${req.get("host")}${req.baseUrl}${req.path}`;

/** JSON ของ ResourceCollection ที่ paginate() */
export function paginated<T>(req: Request, data: T[], total: number, page: number, perPage: number) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const from = data.length ? (page - 1) * perPage + 1 : null;
  return {
    data,
    links: {
      first: pageUrl(req, 1),
      last: pageUrl(req, last),
      prev: page > 1 ? pageUrl(req, page - 1) : null,
      next: page < last ? pageUrl(req, page + 1) : null,
    },
    meta: {
      current_page: page,
      from,
      last_page: last,
      path: basePath(req),
      per_page: perPage,
      to: from === null ? null : from + data.length - 1,
      total,
    },
  };
}

/**
 * JSON ของ ResourceCollection ที่ simplePaginate() (ไม่นับ total) — ส่ง data มาเกิน 1 แถวเพื่อรู้ว่ามีหน้าถัดไป
 * metaPerPage: Laravel ส่ง per_page ตามค่าที่รับมา (string จาก query) — ส่งต่อให้เหมือนกัน
 */
export function simplePaginated<T>(req: Request, rows: T[], page: number, perPage: number, metaPerPage: number | string = perPage) {
  const hasMore = rows.length > perPage;
  const data = rows.slice(0, perPage);
  const from = data.length ? (page - 1) * perPage + 1 : null;
  return {
    data,
    links: { first: pageUrl(req, 1), last: null, prev: page > 1 ? pageUrl(req, page - 1) : null, next: hasMore ? pageUrl(req, page + 1) : null },
    meta: {
      current_page: page,
      current_page_url: pageUrl(req, page),
      from,
      path: basePath(req),
      per_page: metaPerPage,
      to: from === null ? null : from + data.length - 1,
    },
  };
}

/** meta แบบย่อที่ controller IT-SYSTEM ส่ง (current_page, last_page, total, from, to) */
export function shortMeta(total: number, page: number, perPage: number, count: number) {
  const from = count ? (page - 1) * perPage + 1 : null;
  return { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total, from, to: from === null ? null : from + count - 1 };
}
