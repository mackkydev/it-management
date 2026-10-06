import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { first, scalar, select } from "../src/db.js";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/** ทะเบียนคอมพิวเตอร์: import Excel (หัวตารางตามไฟล์จริงของฝ่าย IT) + template + ตัวกรองสาขา */

const HEADERS = [
  "No.", "Department", "ชื่อ-สกุลผู้ใช้งาน(Thai)", "วันที่รับเข้า (Received Date)", "วันที่เริ่มใช้งาน", "Host Name", "Work Group", "MAC Address",
  "Computer Type", "Brand", "IP", "OS", "Office", "Email 365", "Anti Virus", "เลขที่ทรัพย์สิน Notebook", "เลขที่ทรัพย์สินCPU", "เลขที่ทรัพย์สิน Monitor",
];

/** วันที่ในไฟล์จริงเป็นเซลล์วันที่ปี พ.ศ. (เช่น 2565) */
const be = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function xlsx(rows: unknown[][], headers = HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const row = (host: string, extra: Partial<Record<number, unknown>> = {}) => {
  const r: unknown[] = [1, "ผลิต", "ชิดชมัย นิงโขง", be(2565, 9, 12), be(2565, 9, 13), host, "LAMPHUN", "A0:36:BC:25:1C:5C", "Desktop", "-",
    "192.168.4.36", "Windows 11 Pro", "Office 2016", "-", "BitDefender", "-", "H-OFCO-22093", "H-OFCO-22204"];
  for (const [i, v] of Object.entries(extra)) r[Number(i)] = v;
  return r;
};

describe("computer register import", () => {
  it("imports rows as COMPUTER assets (Host Name = code), converts Buddhist-era dates, maps the branch from Work Group", async () => {
    const lamphun = await makeBranch({ code: "LPN", name: "ลำพูน", work_group: "LAMPHUN" });
    const api = await as(await makeUser({ role: "admin" }));
    const file = await xlsx([row("LPPCPRD001"), row("LPNBHRD001", { 2: "ณภัทร คำลือกาศ", 8: "Laptop", 9: "LENOVO", 15: "L-OFCO-22001", 16: "-", 17: "-", 6: "UNKNOWNWG" })]);

    const res = await api.post("/api/v1/assets/import").attach("file", file, "assets.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, updated: 0 });
    expect(res.body.data.warnings).toEqual([{ row: 3, message: 'Work Group "UNKNOWNWG" ไม่ตรงกับสาขาใด — นำเข้าโดยไม่ระบุสาขา' }]);

    const pc = await first<Record<string, unknown>>("SELECT * FROM assets WHERE asset_tag = 'LPPCPRD001'");
    expect(pc).toMatchObject({
      category: "COMPUTER", name: "Desktop", status: "active", branch_id: lamphun, department: "ผลิต", user_name: "ชิดชมัย นิงโขง",
      received_date: "2022-09-12", start_use_date: "2022-09-13", work_group: "LAMPHUN", mac_address: "A0:36:BC:25:1C:5C", brand: null,
      ip_address: "192.168.4.36", os: "Windows 11 Pro", office: "Office 2016", email_365: null, antivirus: "BitDefender",
      notebook_tag: null, cpu_tag: "H-OFCO-22093", monitor_tag: "H-OFCO-22204",
    });
    expect(await first("SELECT name, brand, branch_id, notebook_tag FROM assets WHERE asset_tag = 'LPNBHRD001'")).toEqual({
      name: "Laptop LENOVO", brand: "LENOVO", branch_id: null, notebook_tag: "L-OFCO-22001",
    });

    // ตัวกรองสาขา + ค้นหาชื่อผู้ใช้งาน + ข้อมูลเครื่องใน API
    const list = await api.get(`/api/v1/assets?branch_id=${lamphun}`);
    expect(list.body.data.map((a: { asset_tag: string }) => a.asset_tag)).toEqual(["LPPCPRD001"]);
    expect(list.body.data[0]).toMatchObject({ branch: { id: lamphun, name: "ลำพูน" }, ip_address: "192.168.4.36", received_date: "2022-09-12" });
    expect((await api.get(`/api/v1/assets?search=${encodeURIComponent("ณภัทร")}`)).body.data.map((a: { asset_tag: string }) => a.asset_tag)).toEqual(["LPNBHRD001"]);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'asset.imported'")).toBe(1);
  });

  it("the same Host Name updates the existing computer (case-insensitive)", async () => {
    await makeBranch({ work_group: "LAMPHUN" });
    const api = await as(await makeUser({ role: "admin" }));
    await api.post("/api/v1/assets/import").attach("file", await xlsx([row("LPPCPRD001")]), "a.xlsx");
    const again = await api.post("/api/v1/assets/import").attach("file", await xlsx([row("lppcprd001", { 10: "192.168.4.99", 2: "คนใหม่" })]), "a.xlsx");
    expect(again.body.data).toMatchObject({ created: 0, updated: 1 });
    expect(await select("SELECT asset_tag, ip_address, user_name FROM assets")).toEqual([{ asset_tag: "LPPCPRD001", ip_address: "192.168.4.99", user_name: "คนใหม่" }]);
  });

  it("any invalid row rejects the whole file and lists every row to fix", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    await makeAsset({ asset_tag: "IT-0001", category: "IT" });
    const bad = await xlsx([
      row("OK001"),
      row("", { 1: "ผลิต" }), // ไม่มี Host Name
      row("OK001"), // ซ้ำในไฟล์
      row("BAD HOST"), // มีช่องว่าง
      row("OK002", { 3: "31/02/2565" }), // วันที่ไม่มีจริง
      row("IT-0001"), // ซ้ำกับสินทรัพย์หมวดอื่น
    ]);
    const res = await api.post("/api/v1/assets/import").attach("file", bad, "bad.xlsx");
    expect(res.status).toBe(422);
    expect(res.body.rows.map((r: { row: number }) => r.row)).toEqual([3, 4, 5, 6]);
    expect(await scalar("SELECT COUNT(*) FROM assets WHERE category = 'COMPUTER'")).toBe(0);

    // แถวที่เหลือผ่านหมด แต่ชนกับหมวดอื่น → ตรวจกับข้อมูลในระบบแล้วไม่บันทึกเลย
    const other = await api.post("/api/v1/assets/import").attach("file", await xlsx([row("NEW001"), row("IT-0001")]), "b.xlsx");
    expect(other.status).toBe(422);
    expect(other.body.rows).toEqual([{ row: 3, message: 'Host Name "IT-0001" ซ้ำกับรหัสสินทรัพย์หมวดอื่น' }]);
    expect(await scalar("SELECT COUNT(*) FROM assets WHERE asset_tag = 'NEW001'")).toBe(0);

    const noHeader = await api.post("/api/v1/assets/import").attach("file", await xlsx([["x"]], ["A", "B"]), "c.xlsx");
    expect(noHeader.body.rows[0].message).toContain("Host Name");
    expect((await api.post("/api/v1/assets/import").attach("file", Buffer.from("not excel"), "d.xlsx")).status).toBe(422);
  });

  it("template has the register headers; import and template need assets.manage", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const res = await api.get("/api/v1/assets/import-template").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS);
    expect(wb.worksheets).toHaveLength(2);

    const viewer = await as(await makeUser());
    expect((await viewer.get("/api/v1/assets/import-template")).status).toBe(403);
    expect((await viewer.post("/api/v1/assets/import").attach("file", await xlsx([row("X1")]), "a.xlsx")).status).toBe(403);
  });

  it("branch Work Group is unique (case-insensitive) and stored upper-case", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const a = await api.post("/api/v1/branches").send({ code: "LPN", name: "ลำพูน", work_group: " lamphun " });
    expect(a.body.data.work_group).toBe("LAMPHUN");
    const dup = await api.post("/api/v1/branches").send({ code: "LP2", name: "ลำพูน 2", work_group: "Lamphun" });
    expect(dup.status).toBe(422);
    expect(dup.body.errors).toHaveProperty("work_group");
  });
});
