import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, dbConfig } from "../config.js";
import { closePool, exec, scalar, select, transaction } from "../db.js";
import { audit } from "../services/audit.js";

/**
 * ล้างใบแจ้งงานทั้งหมด (ใช้ตอนทดสอบ — เริ่มเลขที่ใบงานใหม่ที่ 00001)
 *   npm run tickets:reset                 ดูว่าจะลบอะไรบ้าง (ไม่ลบ)
 *   npm run tickets:reset -- --yes        ลบจริง
 *   เครื่องจริง (NODE_ENV=production) ต้องเพิ่ม --allow-production; ใน container: node dist/cli/reset-tickets.js --yes
 *
 * ลบ: ใบแจ้งงานทุกใบ (+ ประวัติ / ไฟล์แนบ / อะไหล่ / ผู้ร่วม / สายอนุมัติ / แถว KPI / งานหน้างานในปฏิทิน — FK cascade),
 *     รายการส่งซ่อมทั้งหมด (+ ไฟล์ / อะไหล่), การจอง ZOOM ที่มีใบงาน, คำขอ VPN ที่ยังไม่ได้มอบบัญชี (requested), แจ้งเตือนของเรื่องเหล่านี้
 * คงไว้: audit_logs (ห้ามลบ), Vendor, ผู้ใช้, สินทรัพย์ (ที่ค้างสถานะส่งซ่อม = คืนสถานะเดิม), บัญชี VPN ที่มอบแล้ว (หลุดจากใบงาน)
 * สำรองก่อนลบเสมอ: แถวทั้งหมดเป็น JSON + ย้ายโฟลเดอร์ไฟล์ tickets/{uuid}, repair-orders/{uuid} ไปที่ {FILES_ROOT}/_backups/reset-tickets-{เวลา}/
 */

/** ตารางที่ถูกลบ (รวมที่ลบตาม FK cascade) — สำรองตามลำดับนี้ */
const BACKUP_TABLES: [table: string, where: string][] = [
  ["it_tickets", "1 = 1"],
  ["it_ticket_events", "1 = 1"],
  ["it_ticket_attachments", "1 = 1"],
  ["it_ticket_parts", "1 = 1"],
  ["it_ticket_helpers", "1 = 1"],
  ["it_ticket_approval_steps", "1 = 1"],
  ["kpi_entries", "ticket_id IS NOT NULL"],
  ["calendar_events", "ticket_id IS NOT NULL"],
  ["repair_orders", "1 = 1"],
  ["repair_order_files", "1 = 1"],
  ["repair_order_parts", "1 = 1"],
  ["zoom_bookings", "ticket_id IS NOT NULL"],
  ["vpn_loans", "ticket_id IS NOT NULL AND status = 'requested'"],
];

export interface ResetSummary {
  tickets: number;
  repair_orders: number;
  zoom_bookings: number;
  vpn_requests: number;
  notifications: number;
  assets_restored: number;
  file_folders: number;
  backup_dir: string | null;
}

/** เรื่องที่แจ้งเตือนอ้างถึง (notifications.subject_ref) ของข้อมูลที่จะลบ */
const SUBJECT_REFS = `SELECT uuid FROM it_tickets
  UNION SELECT uuid FROM repair_orders
  UNION SELECT uuid FROM zoom_bookings WHERE ticket_id IS NOT NULL
  UNION SELECT uuid FROM vpn_loans WHERE ticket_id IS NOT NULL AND status = 'requested'`;

const count = async (sql: string) => Number(await scalar(sql));

export async function resetTickets(opts: { dryRun?: boolean; backupRoot?: string } = {}): Promise<ResetSummary> {
  const ticketUuids = (await select<{ uuid: string }>("SELECT uuid FROM it_tickets")).map((r) => r.uuid);
  const orderUuids = (await select<{ uuid: string }>("SELECT uuid FROM repair_orders")).map((r) => r.uuid);
  const folders = [...ticketUuids.map((u) => path.join("tickets", u)), ...orderUuids.map((u) => path.join("repair-orders", u))].filter((rel) =>
    existsSync(path.resolve(config.filesRoot, rel)),
  );
  const summary: ResetSummary = {
    tickets: ticketUuids.length,
    repair_orders: orderUuids.length,
    zoom_bookings: await count("SELECT COUNT(*) FROM zoom_bookings WHERE ticket_id IS NOT NULL"),
    vpn_requests: await count("SELECT COUNT(*) FROM vpn_loans WHERE ticket_id IS NOT NULL AND status = 'requested'"),
    notifications: await count(`SELECT COUNT(*) FROM notifications WHERE subject_ref IN (${SUBJECT_REFS})`),
    assets_restored: await count("SELECT COUNT(DISTINCT asset_id) FROM repair_orders WHERE status = 'sent' AND asset_id IS NOT NULL"),
    file_folders: folders.length,
    backup_dir: null,
  };
  if (opts.dryRun) return summary;

  // 1) สำรอง: แถวทั้งหมดเป็น JSON (อ่านกลับด้วยมือได้) — ก่อนแตะข้อมูลใดๆ
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(opts.backupRoot ?? path.join(config.filesRoot, "_backups"), `reset-tickets-${stamp}`);
  await mkdir(dir, { recursive: true });
  const rows: Record<string, unknown[]> = {};
  for (const [table, where] of BACKUP_TABLES) rows[table] = await select(`SELECT * FROM ${table} WHERE ${where}`);
  rows.notifications = await select(`SELECT * FROM notifications WHERE subject_ref IN (${SUBJECT_REFS})`);
  await writeFile(path.join(dir, "rows.json"), JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  summary.backup_dir = dir;

  // 2) ลบในฐานข้อมูล (transaction เดียว)
  await transaction(async () => {
    // เครื่องที่ยังส่งซ่อมอยู่: คืนสถานะก่อนส่งซ่อม (เฉพาะที่ยังเป็น in_repair — เหมือน restoreAssetStatus)
    await exec(
      `UPDATE assets a JOIN repair_orders r ON r.asset_id = a.id AND r.status = 'sent'
        SET a.status = COALESCE(r.asset_prev_status, 'active'), a.updated_at = NOW() WHERE a.status = 'in_repair'`,
    );
    await exec(`DELETE FROM notifications WHERE subject_ref IN (SELECT ref FROM (${SUBJECT_REFS}) AS refs(ref))`);
    await exec("DELETE FROM zoom_bookings WHERE ticket_id IS NOT NULL");
    await exec("DELETE FROM vpn_loans WHERE ticket_id IS NOT NULL AND status = 'requested'");
    await exec("DELETE FROM repair_orders");
    await exec("DELETE FROM it_tickets");
  });

  // 3) ย้ายไฟล์ของใบงาน / รายการส่งซ่อมไปไว้ในโฟลเดอร์สำรอง (ไม่ลบทิ้ง)
  for (const rel of folders) {
    const target = path.join(dir, "files", rel);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.resolve(config.filesRoot, rel), target);
  }

  await audit({}, { action: "tickets.reset", subjectType: "it_ticket", subjectId: "all", after: { ...summary, backup_dir: path.basename(dir) } });
  return summary;
}

const describe = (s: ResetSummary) =>
  [
    `tickets: ${s.tickets}`,
    `repair orders: ${s.repair_orders}`,
    `ZOOM bookings with a ticket: ${s.zoom_bookings}`,
    `VPN requests not yet assigned: ${s.vpn_requests}`,
    `notifications: ${s.notifications}`,
    `assets still out for repair (status restored): ${s.assets_restored}`,
    `file folders (moved to backup): ${s.file_folders}`,
  ].join("\n  ");

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  if (yes && process.env.NODE_ENV === "production" && !args.includes("--allow-production")) {
    throw new Error("NODE_ENV=production — add --allow-production to really delete every ticket on this server");
  }
  console.log(`database: ${dbConfig().database} · files: ${config.filesRoot}`);
  if (!yes) {
    const s = await resetTickets({ dryRun: true });
    console.log(`[dry-run] would delete:\n  ${describe(s)}`);
    console.log("audit_logs, vendors, users and assets are kept. Run again with --yes to delete (a backup is written first).");
    return;
  }
  const s = await resetTickets();
  console.log(`deleted:\n  ${describe(s)}`);
  console.log(`backup: ${s.backup_dir}`);
  console.log("the next ticket number starts again at 00001");
}

// เรียกตรงจาก CLI เท่านั้น (เทสต์ import resetTickets ได้)
if (process.argv[1] && /reset-tickets\.(ts|js)$/.test(process.argv[1])) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
