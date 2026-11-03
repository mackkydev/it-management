import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeBranch, makeLicenseRow, makeLocation, makeUser } from "./helpers.js";

/** หน้ารายละเอียดสินทรัพย์: ประวัติผู้ใช้งาน + ประวัติการซ่อม / หน้าประวัติการโอนย้าย: ตัวกรองเพิ่ม */

async function ticket(requesterId: number, attrs: Record<string, unknown>): Promise<number> {
  const now = nowDb();
  return insert("it_tickets", {
    uuid: crypto.randomUUID(), ticket_no: `FM-ITR-01-2026-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`, type: "repair", status: "completed",
    requester_id: requesterId, details: "-", requested_at: now, created_at: now, updated_at: now, ...attrs,
  });
}

describe("asset user history (computer register user name / department)", () => {
  it("records create, edit and import changes; unchanged values are not logged", async () => {
    const admin = await makeUser({ role: "admin", name: "ผู้ดูแล" });
    const api = await as(admin);
    const created = await api.post("/api/v1/assets").send({ asset_tag: "LPPC001", name: "Desktop", category: "COMPUTER", user_name: "สมชาย", department: "ผลิต" });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    await api.put(`/api/v1/assets/${id}`).send({ user_name: "  สมชาย  ", department: "ผลิต", ip_address: "10.0.0.5" }); // ไม่เปลี่ยน
    await api.put(`/api/v1/assets/${id}`).send({ user_name: "สุดา", department: "บัญชี" });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Host Name", "Department", "ชื่อ-สกุลผู้ใช้งาน(Thai)"]);
    ws.addRow(["LPPC001", "บัญชี", "มานี"]);
    expect((await api.post("/api/v1/assets/import").attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "a.xlsx")).status).toBe(200);

    const logs = (await api.get(`/api/v1/assets/${id}/user-logs`)).body.data;
    expect(logs.map((l: Record<string, unknown>) => [l.source, l.from_user_name, l.to_user_name, l.from_department, l.to_department])).toEqual([
      ["import", "สุดา", "มานี", "บัญชี", "บัญชี"],
      ["edit", "สมชาย", "สุดา", "ผลิต", "บัญชี"],
      ["create", null, "สมชาย", null, "ผลิต"],
    ]);
    expect(logs[0].performed_by).toEqual({ id: admin.id, name: "ผู้ดูแล" });
  });
});

describe("asset repair history", () => {
  it("lists repair tickets linked by asset id or asset tag, with parts — not cancelled/rejected or other types", async () => {
    const staff = await makeUser({ role: "manager", is_it_staff: true, name: "ช่าง IT" });
    const asset = await makeAsset({ asset_tag: "PC-9" });
    const linked = await ticket(staff.id, { asset_id: asset.id, asset_tag: "PC-9", symptom: "เปิดไม่ติด", result: "completed", repair_method: "external", external_vendor: "ABC", warranty: "in_warranty", repair_details: "เปลี่ยน PSU", assignee_id: staff.id, completed_on: "2026-10-01" });
    await insert("it_ticket_parts", { it_ticket_id: linked, name: "Power supply", quantity: 1, created_at: nowDb(), updated_at: nowDb() });
    await ticket(staff.id, { asset_tag: "PC-9", symptom: "จอฟ้า", status: "in_progress" }); // แจ้งก่อนลงทะเบียน (asset_id ว่าง)
    await ticket(staff.id, { asset_id: asset.id, asset_tag: "PC-9", status: "cancelled" });
    await ticket(staff.id, { asset_id: asset.id, type: "install", status: "completed" });
    await ticket(staff.id, { asset_tag: "PC-OTHER" });

    const api = await as(staff);
    const res = await api.get(`/api/v1/assets/${asset.uuid}/repairs`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const full = res.body.data.find((r: { symptom: string }) => r.symptom === "เปิดไม่ติด");
    expect(full).toMatchObject({ status: "completed", result: "completed", repair_method: "external", external_vendor: "ABC", warranty: "in_warranty", repair_details: "เปลี่ยน PSU", assignee: "ช่าง IT", completed_on: "2026-10-01", parts: [{ name: "Power supply", quantity: 1 }] });

    // ผู้ใช้ที่ไม่ได้ถือครองสินทรัพย์นี้ (และไม่มีสิทธิ์ดูทั้งหมด) → 404
    expect((await (await as(await makeUser({ role: "viewer" }))).get(`/api/v1/assets/${asset.uuid}/repairs`)).status).toBe(404);
  });
});

describe("movements report filters", () => {
  it("filters by change kind, branch, category and custodian name", async () => {
    const admin = await makeUser({ role: "admin" });
    const api = await as(admin);
    const bkk = await makeBranch({ code: "BKK", name: "กรุงเทพ" });
    const [l1, l2] = [await makeLocation(), await makeLocation()];
    const somchai = await makeUser({ name: "สมชาย ใจดี" });
    const pc = await makeAsset({ asset_tag: "PC-1", category: "COMPUTER", branch_id: bkk, location_id: l1 });
    const printer = await makeAsset({ asset_tag: "PR-1", category: "IT", location_id: l1 });

    await api.post(`/api/v1/assets/${pc.uuid}/movements`).send({ custodian_id: somchai.id, location_id: l1 }); // เปลี่ยนผู้ถือครอง
    await api.post(`/api/v1/assets/${printer.uuid}/movements`).send({ location_id: l2 }); // เปลี่ยนสถานที่

    const tags = async (q: string) => (await api.get(`/api/v1/movements?${q}`)).body.data.map((m: { asset: { asset_tag: string } }) => m.asset.asset_tag);
    expect(await tags("type=custodian")).toEqual(["PC-1"]);
    expect(await tags("type=location")).toEqual(["PR-1"]);
    expect(await tags(`branch_id=${bkk}`)).toEqual(["PC-1"]);
    expect(await tags("category=IT")).toEqual(["PR-1"]);
    expect(await tags(`search=${encodeURIComponent("สมชาย")}`)).toEqual(["PC-1"]);
    expect((await api.get("/api/v1/movements?type=bogus")).status).toBe(422);
  });
});

describe("repairs report (all assets)", () => {
  it("lists repair tickets across assets with filters; only for users who see all assets", async () => {
    const staff = await makeUser({ role: "manager", is_it_staff: true });
    const bkk = await makeBranch({ code: "BKK", name: "กรุงเทพ" });
    const pc = await makeAsset({ asset_tag: "PC-1", name: "Desktop", category: "COMPUTER", branch_id: bkk });
    const pr = await makeAsset({ asset_tag: "PR-1", name: "Printer", category: "IT" });
    await ticket(staff.id, { asset_id: pc.id, asset_tag: "PC-1", symptom: "เปิดไม่ติด", repair_method: "external", result: "completed" });
    await ticket(staff.id, { asset_id: pr.id, asset_tag: "PR-1", symptom: "กระดาษติด", status: "in_progress" });
    await ticket(staff.id, { asset_tag: "NB-UNREG", device_name: "Notebook", symptom: "จอแตก", repair_method: "in_house", result: "completed" }); // ยังไม่ลงทะเบียน
    await ticket(staff.id, { asset_id: pc.id, status: "cancelled" });

    const api = await as(staff);
    const syms = async (q = "") => (await api.get(`/api/v1/repairs?${q}`)).body.data.map((r: { symptom: string }) => r.symptom).sort();
    expect(await syms()).toEqual(["กระดาษติด", "จอแตก", "เปิดไม่ติด"]);
    expect(await syms("status=open")).toEqual(["กระดาษติด"]);
    expect(await syms("repair_method=external")).toEqual(["เปิดไม่ติด"]);
    expect(await syms(`branch_id=${bkk}`)).toEqual(["เปิดไม่ติด"]);
    expect(await syms("category=IT")).toEqual(["กระดาษติด"]);
    expect(await syms(`search=${encodeURIComponent("Printer")}`)).toEqual(["กระดาษติด"]);
    const first = (await api.get("/api/v1/repairs?search=PC-1")).body;
    expect(first.meta.total).toBe(1);
    expect(first.data[0]).toMatchObject({ asset: { id: pc.uuid, asset_tag: "PC-1", name: "Desktop", category: "COMPUTER" }, branch: "กรุงเทพ" });

    expect((await (await as(await makeUser({ role: "viewer" }))).get("/api/v1/repairs")).status).toBe(403);
  });
});

describe("asset list license usage", () => {
  it("shows installed / remaining seats for license assets", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const now = nowDb();
    const lic = await makeLicenseRow({ license_no: "SW-1", billing: "yearly", expires_at: "2026-12-31", seats: 5 });
    for (const removed of [null, null, "2026-05-01"]) {
      await insert("license_installations", { license_id: lic.id, device_name: "PC", installed_at: "2026-02-01", uninstalled_at: removed, created_at: now, updated_at: now });
    }
    await makeLicenseRow({ license_no: "SW-2", seats: null });
    await makeAsset({ asset_tag: "PC-1", category: "COMPUTER" });

    // License แยกตารางแล้ว — รายการสินทรัพย์ไม่รวม
    const assets = (await api.get("/api/v1/assets?per_page=10")).body.data as { asset_tag: string }[];
    expect(assets.map((a) => a.asset_tag)).toEqual(["PC-1"]);

    // เมนู License ซอฟต์แวร์: จำนวนที่ใช้ + ไฟล์แนบ — ผู้ใช้ทั่วไปเปิดไม่ได้
    const licenses = (await api.get("/api/v1/licenses")).body.data as { license_no: string; used: number; files_count: number; billing: string; seats: number | null; available: number | null }[];
    expect(licenses.find((l) => l.license_no === "SW-1")).toMatchObject({ seats: 5, used: 2, available: 3, files_count: 0, billing: "yearly" });
    expect(licenses.find((l) => l.license_no === "SW-2")).toMatchObject({ seats: null, used: 0, available: null });
    expect((await (await as(await makeUser())).get("/api/v1/licenses")).status).toBe(403);
  });
});

describe("assets to add (asset numbers typed in repair tickets that are not in the system)", () => {
  it("lists unknown asset numbers once with the latest ticket; known new/old asset numbers and asset tags are left out", async () => {
    const manager = await makeUser({ role: "manager" });
    const api = await as(manager);
    const user = await makeUser({ name: "ผู้แจ้ง" });
    await makeAsset({ asset_tag: "PC-KNOWN", category: "COMPUTER", cpu_tag: "H-NEW-1", monitor_tag: "H-OLD-1" });
    await ticket(user.id, { asset_tag: "H-MISSING", device_name: "Notebook HR", requested_at: "2026-10-01 03:00:00" });
    await ticket(user.id, { asset_tag: " H-MISSING ", symptom: "เปิดไม่ติด", requested_at: "2026-10-05 03:00:00" });
    await ticket(user.id, { asset_tag: "H-NEW-1" });
    await ticket(user.id, { asset_tag: "H-OLD-1" });
    await ticket(user.id, { asset_tag: "PC-KNOWN" });
    await ticket(user.id, { asset_tag: "H-CANCEL", status: "cancelled" });
    await ticket(user.id, { asset_tag: "H-INSTALL", type: "install" });

    const res = await api.get("/api/v1/assets/missing");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ asset_no: "H-MISSING", tickets: 2, last_ticket: { symptom: "เปิดไม่ติด", requester: "ผู้แจ้ง" } });

    // เพิ่มสินทรัพย์ที่มีเลขนี้ → หายจากรายการ
    await makeAsset({ asset_tag: "PC-NEW", category: "COMPUTER", cpu_tag: "H-MISSING" });
    expect((await api.get("/api/v1/assets/missing")).body.data).toEqual([]);
    expect((await (await as(await makeUser())).get("/api/v1/assets/missing")).status).toBe(403);
  });
});

describe("repair tickets match assets by asset number (new / old) as well as the asset code", () => {
  it("links a new ticket typed with the asset number and shows earlier unlinked tickets in the asset's repair history", async () => {
    const user = await makeUser({ name: "ผู้แจ้ง" });
    const admin = await as(await makeUser({ role: "admin" }));
    const earlier = await ticket(user.id, { asset_tag: "H-OLD-9", symptom: "จอดับ" }); // แจ้งก่อนลงทะเบียนเครื่อง
    const pc = await makeAsset({ asset_tag: "PC-NUM", category: "COMPUTER", cpu_tag: "H-NEW-9", monitor_tag: "H-OLD-9" });

    const res = await (await as(user)).post("/api/v1/tickets").send({ type: "repair", branch_id: await makeBranch(), details: "เปิดไม่ติด", device_name: "Desktop", asset_tag: "H-NEW-9", symptom: "เปิดไม่ติด", assignee_id: (await makeUser({ is_it_staff: true })).id });
    expect(res.status, JSON.stringify(res.body.errors)).toBe(201);
    expect(res.body.data.asset).toMatchObject({ id: pc.uuid, asset_tag: "PC-NUM" });

    const repairs = (await admin.get(`/api/v1/assets/${pc.uuid}/repairs`)).body.data as { symptom: string }[];
    expect(repairs.map((r) => r.symptom).sort()).toEqual(["จอดับ", "เปิดไม่ติด"]);
    // รายงานรวม: ใบเดิมที่ยังไม่ผูก asset_id ก็แสดงสินทรัพย์ที่ตรงเลข
    const report = (await admin.get("/api/v1/repairs?search=PC-NUM")).body.data as { id: string; asset: { asset_tag: string } | null }[];
    expect(report.length).toBe(2);
    expect(report.every((r) => r.asset?.asset_tag === "PC-NUM")).toBe(true);
    expect(earlier).toBeGreaterThan(0);
  });
});

describe("holder = user, transfer by branch", () => {
  it("custodian sets the user name; the transfer button moves branch + holder and records both histories", async () => {
    const admin = await makeUser({ role: "admin" });
    const api = await as(admin);
    const [bkk, lpn] = [await makeBranch({ code: "BKK1", name: "กรุงเทพ" }), await makeBranch({ code: "LPN1", name: "ลำพูน" })];
    const [a, b] = [await makeUser({ name: "สมชาย ใจดี" }), await makeUser({ name: "สมหญิง รักดี" })];
    const created = await api.post("/api/v1/assets").send({ asset_tag: "PC-HOLD", name: "Desktop", category: "COMPUTER", branch_id: bkk, custodian_id: a.id, user_name: "ชื่ออื่น" });
    expect(created.body.data).toMatchObject({ user_name: "สมชาย ใจดี", custodian: { id: a.id } });
    const id = created.body.data.id;

    const moved = await api.post(`/api/v1/assets/${id}/movements`).send({ branch_id: lpn, custodian_id: b.id, reason: "ย้ายสาขา" });
    expect(moved.status).toBe(201);
    expect(moved.body.data).toMatchObject({ from_branch: { id: bkk, name: "กรุงเทพ" }, to_branch: { id: lpn, name: "ลำพูน" }, to_custodian: { id: b.id } });
    const detail = (await api.get(`/api/v1/assets/${id}`)).body.data;
    expect(detail).toMatchObject({ branch: { id: lpn }, custodian: { id: b.id }, user_name: "สมหญิง รักดี" });
    const logs = (await api.get(`/api/v1/assets/${id}/user-logs`)).body.data as { from_user_name: string | null; to_user_name: string | null }[];
    expect(logs[0]).toMatchObject({ from_user_name: "สมชาย ใจดี", to_user_name: "สมหญิง รักดี" });
    // ย้ายสาขาอย่างเดียวก็บันทึกได้
    expect((await api.post(`/api/v1/assets/${id}/movements`).send({ branch_id: bkk })).status).toBe(201);
    expect((await api.post(`/api/v1/assets/${id}/movements`).send({ branch_id: bkk })).status).toBe(422); // ไม่เปลี่ยน
  });
});

describe("repairs report keeps the branch recorded on the ticket", () => {
  it("a ticket stays under the branch it was reported from after the asset moves", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const user = await makeUser();
    const [lpn, bkk] = [await makeBranch({ code: "LPN2", name: "ลำพูน" }), await makeBranch({ code: "BKK2", name: "กรุงเทพ" })];
    const pc = await makeAsset({ asset_tag: "PC-MOVE", category: "COMPUTER", branch_id: lpn });
    await ticket(user.id, { asset_id: pc.id, asset_tag: "PC-MOVE", branch_id: lpn, symptom: "ตอนอยู่ลำพูน" });
    await ticket(user.id, { asset_id: pc.id, asset_tag: "PC-MOVE", symptom: "ใบไม่ระบุสาขา" });
    expect((await admin.post(`/api/v1/assets/${pc.uuid}/movements`).send({ branch_id: bkk })).status).toBe(201);

    const at = async (branch: number) => ((await admin.get(`/api/v1/repairs?branch_id=${branch}`)).body.data as { symptom: string; branch: string; asset_branch: string }[]);
    const inLpn = await at(lpn);
    expect(inLpn.map((r) => r.symptom)).toEqual(["ตอนอยู่ลำพูน"]);
    expect(inLpn[0]).toMatchObject({ branch: "ลำพูน", asset_branch: "กรุงเทพ" });
    // ใบที่ไม่ได้ระบุสาขา = ตามสาขาปัจจุบันของเครื่อง
    expect((await at(bkk)).map((r) => r.symptom)).toEqual(["ใบไม่ระบุสาขา"]);
  });
});

describe("linking repair tickets typed with a number not in the register", () => {
  it("adding the asset from the list links its tickets even when the real number differs", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const user = await makeUser({ name: "ผู้แจ้ง" });
    const first = await ticket(user.id, { asset_tag: "cccccc", status: "in_progress", device_name: "EPSON" });
    const second = await ticket(user.id, { asset_tag: "cccccc", status: "completed" });
    const cancelled = await ticket(user.id, { asset_tag: "cccccc", status: "cancelled" });

    // เปลี่ยนเป็นเลขจริง + หมวดที่ไม่ใช่คอมพิวเตอร์ = ยังผูกกับใบเดิม
    const made = await api.post("/api/v1/assets").send({ asset_tag: "LQ310R5", name: "ปริ้นเตอร์", category: "ปริ้นเตอร์", source_asset_no: "cccccc" });
    expect(made.status).toBe(201);
    expect((await api.get("/api/v1/assets/missing")).body.data).toEqual([]);
    const id = await scalar<number>("SELECT id FROM assets WHERE asset_tag = 'LQ310R5'");
    for (const ticketId of [first, second]) expect(Number(await scalar("SELECT asset_id FROM it_tickets WHERE id = ?", [ticketId]))).toBe(Number(id));
    expect(await scalar("SELECT asset_id FROM it_tickets WHERE id = ?", [cancelled])).toBeNull();
    expect((await api.get(`/api/v1/assets/${made.body.data.id}/repairs`)).body.data).toHaveLength(2);
    // เลขที่ผู้แจ้งพิมพ์คงเดิม
    expect(await scalar("SELECT asset_tag FROM it_tickets WHERE id = ?", [first])).toBe("cccccc");
  });

  it("a number can be linked to an existing asset by hand; the link survives editing the ticket", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const branch = await makeBranch();
    const boss = await makeUser({ role: "manager", branch_id: branch });
    const it = await makeUser({ role: "admin", is_it_staff: true });
    const user = await makeUser({ branch_id: branch });
    await makeAsset({ asset_tag: "PR-1", name: "Printer", category: "ปริ้นเตอร์" });
    const id = await ticket(user.id, { asset_tag: "typo", status: "pending_supervisor", approver_id: boss.id, device_name: "EPSON", symptom: "หัวพัง", branch_id: branch });
    await ticket(user.id, { asset_tag: "other" });

    expect((await api.post("/api/v1/assets/missing/link").send({ asset_no: "typo", asset_tag: "NOPE" })).status).toBe(422);
    expect((await (await as(await makeUser())).post("/api/v1/assets/missing/link").send({ asset_no: "typo", asset_tag: "PR-1" })).status).toBe(403);
    const linked = await api.post("/api/v1/assets/missing/link").send({ asset_no: "typo", asset_tag: "PR-1" });
    expect(linked.body.data.tickets).toBe(1);
    expect((await api.get("/api/v1/assets/missing")).body.data.map((m: { asset_no: string }) => m.asset_no)).toEqual(["other"]);
    expect((await api.post("/api/v1/assets/missing/link").send({ asset_no: "typo", asset_tag: "PR-1" })).status).toBe(422);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'asset.tickets_linked'"))).toBe(1);

    const uuid = await scalar<string>("SELECT uuid FROM it_tickets WHERE id = ?", [id]);
    const edited = await (await as(user)).put(`/api/v1/tickets/${uuid}`).send({ type: "repair", branch_id: branch, details: "x", device_name: "EPSON", symptom: "หัวพัง", asset_tag: "typo", approver_id: boss.id, assignee_id: it.id });
    expect(edited.status).toBe(200);
    expect(await scalar("SELECT asset_id FROM it_tickets WHERE id = ?", [id])).not.toBeNull();
  });
});
