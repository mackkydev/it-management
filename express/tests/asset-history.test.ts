import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { insert } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeBranch, makeLocation, makeUser } from "./helpers.js";

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
    const lic = await makeAsset({ asset_tag: "SW-1", category: "SOFTWARE" });
    const now = nowDb();
    await insert("asset_licenses", { asset_id: lic.id, billing: "yearly", start_date: "2026-01-01", expires_at: "2026-12-31", seats: 5, created_at: now, updated_at: now });
    for (const removed of [null, null, "2026-05-01"]) {
      await insert("license_installations", { license_asset_id: lic.id, device_name: "PC", installed_at: "2026-02-01", uninstalled_at: removed, created_at: now, updated_at: now });
    }
    const unlimited = await makeAsset({ asset_tag: "SW-2", category: "SOFTWARE" });
    await insert("asset_licenses", { asset_id: unlimited.id, billing: "perpetual", start_date: "2026-01-01", seats: null, created_at: now, updated_at: now });
    await makeAsset({ asset_tag: "PC-1", category: "COMPUTER" });

    const list = (await api.get("/api/v1/assets?per_page=10")).body.data as { asset_tag: string; license_usage?: unknown }[];
    const byTag = Object.fromEntries(list.map((a) => [a.asset_tag, a.license_usage]));
    expect(byTag["SW-1"]).toEqual({ seats: 5, used: 2, available: 3 });
    expect(byTag["SW-2"]).toEqual({ seats: null, used: 0, available: null });
    expect(byTag["PC-1"]).toBeUndefined();
  });
});
