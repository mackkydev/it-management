# ออกแบบ: ดึง Fixed Assets จาก STEC SyteLine API มาเก็บในระบบ IT

สถานะ: **ระยะ 1–2 ทำแล้ว** (ซิงค์ + หน้า `/fixed-assets` + ผูกด้วยมือ + การ์ดในหน้าสินทรัพย์ + ตัวเลขเมนู) — อ้างอิงคู่มือ STEC SyteLine API **Rev 4.6** (12 พ.ย. 2026) — 2026-11-16

## 1. ที่มา / ข้อเท็จจริงที่ตรวจแล้ว

- STEC API Portal มีรายงาน Fixed Assets 3 ตัว (portal เรียกผ่าน route ของตัวเอง `/api/reports/<name>`):

| รายงาน | ตัวกรอง | ผลลัพธ์ (`{ recordsets: [[...]] }`) | ตัวอย่าง HO |
|---|---|---|---|
| `falist` | `pSite` | site, sitename, fanum, fadesc | 1,940 แถว |
| `faclassdeptlist` | `pSite` | site, sitename, classdept, deptdesc | 106 แถว |
| `facurrentdepreciation` | `period` (YYYY-MM-DD), `fatype` (L/R), `fastat` (A/D/I), ช่วง class-dept, ช่วง fanum, ช่วงวันจำหน่าย, obligation type (BK/HP/LS), `pSite` | 37 ฟิลด์ (ข้อ 4) | 1,940 แถว, ~15 วินาที |

- สาขา (site): HO, BR, CB, CR, DP, KK, LP, NR, PB, ST, UB
- คู่มือ **Rev 4.6** ข้อ 3.16–3.18 ระบุ endpoint แล้ว: `/api/v1/reports/falist?pSite`, `/faclassdeptlist?pSite`, `/facurrentdepreciation?period&pSite[&fatype&fastat&classdeptfrom/to&fanumfrom/to&disposaldatefrom/to&obligationtypefrom/to]` — pSite ≤ 8 ตัว, fanum ≤ 12 ตัว (เก็บเป็นข้อความ), ตัวเงิน decimal(23,8), query key ที่ไม่รู้จัก/ซ้ำ = 400
- กติกาของ API (Rev 4.6): token อยู่ 24 ชม. พอดี, สิทธิ์รายงาน (appIds) cache 1 ชม., 403 = ไม่มีสิทธิ์รายงาน, เพดาน 20,000 แถว/รายงาน — **เกิน = 503 REPORT_LIMIT_EXCEEDED ไม่ตัดผลเงียบ**, timeout 60 วินาที, login จำกัด 10 ครั้ง/นาที/IP (429), error body `{ error: { code, requestId } }` (เก็บ requestId ไว้แจ้ง STEC), ห้าม trim รหัสผ่าน
- API อ่านอย่างเดียว ไม่มี "ดึงเฉพาะที่เปลี่ยน" → ต้องดึงทั้งชุดต่อสาขา
- ข้อมูลไม่มี Serial Number / ยี่ห้อ-รุ่น / ผู้ถือครอง, `falocation` มีค่าน้อยมาก (36/1,940) → **ใช้เสริมด้านบัญชี ไม่แทนทะเบียนคอมพิวเตอร์ของฝ่าย IT**

## 2. ภาพรวม

```
SyteLine API ──(บัญชีระบบ, https)──> stec-client ──> fixed-asset-sync (ทุกคืน + ปุ่มซิงค์)
                                                        │
                                   fixed_assets / fixed_asset_classdepts / fixed_asset_sync_runs
                                                        │ ผูกด้วยเลขที่ทรัพย์สิน (fanum)
                                                     assets (ระบบเดิม — ไม่เขียนทับอัตโนมัติ)
```

ทางเดียว SyteLine → ระบบเรา, ข้อมูลใน `fixed_assets` เป็นสำเนาของต้นทาง แก้ในระบบเราไม่ได้ (ยกเว้นการผูกกับสินทรัพย์)

## 3. การเชื่อมต่อ (ตามคู่มือบทที่ 10 — บัญชีเดียวฝั่ง server)

- **ความลับอยู่ใน `.env` ของ express เท่านั้น** (ไม่เก็บในฐาน ไม่ส่งถึงเบราว์เซอร์ — แนวเดียวกับ `VAULT_KEY`):
  ```
  STEC_API_BASE_URL=https://...        # https เท่านั้น
  STEC_API_USERNAME=<บัญชีสำหรับระบบ IT>
  STEC_API_PASSWORD=<รหัสผ่าน>
  STEC_API_ALLOWED_HOSTS=10.0.0.5      # กรณีเป็น IP ภายใน (กัน SSRF ตาม upstream-http.ts)
  ```
- **ค่าที่ไม่ใช่ความลับ** = `app_settings.fixed_asset_sync` แก้ที่หน้า ตั้งค่าระบบ → แท็บใหม่ "SyteLine Fixed Assets" (settings.manage, audit `settings.fixed_asset_sync`):
  ```json
  {
    "enabled": false,
    "sites": ["HO","BR","CB","CR","DP","KK","LP","NR","PB","ST","UB"],
    "departments": ["IT"],          // กรอง fadept — [] = ทุกแผนก
    "include_disposed": true,       // fastat A+D (+I)
    "time": "02:00",                // เวลาไทย
    "paths": {                      // ยังไม่รู้ path จริง — ตั้งได้เมื่อ STEC แจ้ง
      "depreciation": "/api/v1/reports/fa-current-depreciation",
      "classdept":    "/api/v1/reports/fa-class-dept-list"
    }
  }
  ```
- **`services/stec-client.ts`** (ใหม่) ใช้ `upstreamFetch` เดิม: เก็บ token ในหน่วยความจำต่อ process, login ใหม่ก่อนหมดอายุ 60 วินาที, รวมการ login พร้อมกันเป็นครั้งเดียว, 401 = login ใหม่แล้วลองซ้ำ 1 ครั้ง, timeout 90 วินาที, ขยาย limit ขนาด response (10,000 แถว ≈ 10MB), ห้าม log รหัสผ่าน/token; ปุ่ม "ทดสอบการเชื่อมต่อ" = `/health` + login + `/auth/permissions` (แสดง appIds)
- ไม่ใช้ตาราง `api_connections` เดิม เพราะออกแบบไว้สำหรับให้ผู้ใช้ login (profile / role mapping) — คนละงาน

## 4. ตาราง (migration ใหม่ — additive, `utf8mb4_0900_as_ci`, มี down.sql)

### `fixed_assets` — 1 แถวต่อ (site, fanum)
| คอลัมน์ | ชนิด | ที่มา / หมายเหตุ |
|---|---|---|
| id | BIGINT PK | |
| site | VARCHAR(10) | `site` |
| fanum | VARCHAR(50) | `fanum` — UNIQUE (site, fanum) + index fanum |
| branch_id | BIGINT NULL FK branches | จับคู่ `site` กับ `branches.code` / `work_group` |
| site_name | VARCHAR(255) | `sitename` |
| description | VARCHAR(500) | `fadesc` |
| fa_class / fa_dept / fa_type / fa_status | VARCHAR | `faclass`, `fadept`, `fatype` (Land/Regular), `fastat` (Active/Disposed/Inactive) |
| fa_location | VARCHAR NULL | `falocation` |
| acquired_on / depr_start_on / disposed_on | DATE NULL | `acqdate`, `deprstartdate`, `disposaldate` |
| acq_cost / accum_depr / nbv / salvage | DECIMAL(18,2) | `acqcost`, `accumdepr`, `nbv`, `salvage` |
| depr_method / depr_rate / useful_life | VARCHAR / DECIMAL / INT | `deprmethod`, `deprrate`, `usefullife` |
| raw | JSON | แถวเต็มทั้ง 37 ฟิลด์ (GL, ค่าจำหน่าย, ค่าเสื่อมงวด/YTD ฯลฯ) — ไม่ต้องเพิ่มคอลัมน์เมื่อต้องใช้ฟิลด์อื่น |
| row_hash | CHAR(64) | SHA-256 ของ raw ที่ตัดค่าเสื่อมรายงวดออก — ใช้ตรวจว่าเปลี่ยนจริง |
| source_recorded_at | DATETIME NULL | `recorddate` |
| as_of | DATE | `period` ที่ใช้ดึง (ตัวเลขค่าเสื่อม ณ วันนี้) |
| asset_id | BIGINT NULL FK assets | การผูก |
| link_source | VARCHAR(10) NULL | auto / manual — manual = การซิงค์ไม่เปลี่ยน |
| missing_since | DATETIME NULL | ไม่พบในการดึงครั้งล่าสุด (ไม่ลบแถว) |
| first_synced_at / synced_at / changed_at | DATETIME | |

### `fixed_asset_classdepts`
site, class_dept, description — UNIQUE (site, class_dept)

### `fixed_asset_sync_runs` — ประวัติการซิงค์ (ห้ามแก้/ลบผ่าน API)
id, trigger (schedule / manual), triggered_by NULL, started_at, finished_at, status (ok / partial / failed), stats JSON `{ HO: { fetched, inserted, updated, unchanged, missing, linked, error? } }`, error TEXT

## 5. ขั้นตอนการซิงค์ (`services/fixed-asset-sync.ts`)

1. `lockNamed("fixed-asset-sync")` กันรันซ้อน (กดปุ่มระหว่างรันตามเวลา = ตอบ 409 "กำลังซิงค์อยู่")
2. ทีละสาขา **ตามลำดับ** (ไม่ยิงพร้อมกัน — 11 สาขา × ~15 วินาที ≈ 3 นาที, ไม่กดดัน SQL Server ของ ERP):
   - เรียก `depreciation` ด้วย `period=วันนี้ (เวลาไทย)`, `fatype=LR`, `fastat=AD` (+I ถ้าต้องการ), `pSite` — รายงานนี้มีทุกฟิลด์ของ `falist` อยู่แล้ว จึงไม่ต้องเรียก falist
   - กรอง `fadept` ตาม `departments`
   - transaction ต่อสาขา: upsert ตาม (site, fanum) → เปลี่ยน `row_hash` = อัปเดต + `changed_at`; ค่าเสื่อม/NBV อัปเดตทุกครั้ง (as_of)
   - แถวของสาขานั้นที่ไม่อยู่ในผล → `missing_since = now` (พบอีก = ล้าง)
   - **ไม่ทำเครื่องหมาย missing ถ้า** สาขานั้นดึงไม่สำเร็จ หรือจำนวนแถว = `REPORT_MAX_ROWS` (ผลอาจถูกตัด) → status partial
   - เรียก `classdept` ของสาขาเดียวกัน (ไม่สำเร็จ = ข้าม ไม่ทำให้ทั้งรอบล้ม)
3. ผูกอัตโนมัติ (ข้อ 6) แล้วบันทึก `fixed_asset_sync_runs` + audit `fixed_assets.synced`
4. ล้มเหลวทั้งรอบ (login ไม่ได้ / 403 / 503) → status failed + แจ้งเตือนในระบบถึงผู้มี `fixed_assets.sync` (ครั้งเดียวต่อวัน)
- **ตั้งเวลา**: ใน `jobs/scheduler.ts` รันวันละครั้งตาม `time` (เฉพาะ instance ที่ `SCHEDULER_ENABLED=true`) + ปุ่ม "ซิงค์ตอนนี้" `POST /fixed-assets/sync` (ทำงานเบื้องหลัง, หน้าเว็บดูสถานะจาก `GET /fixed-assets/sync-runs`)
- (ระยะ 2) ถ้าหน้า `/fixed-assets` ต้องรีเฟรชเองเมื่อซิงค์เสร็จ: เพิ่ม `updated_at` ใน `fixed_assets` ก่อนใส่ใน `SYNC_TABLES` (ลายนิ้วมือใช้ MAX(updated_at))

## 6. การผูกกับสินทรัพย์ของเรา

- อัตโนมัติ: แถวที่ `asset_id` ว่าง (และไม่ใช่ manual) → หาสินทรัพย์ที่ `asset_tag` / `cpu_tag` / `monitor_tag` = `fanum` (กติกาเดียวกับ `assetIdByNumber`, ทำเป็น UPDATE … JOIN ครั้งเดียว ไม่วนทีละแถว)
- ด้วยมือ: ผูก / เปลี่ยน / ยกเลิกการผูก (`PUT /fixed-assets/:id/link { asset_id | null }`, `link_source = manual`, audit `fixed_asset.linked`)
- **ไม่เขียนทับข้อมูลใน `assets` อัตโนมัติ** — ระยะที่ 2 อาจมีปุ่ม "เติมวันที่ซื้อ/มูลค่าจาก SyteLine" เฉพาะช่องที่ยังว่าง
- ต้องตรวจรูปแบบเลขกับข้อมูลจริงก่อน: `fanum` เป็นแบบ `H-OFCO-26004` — ถ้าเลขในระบบเรา (cpu_tag) เขียนต่างรูปแบบ ต้องตกลงกติกาแปลง

## 7. สิทธิ์ (เพิ่มใน `PERMISSIONS`)

| key | ความหมาย | ตั้งต้น |
|---|---|---|
| `fixed_assets.view` | ดูรายการ Fixed Assets + ข้อมูลบัญชี (ราคาทุน / NBV) ในหน้าสินทรัพย์ | admin |
| `fixed_assets.link` | ผูก / ยกเลิกการผูกกับสินทรัพย์ | admin |
| `fixed_assets.sync` | กดซิงค์ / ดูประวัติการซิงค์ / รับแจ้งเตือนซิงค์ล้มเหลว | admin |

ค่าตั้งค่าการเชื่อมต่อ = `settings.manage` (หน้าตั้งค่าระบบ); auditor อ่านได้ตามกติกาเดิม (GET เท่านั้น)

## 8. หน้าเว็บ

- **เมนู สินทรัพย์ IT → "Fixed Assets (SyteLine)"** `/fixed-assets` (`fixed_assets.view`):
  - ตัวกรองแถวเดียว: ค้นหา (fanum / ชื่อ) · สาขา · หมวด · แผนก · สถานะ · การผูก
  - แท็บ: ทั้งหมด / **ยังไม่ผูก** / **จำหน่ายแล้วใน SyteLine แต่ยังใช้งานในระบบเรา** / ไม่พบในต้นทาง — สองแท็บที่ต้องจัดการมีตัวเลขแดงที่แท็บ + ตัวเลขที่เมนู (`GET /menu-badges`, นับเฉพาะผู้มี `fixed_assets.link`) ตามกฎตัวเลขแจ้งเตือน
  - ตารางบนจอใหญ่ / การ์ดบนมือถือ, ส่งออก Excel (`<ConfirmDownload>`), แถบบอก "ซิงค์ล่าสุด … (ข้อมูล ณ วันที่ …)" + ปุ่มซิงค์ตอนนี้
- **หน้ารายละเอียดสินทรัพย์**: การ์ด "ข้อมูลบัญชีจาก SyteLine" (fanum, หมวด/แผนก, วันที่ได้มา, ราคาทุน, ค่าเสื่อมสะสม, NBV, สถานะ, วันจำหน่าย) เฉพาะผู้มี `fixed_assets.view`
- **ตั้งค่าระบบ → แท็บ "SyteLine Fixed Assets"**: สวิตช์เปิดใช้, สาขา, แผนก, เวลา, path ของรายงาน, ปุ่มทดสอบการเชื่อมต่อ, ประวัติการซิงค์ 20 รอบล่าสุด
- ข้อความ th/en ทุกจุด, `loading.tsx`, โหมดมืด, ขนาดตัวอักษรตามการตั้งค่า

## 9. เทสต์ (`express/tests/fixed-asset-sync.test.ts`)

ใช้ upstream จำลอง `setUpstreamTestHooks()` (ห้ามออกเน็ต): login + token หมดอายุ/401 ลองซ้ำ, upsert / ไม่เปลี่ยน / เปลี่ยน, missing และกลับมาพบ, สาขาล้ม = partial ไม่ mark missing, ครบ REPORT_MAX_ROWS = ไม่ mark missing, ผูกอัตโนมัติไม่ทับ manual, กรองแผนก, สิทธิ์ 403, รันซ้อน = 409

## 10. สิ่งที่ต้องขอ / ยืนยันกับฝ่าย IT ของ STEC

1. ~~path จริงของรายงาน + ชื่อ query key~~ — ได้จากคู่มือ Rev 4.6 แล้ว
2. app_id ของแต่ละรายงาน และให้บัญชีระบบของเรามีสิทธิ์
3. บัญชี API เฉพาะสำหรับระบบ IT (ไม่ใช้บัญชีคน)
4. URL ที่ server ของเราเข้าถึงได้ (API bind 127.0.0.1 ตั้งต้น — ต้องเปิดผ่าน HTTPS ภายใน) + ใบรับรอง
5. ช่วงเวลาที่ดึงได้โดยไม่กระทบ ERP (เสนอ 02:00) และจำนวนครั้งที่ยอมรับได้
6. ~~คู่มือฉบับที่มี Fixed Assets~~ — Rev 4.6 (12 พ.ย. 2026)

## 11. คำถามที่ต้องตัดสินใจฝั่งเรา

- ขอบเขตข้อมูล: **แนะนำ** ดึงเฉพาะ `fadept = IT` (ข้อมูลการเงินของแผนกอื่นไม่ควรมาอยู่ในระบบ IT) — หรือดึงทุกแผนกเพื่อใช้กับทะเบียนคอมพิวเตอร์ที่ถือโดยแผนกอื่น?
- รวมสถานะ Inactive ด้วยหรือไม่
- ผู้ที่เห็นราคาทุน / NBV — เฉพาะ admin หรือรวมผู้จัดการฝ่าย

## 12. ลำดับการทำ

1. **ระยะ 1** (ทำได้ก่อนรู้ path — ใช้ upstream จำลอง): migration + stec-client + sync service + เทสต์ + แท็บตั้งค่า
2. **ระยะ 2** (เมื่อได้ path/บัญชี): ทดสอบกับต้นทางจริง, หน้า `/fixed-assets`, การ์ดในหน้าสินทรัพย์, ตัวเลขเมนู, ผูกด้วยมือ
3. **ระยะ 3** (เลือกทำ): เติมวันที่ซื้อ/มูลค่าเข้าสินทรัพย์, รายงานเทียบ "จำหน่ายแล้วแต่ยังใช้งาน", ผูกซอฟต์แวร์ (หมวด INTA) กับเมนูซอฟต์แวร์ License
