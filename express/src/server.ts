import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool, getPool } from "./db.js";
import { startScheduler } from "./jobs/scheduler.js";

const app = createApp();

// ตรวจการเชื่อมต่อฐานข้อมูลก่อนเปิดรับ request
await getPool().query("SELECT 1");

const server = app.listen(config.port, () => {
  console.info(`IT-SYSTEM Express API listening on :${config.port} (db ${config.db.database}@${config.db.host}:${config.db.port})`);
});
startScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void closePool().finally(() => process.exit(0)));
  });
}
