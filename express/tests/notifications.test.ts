import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import type { UserRow } from "../src/models/user.js";
import { as, makeUser } from "./helpers.js";

/** หน้ารวมแจ้งเตือน: ดูทั้งหมด (แบ่งหน้า / เฉพาะที่ยังไม่อ่าน) และล้างแจ้งเตือนของตัวเอง */

async function notify(u: UserRow, read = false): Promise<string> {
  const id = randomUUID();
  await insert("notifications", {
    id,
    type: "App\\Notifications\\TicketActivity",
    notifiable_type: "App\\Models\\User",
    notifiable_id: u.id,
    data: JSON.stringify({ kind: "ticket", event: "submitted", ticket_id: randomUUID(), ticket_no: "FM-ITR-01-2026-00001", actor: "x" }),
    read_at: read ? nowDb() : null,
    created_at: nowDb(),
    updated_at: nowDb(),
  });
  return id;
}

const count = (u: UserRow) => scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ?", [u.id]).then(Number);

describe("notifications page", () => {
  it("lists with paging / unread filter and clears only the user's own notifications", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const api = await as(me);
    const keep = await notify(me);
    const single = await notify(me);
    await notify(me, true);
    await notify(me, true);
    const theirs = await notify(other);

    const page1 = await api.get("/api/v1/notifications?per_page=3");
    expect(page1.body).toMatchObject({ unread_count: 2, meta: { total: 4, last_page: 2 } });
    expect((await api.get("/api/v1/notifications?unread=1")).body.data).toHaveLength(2);

    // ลบรายการเดียว — ของคนอื่นลบไม่ได้
    expect((await api.delete(`/api/v1/notifications/${single}`)).status).toBe(204);
    expect((await api.delete(`/api/v1/notifications/${theirs}`)).status).toBe(204);
    expect(await count(me)).toBe(3);
    expect(await count(other)).toBe(1);

    // ล้างเฉพาะที่อ่านแล้ว → เหลือที่ยังไม่อ่าน
    expect((await api.delete("/api/v1/notifications?only=read")).status).toBe(204);
    expect(await scalar("SELECT id FROM notifications WHERE notifiable_id = ?", [me.id])).toBe(keep);

    // ล้างทั้งหมด
    expect((await api.delete("/api/v1/notifications")).status).toBe(204);
    expect(await count(me)).toBe(0);
    expect(await count(other)).toBe(1);
    expect((await api.delete("/api/v1/notifications?only=bogus")).status).toBe(422);
  });
});
