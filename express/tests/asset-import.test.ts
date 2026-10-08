import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { first, insert, scalar, select } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/** ทะเบียนคอมพิวเตอร์: import Excel (หัวตารางตามไฟล์จริงของฝ่าย IT) + template + ตัวกรองสาขา */

/** หัวตารางของไฟล์ทะเบียนเดิม (ไม่มี Software อื่นๆ) — ยังนำเข้าได้ */
const HEADERS = [
  "No.", "Department", "ชื่อ-สกุลผู้ใช้งาน(Thai)", "วันที่รับเข้า (Received Date)", "วันที่เริ่มใช้งาน", "Host Name", "Work Group", "MAC Address",
  "Computer Type", "Brand", "IP", "OS", "Office", "Email 365", "Anti Virus", "เลขที่ทรัพย์สิน Notebook", "เลขที่ทรัพย์สินCPU", "เลขที่ทรัพย์สิน Monitor",
];
/** template / ไฟล์ส่งออก: เพิ่ม Software อื่นๆ ต่อจาก Anti Virus */
const TEMPLATE_HEADERS = [...HEADERS.slice(0, 15), "Software อื่นๆ", ...HEADERS.slice(15)];
/** template / ไฟล์ส่งออกปัจจุบัน: ช่องตามฟอร์มใหม่ (ไม่มี Email 365) — ไฟล์รูปแบบด้านบนยังนำเข้าได้ */
const SHEET_HEADERS = [
  "No.", "Department", "ชื่อ-สกุลผู้ใช้งาน(Thai)", "วันที่รับเข้า (Received Date)", "วันที่เริ่มใช้งาน", "Host Name", "ชื่อสินทรัพย์", "Work Group", "MAC Address",
  "Computer Type", "Brand", "รุ่น", "Serial Number", "IP", "OS", "Office", "Anti Virus", "Software อื่นๆ", "เลขที่ทรัพย์สิน Notebook", "เลขที่ทรัพย์สินCPU",
  "เลขที่ทรัพย์สิน Monitor", "สถานะ", "สาขา", "สถานที่", "ผู้ถือครอง", "วันที่ซื้อ", "มูลค่า (บาท)", "วันหมดประกัน", "หมายเหตุ",
];

async function makeLicense(name: string, seats: number | null, tag?: string) {
  const a = await makeAsset({ name, category: "SOFTWARE", ...(tag ? { asset_tag: tag } : {}) });
  const now = nowDb();
  await insert("asset_licenses", { asset_id: a.id, billing: "perpetual", start_date: "2026-01-01", seats, created_at: now, updated_at: now });
  return a;
}

const installs = (host: string) =>
  select<{ name: string; slot: string | null }>(
    `SELECT l.name, i.slot FROM license_installations i JOIN assets l ON l.id = i.license_asset_id JOIN assets d ON d.id = i.device_asset_id
      WHERE d.asset_tag = ? AND i.uninstalled_at IS NULL ORDER BY i.id`,
    [host],
  );

async function download(api: Awaited<ReturnType<typeof as>>, url: string) {
  return api.get(url).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
}

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
    // ยังไม่มี License ในระบบ → OS / Office / Anti Virus เก็บเป็นข้อความ + แจ้งเตือน
    expect(res.body.data.warnings).toContainEqual({ row: 3, message: 'Work Group "UNKNOWNWG" ไม่ตรงกับสาขาใด — นำเข้าโดยไม่ระบุสาขา' });
    expect(res.body.data.warnings).toContainEqual({ row: 2, message: 'OS "Windows 11 Pro" ไม่ตรงกับ License ในระบบ — เก็บเป็นข้อความ (ยังไม่นับ seat)' });

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
    const res = await download(api, "/api/v1/assets/import-template");
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(SHEET_HEADERS);
    expect(wb.worksheets).toHaveLength(2);

    const viewer = await as(await makeUser());
    expect((await viewer.get("/api/v1/assets/import-template")).status).toBe(403);
    expect((await viewer.post("/api/v1/assets/import").attach("file", await xlsx([row("X1")]), "a.xlsx")).status).toBe(403);
    expect((await viewer.get("/api/v1/assets/export")).status).toBe(403);
  });

  it("OS / Office / Anti Virus / other software matching a license are linked and use seats; no match or a full license is kept as text with a warning", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    await makeBranch({ work_group: "LAMPHUN" });
    await makeLicense("Windows 11 Pro", 10);
    await makeLicense("Office 2016", 1);
    await makeLicense("WinRAR", null, "SW-RAR");
    await makeLicense("Adobe Reader, DC", 5);
    const sw = (host: string, others: string, extra: Partial<Record<number, unknown>> = {}) => {
      const r = row(host, extra);
      return [...r.slice(0, 15), others, ...r.slice(15)];
    };
    // ชื่อไม่สนตัวพิมพ์/ช่องว่าง, เลขครุภัณฑ์ของ License ก็ได้, ชื่อที่มี , จับคู่ทั้งบรรทัด, ไม่ตรง = ข้อความ
    const file = await xlsx(
      [sw("PC001", "sw-rar\nAdobe Reader, DC\nNotepad++, 7-Zip", { 11: "windows 11  PRO" }), sw("PC002", "", { 14: "-" })],
      TEMPLATE_HEADERS,
    );
    const res = await api.post("/api/v1/assets/import").attach("file", file, "a.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toEqual([
      { row: 2, message: 'Anti Virus "BitDefender" ไม่ตรงกับ License ในระบบ — เก็บเป็นข้อความ (ยังไม่นับ seat)' },
      { row: 2, message: 'Software อื่นๆ "Notepad++" ไม่ตรงกับ License ในระบบ — เก็บเป็นข้อความ (ยังไม่นับ seat)' },
      { row: 2, message: 'Software อื่นๆ "7-Zip" ไม่ตรงกับ License ในระบบ — เก็บเป็นข้อความ (ยังไม่นับ seat)' },
      // Office 2016 มี 1 seat — เครื่องแรกใช้ไปแล้ว
      { row: 3, message: 'Office "Office 2016" ติดตั้งครบ 1 เครื่องแล้ว — เก็บเป็นข้อความ (ยังไม่นับ seat)' },
    ]);
    expect(await installs("PC001")).toEqual([
      { name: "Windows 11 Pro", slot: "os" },
      { name: "Office 2016", slot: "office" },
      { name: "WinRAR", slot: null },
      { name: "Adobe Reader, DC", slot: null },
    ]);
    expect(await first("SELECT os, office, antivirus, other_software FROM assets WHERE asset_tag = 'PC001'")).toEqual({
      os: "Windows 11 Pro", office: "Office 2016", antivirus: "BitDefender", other_software: "Notepad++\n7-Zip",
    });
    expect(await installs("PC002")).toEqual([{ name: "Windows 11 Pro", slot: "os" }]);
    expect(await first("SELECT office, antivirus, other_software FROM assets WHERE asset_tag = 'PC002'")).toEqual({ office: "Office 2016", antivirus: null, other_software: null });

    // นำเข้าซ้ำ: ที่ผูกอยู่แล้วคงไว้ (ไม่ใช้ seat เพิ่ม), เอาออกจากไฟล์ = ถอนการติดตั้ง
    const again = await api.post("/api/v1/assets/import").attach("file", await xlsx([sw("PC001", "WinRAR", { 12: "" })], TEMPLATE_HEADERS), "a.xlsx");
    expect(again.status).toBe(200);
    expect(await installs("PC001")).toEqual([{ name: "Windows 11 Pro", slot: "os" }, { name: "WinRAR", slot: null }]);
    expect(await first("SELECT office, other_software FROM assets WHERE asset_tag = 'PC001'")).toEqual({ office: null, other_software: null });

    // ไฟล์เดิมที่ไม่มีคอลัมน์ Software อื่นๆ = ไม่แตะ Software อื่นๆ ที่ผูกไว้
    await api.post("/api/v1/assets/import").attach("file", await xlsx([row("PC001")]), "old.xlsx");
    expect((await installs("PC001")).map((i) => i.name)).toContain("WinRAR");
  });

  it("export uses the import columns and the current filters, and the file imports back unchanged", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const lamphun = await makeBranch({ work_group: "LAMPHUN" });
    await makeBranch({ work_group: "BKK" });
    await makeLicense("Windows 11 Pro", 10);
    await makeLicense("WinRAR", null);
    const sw = (host: string, others: string, extra: Partial<Record<number, unknown>> = {}) => {
      const r = row(host, extra);
      return [...r.slice(0, 15), others, ...r.slice(15)];
    };
    await api
      .post("/api/v1/assets/import")
      .attach("file", await xlsx([sw("LP001", "WinRAR\nLINE"), sw("BK001", "", { 6: "BKK" })], TEMPLATE_HEADERS), "a.xlsx");
    await makeAsset({ asset_tag: "MN-001", category: "IT", branch_id: lamphun });

    const res = await download(api, `/api/v1/assets/export?branch_id=${lamphun}`);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(SHEET_HEADERS);
    expect(ws.rowCount).toBe(2); // เฉพาะคอมพิวเตอร์ของสาขาที่กรอง
    const cells = (ws.getRow(2).values as unknown[]).slice(1);
    const at = (h: string) => cells[SHEET_HEADERS.indexOf(h)];
    expect(at("Host Name")).toBe("LP001");
    expect(at("OS")).toBe("Windows 11 Pro");
    expect(at("Software อื่นๆ")).toBe("WinRAR\nLINE");
    expect(at("วันที่รับเข้า (Received Date)")).toEqual(new Date(Date.UTC(2022, 8, 12)));
    expect(at("สถานะ")).toBe("ใช้งาน");

    // นำไฟล์ที่ส่งออกกลับเข้ามา = อัปเดตเครื่องเดิม ข้อมูล/การติดตั้งไม่เปลี่ยน
    const before = await select("SELECT * FROM assets WHERE asset_tag = 'LP001'");
    const back = await api.post("/api/v1/assets/import").attach("file", Buffer.from(res.body), "export.xlsx");
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ created: 0, updated: 1 });
    const after = await select("SELECT * FROM assets WHERE asset_tag = 'LP001'");
    const strip = (r: Record<string, unknown>[]) => r.map(({ updated_at: _u, ...x }) => x);
    expect(strip(after as Record<string, unknown>[])).toEqual(strip(before as Record<string, unknown>[]));
    expect(await installs("LP001")).toEqual([{ name: "Windows 11 Pro", slot: "os" }, { name: "WinRAR", slot: null }]);
    expect(Number(await scalar("SELECT COUNT(*) FROM license_installations WHERE uninstalled_at IS NOT NULL"))).toBe(0);
  });

  it("monitor tag suggestions search the asset register (not computers or software) and need assets.manage", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    await makeAsset({ asset_tag: "H-OFCO-22204", name: "Monitor Dell 24", category: "IT" });
    await makeAsset({ asset_tag: "H-OFCO-1", name: "Desktop", category: "COMPUTER" });
    await makeLicense("H-OFCO Suite", 1, "H-OFCO-SW");
    const res = await api.get("/api/v1/assets/tag-suggestions?q=h-ofco");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ asset_tag: "H-OFCO-22204", name: "Monitor Dell 24", brand: null, model: null, category: "IT" }]);
    expect((await api.get(`/api/v1/assets/tag-suggestions?q=${encodeURIComponent("dell")}`)).body.data).toHaveLength(1);
    expect((await (await as(await makeUser())).get("/api/v1/assets/tag-suggestions?q=h")).status).toBe(403);
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

describe("computer register import — columns of the asset form", () => {
  const COLS = ["Host Name", "ชื่อสินทรัพย์", "รุ่น", "Serial Number", "สถานะ", "สาขา", "สถานที่", "ผู้ถือครอง", "วันที่ซื้อ", "มูลค่า (บาท)", "วันหมดประกัน", "หมายเหตุ", "ชื่อ-สกุลผู้ใช้งาน(Thai)", "Department"];

  it("imports name / model / serial / status / branch / location / custodian / purchase data and records movements", async () => {
    const api = await as(await makeUser({ role: "admin" }), "th");
    const branch = await makeBranch({ code: "KKN", name: "ขอนแก่น" });
    const owner = await makeUser({ name: "สมหญิง ใจดี", email: "somying@example.com", department: "บัญชี" });
    await makeUser({ name: "ชื่อซ้ำ" });
    await makeUser({ name: "ชื่อซ้ำ" });

    const res = await api.post("/api/v1/assets/import").attach(
      "file",
      await xlsx(
        [
          ["PC-F1", "Notebook บัญชี", "ThinkPad E14", "SN-123", "ส่งซ่อม", "KKN", "ห้องบัญชี ชั้น 2", "somying@example.com", "15/01/2568", "25,900", "15/01/2571", "เครื่องสำรอง", "สมหญิง ใจดี", null],
          ["PC-F2", null, null, null, null, "ไม่มีสาขานี้", null, "ชื่อซ้ำ", null, null, null, null, null, null],
        ],
        COLS,
      ),
      "f.xlsx",
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, updated: 0 });
    const warnings = res.body.data.warnings.map((w: { message: string }) => w.message).join(" | ");
    expect(warnings).toContain("เพิ่มสถานที่ใหม่ \"ห้องบัญชี ชั้น 2\"");
    expect(warnings).toContain("สาขา \"ไม่มีสาขานี้\"");
    expect(warnings).toContain("มีผู้ใช้ชื่อ \"ชื่อซ้ำ\" หลายคน");

    const pc = await first<Record<string, unknown>>("SELECT * FROM assets WHERE asset_tag = 'PC-F1'");
    const loc = await first<{ id: number; code: string }>("SELECT id, code FROM locations WHERE name = 'ห้องบัญชี ชั้น 2'");
    expect(loc?.code).toMatch(/^LOC-\d{4}$/);
    expect(pc).toMatchObject({
      name: "Notebook บัญชี", model: "ThinkPad E14", serial_number: "SN-123", status: "in_repair", notes: "เครื่องสำรอง",
      purchase_cost: "25900.00", department: "บัญชี", // แผนกเติมจากผู้ใช้ที่ชื่อตรงกัน
    });
    expect(Number(pc?.branch_id)).toBe(branch);
    expect(Number(pc?.location_id)).toBe(Number(loc?.id));
    expect(Number(pc?.custodian_id)).toBe(owner.id);
    expect(String(pc?.purchase_date).slice(0, 10)).toBe("2025-01-15");
    expect(String(pc?.warranty_expires_at).slice(0, 10)).toBe("2028-01-15");
    expect(await scalar("SELECT COUNT(*) FROM asset_movements WHERE asset_id = ? AND type = 'registered'", [pc?.id])).toBe(1);

    const pc2 = await first<Record<string, unknown>>("SELECT * FROM assets WHERE asset_tag = 'PC-F2'");
    expect(pc2).toMatchObject({ name: "Computer", status: "active", custodian_id: null, branch_id: null });

    // แก้ไขผ่านไฟล์: เปลี่ยนผู้ถือครอง/สถานที่ = บันทึกการโอนย้าย, ไม่มีคอลัมน์ = คงเดิม
    const again = await api.post("/api/v1/assets/import").attach("file", await xlsx([["PC-F1", "ห้องบัญชี ชั้น 2", ""]], ["Host Name", "สถานที่", "ผู้ถือครอง"]), "g.xlsx");
    expect(again.body.data).toMatchObject({ created: 0, updated: 1 });
    const moved = await first<Record<string, unknown>>("SELECT * FROM assets WHERE asset_tag = 'PC-F1'");
    expect(moved).toMatchObject({ custodian_id: null, name: "Notebook บัญชี", status: "in_repair" });
    expect(await scalar("SELECT COUNT(*) FROM asset_movements WHERE asset_id = ? AND type = 'transfer' AND reason = 'นำเข้า Excel'", [pc?.id])).toBe(1);
    expect(await scalar("SELECT COUNT(*) FROM locations WHERE name = 'ห้องบัญชี ชั้น 2'")).toBe(1); // ไม่สร้างซ้ำ
  });

  it("rejects an unknown status, a bad cost and a future purchase date (nothing is saved)", async () => {
    const api = await as(await makeUser({ role: "admin" }), "th");
    const res = await api.post("/api/v1/assets/import").attach(
      "file",
      await xlsx([["PC-X1", "พัง", null], ["PC-X2", null, "สองหมื่น"], ["PC-X3", null, null, "01/01/2600"]], ["Host Name", "สถานะ", "มูลค่า (บาท)", "วันที่ซื้อ"]),
      "x.xlsx",
    );
    expect(res.status).toBe(422);
    const messages = res.body.rows.map((r: { message: string }) => r.message).join(" | ");
    expect(messages).toContain("สถานะ \"พัง\" ไม่ถูกต้อง");
    expect(messages).toContain("มูลค่า \"สองหมื่น\"");
    expect(messages).toContain("วันที่ซื้อต้องไม่เกินวันนี้");
    expect(await scalar("SELECT COUNT(*) FROM assets WHERE asset_tag LIKE 'PC-X%'")).toBe(0);
  });
});
