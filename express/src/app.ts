import express, { Router } from "express";
import { config } from "./config.js";
import { auth, errorHandler, locale, notFoundHandler, parseInput, securityHeaders } from "./http.js";
import { limits } from "./lib/rate-limit.js";
import { accessRoutes } from "./routes/access.js";
import { brandingRoutes, publicBrandingRoutes } from "./routes/branding.js";
import { orgUnitRoutes } from "./routes/org-units.js";
import { announcementRoutes, publicAnnouncementRoutes } from "./routes/announcements.js";
import { apiConnectionRoutes } from "./routes/api-connections.js";
import { approvalRouteRoutes } from "./routes/approval-routes.js";
import { assetRoutes } from "./routes/assets.js";
import { authRoutes, loginRoutes } from "./routes/auth.js";
import { itDataRoutes } from "./routes/it-data.js";
import { kpiRoutes } from "./routes/kpi.js";
import { licenseInstallationRoutes } from "./routes/license-installations.js";
import { locationRoutes } from "./routes/locations.js";
import { syncRoutes } from "./routes/sync.js";
import { ticketRoutes } from "./routes/tickets.js";
import { userRoutes } from "./routes/users.js";

/**
 * REST API v1 (path/JSON เดิมจากยุค Laravel — frontend เรียกผ่าน API_URL)
 */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  // query string แบบ PHP (a[]=1) ไม่จำเป็น — ใช้ parser แบบง่าย
  app.set("query parser", "simple");

  // health check (เหมือน /up ของ Laravel)
  app.get("/up", (_req, res) => res.json({ status: "ok" }));

  const v1 = Router();
  v1.use(securityHeaders, locale);
  v1.use(express.json({ limit: "1mb" }), express.urlencoded({ extended: false, limit: "1mb" }), parseInput);

  v1.use(loginRoutes, publicAnnouncementRoutes, publicBrandingRoutes);
  // ทุก endpoint ต่อจากนี้ต้อง login (auth:sanctum) + จำกัด 120 ครั้ง/นาที
  v1.use(auth, limits.api);
  v1.use(authRoutes, assetRoutes, locationRoutes, userRoutes, itDataRoutes, ticketRoutes, kpiRoutes, approvalRouteRoutes, licenseInstallationRoutes, announcementRoutes, syncRoutes, apiConnectionRoutes, accessRoutes, orgUnitRoutes, brandingRoutes);

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
