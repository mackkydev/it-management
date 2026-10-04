import { closePool } from "../db.js";
import { notifyExpiring } from "../jobs/notify-expiring.js";

/** npm run notify-expiring [-- --dry-run] — เหมือน php artisan it:notify-expiring {--dry-run} */
const dryRun = process.argv.includes("--dry-run");

try {
  const { items, sent } = await notifyExpiring({ dryRun });
  if (items.length === 0) {
    console.log("ไม่มีรายการใกล้หมดอายุที่ต้องแจ้ง");
  } else {
    console.table(items);
    if (sent) console.log(`ส่งแจ้งเตือนแล้ว ${items.length} รายการ`);
  }
} finally {
  await closePool();
}
