import { Router, type Request } from "express";
import { exec, first, insert, select, transaction, update } from "../db.js";
import { authorize, notFound } from "../lib/errors.js";
import { iso, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, int, validate, type Rule } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { POLICY_MANAGE } from "../services/system-policy.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";

/**
 * นโยบายอื่นๆ — เอกสารให้เปิดอ่าน ไม่ต้องกดยอมรับ
 *   GET    /policy/others                  ที่เปิดใช้งาน (login) — ?all=1 = ทั้งหมด (policy.manage)
 *   POST   /policy/others                  JSON หรือ multipart: title, description, sort_order, is_active, files[] (policy.manage)
 *   PUT    /policy/others/{id}             เหมือน POST + remove_file_ids[]
 *   DELETE /policy/others/{id}
 *   GET    /policy/others/{id}/files/{fileId}  ผู้จัดการ = ทุกรายการ, คนอื่น = เฉพาะที่เปิดใช้งาน
 */
export const otherPolicyRoutes = Router();

const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
const FILES_MAX = 10;
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

interface Row {
  id: number;
  title: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string | null;
}
interface FileRow {
  id: number;
  other_policy_id: number;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

const manages = (req: Request) => can(me(req), POLICY_MANAGE);
const filesOf = (ids: number[]) => (ids.length ? select<FileRow>("SELECT * FROM other_policy_files WHERE other_policy_id IN (?) ORDER BY id", [ids]) : Promise.resolve([] as FileRow[]));

const json = (r: Row, files: FileRow[]) => ({
  id: Number(r.id),
  title: r.title,
  description: r.description,
  sort_order: Number(r.sort_order),
  is_active: Boolean(r.is_active),
  updated_at: iso(r.updated_at),
  files: files
    .filter((f) => Number(f.other_policy_id) === Number(r.id))
    .map((f) => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: Number(f.size), url: `/policy/others/${r.id}/files/${f.id}` })),
});

async function findRow(req: Request): Promise<Row> {
  const row = /^\d+$/.test(String(req.params.id)) ? await first<Row>("SELECT * FROM other_policies WHERE id = ?", [Number(req.params.id)]) : null;
  if (!row) throw notFound();
  return row;
}

const respond = async (id: number) => json((await first<Row>("SELECT * FROM other_policies WHERE id = ?", [id]))!, await filesOf([id]));

otherPolicyRoutes.get("/policy/others", async (req, res) => {
  const all = "all" in req.query;
  if (all) authorize(manages(req));
  const rows = await select<Row>(`SELECT * FROM other_policies ${all ? "" : "WHERE is_active = true"} ORDER BY sort_order, id DESC`);
  const files = await filesOf(rows.map((r) => Number(r.id)));
  res.json({ data: rows.map((r) => json(r, files)) });
});

const validated = (req: Request) =>
  validate(
    req.input,
    {
      title: ["required", "string", "max:200"],
      description: ["nullable", "string", "max:2000"],
      sort_order: ["nullable", "integer", "min:0", "max:999"],
      is_active: ["sometimes", "boolean"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
      remove_file_ids: ["nullable", "array"],
      "remove_file_ids.*": ["integer"],
    },
    { locale: req.locale },
  );

const values = (data: Record<string, unknown>, input: Record<string, unknown>) => ({
  title: String(data.title).trim(),
  description: typeof data.description === "string" && data.description.trim() !== "" ? data.description.trim() : null,
  sort_order: int(data.sort_order) ?? 0,
  is_active: "is_active" in input ? bool(input.is_active) : true,
  updated_at: nowDb(),
});

const uploads = (v: unknown): UploadedFile[] => (v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : []);

/** เพิ่มไฟล์ใหม่ + เอาไฟล์เดิมออก — คืนไฟล์ที่ต้องลบออกจากดิสก์หลัง commit */
async function saveFiles(id: number, data: Record<string, unknown>, userId: number): Promise<FileRow[]> {
  const now = nowDb();
  const removeIds = Object.values((data.remove_file_ids ?? {}) as Record<string, unknown>).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const removed = removeIds.length ? await select<FileRow>("SELECT * FROM other_policy_files WHERE other_policy_id = ? AND id IN (?)", [id, removeIds]) : [];
  if (removed.length) await exec("DELETE FROM other_policy_files WHERE id IN (?)", [removed.map((f) => f.id)]);
  for (const file of uploads(data.files)) {
    const stored = await storeUploadIn(`policy/others/${id}`, file);
    await insert("other_policy_files", { other_policy_id: id, ...stored, uploaded_by: userId, created_at: now, updated_at: now });
  }
  return removed;
}

otherPolicyRoutes.post("/policy/others", async (req, res) => {
  authorize(manages(req));
  const u = me(req);
  const data = await validated(req);
  const id = await transaction(async () => {
    const newId = await insert("other_policies", { ...values(data, req.input), created_by: u.id, created_at: nowDb() });
    await saveFiles(newId, data, u.id);
    return newId;
  });
  await audit(req, { action: "policy.other_created", subjectType: "other_policy", subjectId: id, after: { title: data.title } });
  res.status(201).json({ data: await respond(id) });
});

otherPolicyRoutes.put("/policy/others/:id", async (req, res) => {
  authorize(manages(req));
  const row = await findRow(req);
  const id = Number(row.id);
  const data = await validated(req);
  const removed = await transaction(async () => {
    await update("other_policies", values(data, req.input), "id = ?", [id]);
    return saveFiles(id, data, me(req).id);
  });
  for (const f of removed) await deleteStored(f.path);
  await audit(req, { action: "policy.other_updated", subjectType: "other_policy", subjectId: id, before: { title: row.title }, after: { title: data.title } });
  res.json({ data: await respond(id) });
});

otherPolicyRoutes.delete("/policy/others/:id", async (req, res) => {
  authorize(manages(req));
  const row = await findRow(req);
  const id = Number(row.id);
  const files = await filesOf([id]);
  await exec("DELETE FROM other_policies WHERE id = ?", [id]);
  for (const f of files) await deleteStored(f.path);
  await audit(req, { action: "policy.other_deleted", subjectType: "other_policy", subjectId: id, before: { title: row.title } });
  res.status(204).end();
});

otherPolicyRoutes.get("/policy/others/:id/files/:fileId", async (req, res) => {
  const row = await findRow(req);
  if (!row.is_active && !manages(req)) throw notFound();
  const file = /^\d+$/.test(req.params.fileId) ? await first<FileRow>("SELECT * FROM other_policy_files WHERE id = ? AND other_policy_id = ?", [Number(req.params.fileId), row.id]) : null;
  if (!file) throw notFound();
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});
