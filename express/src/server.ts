import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool, getPool } from "./db.js";
import { startScheduler } from "./jobs/scheduler.js";
import { ensureEnvConnection } from "./services/env-connection.js";
import { ensurePermissions } from "./services/permissions.js";

const app = createApp();

// ตรวจการเชื่อมต่อฐานข้อมูลก่อนเปิดรับ request
await getPool().query("SELECT 1");
// เพิ่ม key สิทธิ์ใหม่ (ถ้ามี) พร้อมสิทธิ์ตั้งต้น — ไม่แตะการกำหนดสิทธิ์ที่ admin ปรับไว้
await ensurePermissions();
// การเชื่อมต่อ API User จาก .env (API_CONN_*, API_CONN_SOURCE=ui สำรอง / env ใช้ .env เสมอ) ค่าผิด = แจ้งใน log แต่ server ยังเปิดได้
const envConn = await ensureEnvConnection().catch((e: unknown) => ({ status: "error" as const, error: String(e) }));
if (envConn.status === "created") console.info(`API connection created from .env (id ${envConn.id})`);
else if (envConn.status === "updated") console.info(`API connection updated from .env (id ${envConn.id}) — locked in the web UI (API_CONN_SOURCE=env)`);
else if (envConn.status === "exists") console.info(`API connection from .env already exists (id ${envConn.id}) — managed in the web UI`);
else if (envConn.status === "invalid") console.error("API connection in .env is invalid — not created:", JSON.stringify(envConn.errors));
else if (envConn.status === "error") console.error("API connection from .env failed:", envConn.error);

const server = app.listen(config.port, () => {
  console.info(`IT-SYSTEM Express API listening on :${config.port} (db ${config.db.database}@${config.db.host}:${config.db.port})`);
});
startScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void closePool().finally(() => process.exit(0)));
  });
}
