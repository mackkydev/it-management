import bcrypt from "bcryptjs";
import { first, likeEscape } from "../db.js";
import { ValidationError } from "./errors.js";
import { attributeName, replaceParams, validationMessage, type Locale } from "./i18n.js";
import { parseDate } from "./time.js";
import { UploadedFile } from "./uploaded-file.js";

/**
 * Validator ที่ทำงานเหมือน Laravel validation (กฎ, ลำดับ, ข้อความ th/en, ชื่อฟิลด์, wildcard "photos.*")
 * เพื่อให้ response 422 ของ Express เหมือน Laravel ทุกจุด — frontend อ่าน errors.<field>[0]
 *
 * ความต่างที่ตั้งใจ: หยุดตรวจฟิลด์เมื่อเจอกฎแรกที่ไม่ผ่าน (Laravel อาจให้หลายข้อความต่อฟิลด์ แต่ข้อความแรกตรงกัน)
 */

type Data = Record<string, any>;

export interface RuleContext {
  attribute: string;
  data: Data;
  locale: Locale;
  hasRule: (name: string) => boolean;
}

export interface RuleObject {
  name: string;
  /** true = ผ่าน; string = ไม่ผ่านพร้อมชื่อกฎสำหรับข้อความ (เช่น "password.letters") */
  check: (value: any, ctx: RuleContext) => boolean | string | Promise<boolean | string>;
  implicit?: boolean;
  params?: Record<string, string | number>;
  /** ข้อความที่แปลแล้ว (ใช้แทนข้อความของกฎ) */
  message?: string;
}

export type Rule = string | RuleObject;
export type Rules = Record<string, Rule[]>;

export interface ValidateOptions {
  locale: Locale;
  /** ข้อความเฉพาะ เช่น {"asset_tag.regex": "..."} */
  messages?: Record<string, string>;
  /** เหมือน FormRequest::after() — เพิ่ม error หลังตรวจกฎครบ */
  after?: (ctx: { data: Data; errors: ErrorBag }) => void | Promise<void>;
}

export class ErrorBag {
  readonly items: Record<string, string[]> = {};
  add(field: string, message: string) {
    (this.items[field] ??= []).push(message);
  }
  has(field: string) {
    return Boolean(this.items[field]?.length);
  }
  get empty() {
    return Object.keys(this.items).length === 0;
  }
}

/* ------------------------------------------------------------------ helpers */

const isFile = (v: unknown): v is UploadedFile => v instanceof UploadedFile;
const isList = (v: unknown): v is Data => (Array.isArray(v) || (typeof v === "object" && v !== null)) && !isFile(v);

export function getPath(data: Data, path: string): any {
  return path.split(".").reduce<any>((node, key) => (isList(node) ? (node as Data)[key] : undefined), data);
}

function hasPath(data: Data, path: string): boolean {
  const keys = path.split(".");
  let node: any = data;
  for (const key of keys) {
    if (!isList(node) || !(key in node)) return false;
    node = node[key];
  }
  return true;
}

/** ขยาย "parts.*.name" เป็น path จริงตามข้อมูล (ไม่มีข้อมูล = ไม่มี path) */
function expand(pattern: string, data: Data): string[] {
  if (!pattern.includes("*")) return [pattern];
  const parts = pattern.split(".");
  let paths: string[] = [""];
  for (const part of parts) {
    const next: string[] = [];
    for (const base of paths) {
      if (part === "*") {
        const node = base === "" ? data : getPath(data, base);
        if (isList(node)) for (const k of Object.keys(node)) next.push(base === "" ? k : `${base}.${k}`);
      } else {
        next.push(base === "" ? part : `${base}.${part}`);
      }
    }
    paths = next;
  }
  return paths;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) ||
  (isFile(v) && v.size === 0 && !v.tooLarge);

const isIntegerLike = (v: unknown) =>
  (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^[+-]?\d+$/.test(v)) || v === true;
const isNumericLike = (v: unknown) =>
  (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v));
const BOOLEAN_VALUES: unknown[] = [true, false, 0, 1, "0", "1"];
const EMAIL = /^(?!\.)[^\s@"(),:;<>[\]\\]+(?<!\.)@[^\s@"(),:;<>[\]\\.]+(\.[^\s@"(),:;<>[\]\\.]+)*$/;
const toStr = (v: unknown) => (typeof v === "boolean" ? (v ? "1" : "0") : String(v));

/** ขนาดของค่าตามชนิด (เหมือน Validator::getSize) */
function sizeOf(value: unknown, ctx: RuleContext): { size: number; type: "numeric" | "string" | "array" | "file" } {
  if (isFile(value)) return { size: value.size / 1024, type: "file" };
  if (ctx.hasRule("numeric") || ctx.hasRule("integer")) {
    if (isNumericLike(value)) return { size: Number(value), type: "numeric" };
  }
  if (isList(value)) return { size: Object.keys(value).length, type: "array" };
  return { size: [...String(value ?? "")].length, type: "string" };
}

function compareDate(value: unknown, param: string, data: Data, op: "<=" | ">="): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const v = parseDate(String(value));
  if (!v) return false;
  // param เป็นชื่อฟิลด์อื่น (เช่น after_or_equal:from) หรือคำ/วันที่ (today, now, 2026-01-01)
  let target = param in data ? parseDate(data[param]) : parseDate(param);
  if (!target && !(param in data)) target = parseDate(param);
  if (!target) return true; // เหมือน PHP: เทียบกับ null แล้วผ่าน
  // "today" เทียบระดับวินาทีเหมือน strtotime: วันนี้ 00:00:00
  return op === "<=" ? v.getTime() <= target.getTime() : v.getTime() >= target.getTime();
}

/* ------------------------------------------------------------------ string rules */

function stringRule(spec: string): RuleObject {
  const [name, rawParams = ""] = spec.split(/:(.*)/s);
  const params = rawParams === "" ? [] : rawParams.split(",");

  switch (name) {
    case "required":
      return { name, implicit: true, check: (v) => !isEmpty(v) };
    case "required_if": {
      const [other, ...values] = params;
      return {
        name,
        implicit: true,
        params: { other, value: values.join(", ") },
        check: (v, ctx) => {
          const o = getPath(ctx.data, other);
          if (o === undefined || o === null || !values.includes(toStr(o))) return true;
          return !isEmpty(v);
        },
      };
    }
    case "string":
      return { name, check: (v) => typeof v === "string" };
    case "integer":
      return { name, check: (v) => isIntegerLike(v) };
    case "numeric":
      return { name, check: (v) => isNumericLike(v) };
    case "boolean":
      return { name, check: (v) => BOOLEAN_VALUES.includes(v) };
    case "email":
      return { name, check: (v) => typeof v === "string" && EMAIL.test(v) };
    case "date":
      return { name, check: (v) => typeof v === "string" && parseDate(v) !== null };
    case "array":
      return { name, check: (v) => isList(v) };
    case "in":
    case "enum":
      return { name, check: (v) => !isList(v) && !isFile(v) && v !== null && params.includes(toStr(v)) };
    case "not_in":
      return { name, check: (v) => !params.includes(toStr(v)) };
    case "max":
      return {
        name,
        params: { max: params[0] },
        check: (v, ctx) => {
          const { size, type } = sizeOf(v, ctx);
          return size <= Number(params[0]) || `max.${type}`;
        },
      };
    case "min":
      return {
        name,
        params: { min: params[0] },
        check: (v, ctx) => {
          const { size, type } = sizeOf(v, ctx);
          return size >= Number(params[0]) || `min.${type}`;
        },
      };
    case "confirmed":
      return { name, check: (v, ctx) => getPath(ctx.data, `${ctx.attribute}_confirmation`) === v };
    case "different":
      return {
        name,
        params: { other: params[0] },
        check: (v, ctx) => hasPath(ctx.data, params[0]) && getPath(ctx.data, params[0]) !== v,
      };
    case "before_or_equal":
      return { name, params: { date: params[0] }, check: (v, ctx) => compareDate(v, params[0], ctx.data, "<=") };
    case "after_or_equal":
      return { name, params: { date: params[0] }, check: (v, ctx) => compareDate(v, params[0], ctx.data, ">=") };
    case "distinct": {
      const ignoreCase = params.includes("ignore_case");
      return {
        name,
        check: (v, ctx) => {
          const parent = ctx.attribute.split(".").slice(0, -1).join(".");
          const siblings = Object.values(getPath(ctx.data, parent) ?? {});
          const norm = (x: unknown) => (ignoreCase ? toStr(x).toLowerCase() : toStr(x));
          return siblings.filter((s) => norm(s) === norm(v)).length <= 1;
        },
      };
    }
    case "file":
      return { name, check: (v) => isFile(v) };
    case "image":
      return { name, check: (v) => isFile(v) && v.isImage() };
    case "mimes":
      return {
        name,
        params: { values: params.join(", ") },
        check: (v) => {
          if (!isFile(v)) return false;
          const ext = v.guessExtension();
          return ext !== null && (params.includes(ext) || (ext === "jpg" && params.includes("jpeg")));
        },
      };
    default:
      throw new Error(`Unknown validation rule: ${spec}`);
  }
}

/* ------------------------------------------------------------------ object rules */

export function regex(re: RegExp): RuleObject {
  return { name: "regex", check: (v) => (typeof v === "string" || typeof v === "number") && re.test(String(v)) };
}

/**
 * Rule::unique(table, column)->ignore(id) — รวมแถวที่ถูก soft delete เหมือน Laravel
 * เทียบแบบไม่สนตัวพิมพ์ เช่น "pkt" ซ้ำกับ "PKT" (คงพฤติกรรมเดิมสมัยใช้ MariaDB — PostgreSQL เทียบแบบสนตัวพิมพ์)
 */
export function unique(table: string, column: string, ignoreId?: number | null): RuleObject {
  return {
    name: "unique",
    check: async (v) => {
      const row = await first(
        `SELECT 1 FROM "${table}" WHERE LOWER("${column}") = LOWER(?)${ignoreId ? " AND id <> ?" : ""} LIMIT 1`,
        ignoreId ? [String(v), ignoreId] : [String(v)],
      );
      return row === null;
    },
  };
}

/** Rule::exists(table, column) + เงื่อนไขเพิ่ม (SQL ที่เขียนในโค้ดเท่านั้น ไม่ใช่จากผู้ใช้) */
export function exists(table: string, column = "id", where = ""): RuleObject {
  return {
    name: "exists",
    check: async (v) => {
      if (isList(v) || isFile(v)) return false;
      const row = await first(`SELECT 1 FROM "${table}" WHERE "${column}" = ?${where ? ` AND (${where})` : ""} LIMIT 1`, [String(v)]);
      return row !== null;
    },
  };
}

export function notIn(values: Array<string | number>): RuleObject {
  return { name: "not_in", check: (v) => !values.map(String).includes(toStr(v)) };
}

/** Password::min(n)->letters()->numbers() */
export function password(min: number, opts: { letters?: boolean; numbers?: boolean } = {}): RuleObject {
  return {
    name: "password",
    params: { min },
    check: (v) => {
      if (typeof v !== "string") return "string";
      if ([...v].length < min) return "min.string";
      if (opts.letters && !/\p{L}/u.test(v)) return "password.letters";
      if (opts.numbers && !/\p{N}/u.test(v)) return "password.numbers";
      return true;
    },
  };
}

/** current_password — ตรวจกับ hash ของผู้ใช้ที่ login อยู่ */
export function currentPassword(hash: string): RuleObject {
  return { name: "current_password", check: (v) => typeof v === "string" && verifyHash(v, hash) };
}

/** กฎเฉพาะ (คืน false = ไม่ผ่าน) พร้อมข้อความที่แปลแล้ว */
export function custom(check: RuleObject["check"], message: string): RuleObject {
  return { name: "custom", check, message };
}

export function verifyHash(plain: string, hash: string): boolean {
  // Laravel ใช้ $2y$ — อัลกอริทึมเดียวกับ $2b$
  return bcrypt.compareSync(plain, hash.replace(/^\$2y\$/, "$2b$"));
}

export function makeHash(plain: string, rounds: number): string {
  return bcrypt.hashSync(plain, rounds).replace(/^\$2[ab]\$/, "$2y$");
}

/* ------------------------------------------------------------------ validate */

export async function validate(input: Data, rules: Rules, opts: ValidateOptions): Promise<Data> {
  const errors = new ErrorBag();

  for (const [pattern, ruleList] of Object.entries(rules)) {
    const specs = ruleList.map((r) => (typeof r === "string" ? r : r));
    const names = specs.map((r) => (typeof r === "string" ? r.split(":")[0] : r.name));
    const sometimes = names.includes("sometimes");
    const nullable = names.includes("nullable");
    const effective = specs.filter((r) => typeof r !== "string" || !["sometimes", "nullable", "bail"].includes(r));

    for (const attribute of expand(pattern, input)) {
      const present = hasPath(input, attribute);
      if (sometimes && !present) continue;
      const value = getPath(input, attribute);

      const ctx: RuleContext = { attribute, data: input, locale: opts.locale, hasRule: (n) => names.includes(n) };

      // ไฟล์อัปโหลดไม่สำเร็จ (ใหญ่เกิน) — Laravel ตอบ "uploaded" ก่อนกฎอื่น
      if (isFile(value) && value.tooLarge) {
        errors.add(attribute, message(opts, pattern, attribute, "uploaded", {}));
        continue;
      }

      for (const spec of effective) {
        const rule = typeof spec === "string" ? stringRule(spec) : spec;
        if (!rule.implicit) {
          if (!present || (typeof value === "string" && value.trim() === "")) continue;
          if (value === null && nullable) continue;
        }
        const result = await rule.check(value, ctx);
        if (result === true) continue;

        const key = typeof result === "string" ? result : rule.name;
        const params = { ...rule.params };
        // :value ของ required_if = ค่าปัจจุบันของฟิลด์ที่อ้างถึง (เหมือน Laravel)
        if (rule.name === "required_if") params.value = toStr(getPath(input, String(params.other)));
        const text = rule.message ?? message(opts, pattern, attribute, key, params);
        errors.add(attribute, text);
        break; // ข้อความแรกของฟิลด์
      }
    }
  }

  if (opts.after) await opts.after({ data: input, errors });
  if (!errors.empty) throw new ValidationError(errors.items);

  // validated(): เฉพาะฟิลด์ที่มีกฎและมีอยู่ใน input
  const out: Data = {};
  for (const pattern of Object.keys(rules)) {
    const root = pattern.split(".")[0];
    if (root in input && input[root] !== undefined) out[root] = input[root];
  }
  return out;
}

function message(opts: ValidateOptions, pattern: string, attribute: string, rule: string, params: Record<string, string | number>): string {
  const custom = opts.messages?.[`${pattern}.${rule.split(".")[0]}`] ?? opts.messages?.[`${attribute}.${rule.split(".")[0]}`];
  const text = custom ?? validationMessage(opts.locale, rule);
  const replace: Record<string, string | number> = { ...params, attribute: attributeName(opts.locale, attribute) };
  if (typeof params.other === "string") replace.other = attributeName(opts.locale, params.other);
  return replaceParams(text, replace);
}

/** ค่าตัวเลขจาก input ที่ผ่าน integer แล้ว */
export const int = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** $request->boolean() */
export const bool = (v: unknown): boolean => [true, 1, "1", "true", "on", "yes"].includes(v as never);

export { likeEscape };
