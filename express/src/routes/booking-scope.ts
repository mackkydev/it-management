import { Router, type Request } from "express";
import { select } from "../db.js";
import { authorize, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { BOOKING_KINDS, BOOKING_SCOPES, bookingScopeSettings, scopeMeta, type BookingKind, type BookingScope } from "../services/booking-scope.js";
import { putSetting } from "../services/settings.js";

/**
 * ขอบเขตห้องประชุม / รถ ตามสาขา ต่อกลุ่มสิทธิ์ (services/booking-scope.ts)
 *   GET /booking-scope/me?kind=meeting|vehicle   ขอบเขตของฉัน + สาขาที่เลือกดูได้ (ทุกคน)
 *   GET/PUT /booking-scope                       ตั้งค่าต่อกลุ่ม (access.manage — หน้า /role-permissions)
 */
export const bookingScopeRoutes = Router();

const t = (req: Request, key: string) => trans(req.locale, key);

bookingScopeRoutes.get("/booking-scope/me", async (req, res) => {
  const kind = (BOOKING_KINDS as readonly string[]).includes(String(req.query.kind)) ? (String(req.query.kind) as BookingKind) : "meeting";
  res.json({ data: await scopeMeta(me(req), kind) });
});

bookingScopeRoutes.get("/booking-scope", async (req, res) => {
  authorize(can(me(req), "access.manage"));
  res.json({ data: await bookingScopeSettings() });
});

bookingScopeRoutes.put("/booking-scope", async (req, res) => {
  const u = me(req);
  authorize(can(u, "access.manage"));
  const groups = (await select<{ key: string }>('SELECT "key" FROM permission_groups')).map((g) => g.key);
  const before = await bookingScopeSettings();
  const next = { ...before };
  for (const kind of BOOKING_KINDS) {
    const input = req.input[kind];
    if (input === undefined) continue;
    const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
    if (!raw) throw ValidationError.withMessages({ [kind]: t(req, "eam.meeting.scope_invalid") });
    const map: Record<string, BookingScope> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!groups.includes(k) || !(BOOKING_SCOPES as readonly unknown[]).includes(v)) throw ValidationError.withMessages({ [kind]: t(req, "eam.meeting.scope_invalid") });
      map[k] = v as BookingScope;
    }
    next[kind] = map;
  }
  await putSetting("booking_scope", next, u.id);
  await audit(req, { action: "booking_scope.updated", subjectType: "app_setting", subjectId: "booking_scope", before, after: next });
  res.json({ data: next });
});
