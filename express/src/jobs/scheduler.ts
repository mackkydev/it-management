import { config } from "../config.js";
import { syncDueConnections } from "../services/directory-sync.js";
import { notifyExpiring } from "./notify-expiring.js";

/**
 * ตั้งเวลารันงานรายวันใน process ของ API (แทน `php artisan schedule:work`)
 * เปิดด้วย SCHEDULER_ENABLED=true — ให้เปิดแค่ instance เดียว (และปิด scheduler ของ Laravel) กันแจ้งซ้ำ
 * เวลา SCHEDULE_NOTIFY_AT (HH:mm) ตาม SCHEDULE_TIMEZONE (ค่าเริ่มต้น 08:00 Asia/Bangkok)
 */

/** เวลาถัดไป (ms จากตอนนี้) ที่นาฬิกาใน timezone นั้นเป็น HH:mm */
export function msUntilNext(time: string, timeZone: string, now = new Date()): number {
  const [hh, mm] = time.split(":").map(Number);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // offset ของ timezone ณ ตอนนี้ = เวลาท้องถิ่น (ตีความเป็น UTC) - เวลาจริง
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  let target = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hh, mm, 0) - offset;
  if (target <= now.getTime()) target += 86_400_000;
  return target - now.getTime();
}

let running = false;

export function startScheduler(): void {
  if (!config.scheduler.enabled) return;
  const schedule = () => {
    const wait = msUntilNext(config.scheduler.time, config.scheduler.timezone);
    setTimeout(run, wait).unref();
    console.info(`[scheduler] it:notify-expiring next run in ${Math.round(wait / 60000)} min`);
  };
  const run = async () => {
    if (!running) {
      running = true; // withoutOverlapping
      try {
        const r = await notifyExpiring();
        console.info(`[scheduler] it:notify-expiring: ${r.sent ? `sent ${r.items.length} item(s)` : "nothing to notify"}`);
      } catch (e) {
        console.error("[scheduler] it:notify-expiring failed", e);
      } finally {
        running = false;
      }
    }
    schedule();
  };
  schedule();

  // ซิงค์รายชื่อ API User ตามรอบของแต่ละการเชื่อมต่อ (ตรวจทุก 5 นาที, ไม่ซ้อนรอบ)
  let syncing = false;
  setInterval(async () => {
    if (syncing) return;
    syncing = true;
    try {
      const n = await syncDueConnections();
      if (n) console.info(`[scheduler] api-user directory sync: ${n} connection(s)`);
    } catch (e) {
      console.error("[scheduler] api-user directory sync failed", e);
    } finally {
      syncing = false;
    }
  }, 5 * 60_000).unref();
}
