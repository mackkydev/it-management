import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetTickets } from "../src/cli/reset-tickets.js";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeAsset, makeUser } from "./helpers.js";

/** npm run tickets:reset — ล้างใบแจ้งงาน + รายการส่งซ่อมทั้งหมด (สำรองก่อน), คืนสถานะสินทรัพย์ที่ค้างส่งซ่อม, คง audit_logs */
describe("tickets:reset", () => {
  it("dry-run only counts; a real run backs up, deletes tickets / repair orders / notices and restores assets", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const asset = await makeAsset({ status: "active" });
    const now = nowDb();
    const uuid = crypto.randomUUID();
    await insert("it_tickets", {
      uuid,
      ticket_no: `FM-ITR-01-TEST-${uuid.slice(0, 8)}`,
      type: "repair",
      requester_id: requester.id,
      assignee_id: it1.id,
      status: "in_progress",
      details: "แจ้งซ่อม",
      device_name: "PC",
      symptom: "เปิดไม่ติด",
      requested_at: now,
      created_at: now,
      updated_at: now,
    });
    const vendor = (await api.post("/api/v1/vendors").send({ name: "ร้านล้างข้อมูล", address: "กทม", contact_name: "ก", contact_phone: "0800000000", vendor_type: "ซ่อม" })).body.data;
    const sent = await api
      .post("/api/v1/repair-orders")
      .field("asset", asset.uuid)
      .field("symptom", "จอดับ")
      .field("vendor_id", String(vendor.id))
      .field("sent_on", day(0))
      .field("sent_time", "09:00")
      .field("sender_name", "เจ้าของ");
    expect(sent.status).toBe(201);
    expect((await first<{ status: string }>("SELECT status FROM assets WHERE id = ?", [asset.id]))?.status).toBe("in_repair");

    const dry = await resetTickets({ dryRun: true });
    expect(dry.tickets).toBeGreaterThanOrEqual(1);
    expect(dry.repair_orders).toBeGreaterThanOrEqual(1);
    expect(dry.backup_dir).toBeNull();
    expect(Number(await scalar("SELECT COUNT(*) FROM it_tickets"))).toBeGreaterThanOrEqual(1);

    const backupRoot = await mkdtemp(path.join(tmpdir(), "reset-tickets-"));
    const done = await resetTickets({ backupRoot });
    expect(Number(await scalar("SELECT COUNT(*) FROM it_tickets"))).toBe(0);
    expect(Number(await scalar("SELECT COUNT(*) FROM repair_orders"))).toBe(0);
    expect(Number(await scalar("SELECT COUNT(*) FROM notifications WHERE data LIKE ?", [`%${uuid}%`]))).toBe(0);
    expect((await first<{ status: string }>("SELECT status FROM assets WHERE id = ?", [asset.id]))?.status).toBe("active");

    const backup = JSON.parse(readFileSync(path.join(done.backup_dir!, "rows.json"), "utf8")) as Record<string, { uuid?: string }[]>;
    expect(backup.it_tickets.some((t) => t.uuid === uuid)).toBe(true);
    expect(backup.repair_orders.some((r) => r.uuid === sent.body.data.id)).toBe(true);
    expect(existsSync(done.backup_dir!)).toBe(true);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'tickets.reset'"))).toBeGreaterThanOrEqual(1);
    // vendor / ผู้ใช้ / สินทรัพย์ยังอยู่
    expect(Number(await scalar("SELECT COUNT(*) FROM vendors WHERE id = ?", [vendor.id]))).toBe(1);
  });
});
