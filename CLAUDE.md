# IT-SYSTEM — กฎการพัฒนา (Claude Code)

ระบบงานฝ่าย IT (ใบแจ้งงาน IT, คลังบัญชี/รหัสผ่าน, สัญญา vendor, สินทรัพย์ IT):
**Next.js 16 (App Router) + Express.js 5 API + MySQL 8.4** — รันบน Docker (`docker compose up -d`)
- Container: `it_express` (8020, API + scheduler), `it_mysql` (3308, db `it_system`, user `it_app`), `it_adminer` (8081)
- ฐานเดิมเก็บเป็นสำรอง ไม่ใช้งานแล้ว: PostgreSQL (profile `legacy-postgres`, volume `it-system_it_pg` — ย้ายมา MySQL 2026-10-05), MariaDB (profile `legacy-mariadb`, volume `it-system_it_db`)
- ชื่อภายในเดิมที่ตั้งใจคงไว้: cookie `eam_*`, prefix ข้อความ `eam.*`, `EAM_TOKEN_TTL_MINUTES`
- **ตั้งแต่ 2026-10-04 ใช้ Express อย่างเดียว** — ถอด Laravel (`backend/`, `it_api`) ออกแล้ว (ดูโค้ดเดิมจาก git history) ห้ามสร้างกลับมา
- ไฟล์แนบ/ลายเซ็น/ไฟล์ license อยู่ที่ `storage/private` (mount เป็น `/data/private` ใน container, ไม่ขึ้น git — ต้องสำรองแยก)
- ผู้ใช้ 2 แบบ (`users.type`): `LOCAL` (ผู้ใช้เดิมทั้งหมด, login อีเมล+รหัสผ่าน) / `API` (ผู้ใช้จาก REST API ต้นทาง — ไม่เก็บรหัสผ่าน, `connection_id`+`external_id`) — CHECK ใน DB บังคับ; rollback ด้วยมือ: `prisma/migrations/20261004120000_add_api_users_and_permissions/down.sql`

## ทั่วไป
- ตอบผู้ใช้เป็นภาษาไทย; โค้ด/ชื่อตัวแปรเป็นภาษาอังกฤษ
- แก้เฉพาะขอบเขตที่ขอ + ไฟล์ที่เกี่ยวข้องโดยตรง; ปัญหานอกขอบเขตให้รายงาน ไม่แก้เอง
- ไฟล์ที่มีภาษาไทย ห้ามใช้ PowerShell `Get-Content`/`Set-Content` แก้ไข — ใช้ Read/Edit/Write
- หลังแก้ ต้องผ่าน: `npm test` + `npx tsc --noEmit` (ใน `express/`), `npm run lint`, `npx tsc --noEmit`, `npm run build` (ใน `frontend/`)

## การถามผู้ใช้ (ลดการรอคำตอบ)
- เรื่องที่มีทางเลือก "แนะนำ" ชัดเจนและย้อนกลับได้ (ชื่อ, รูปแบบ UI, ค่าเริ่มต้น, โครงสร้างโค้ด) → **เลือกตัวที่แนะนำแล้วทำต่อทันที ไม่ต้องถาม** แล้วแจ้งในสรุปว่าเลือกอะไร
- ถามและรอคำตอบเฉพาะเรื่องที่ย้อนกลับยากหรือกระทบภายนอก: ลบข้อมูลจริง, push/deploy, เปลี่ยน secret/สิทธิ์, ค่าใช้จ่าย, ความกำกวมที่ทำให้งานผิดทั้งหมด
- (Claude หยุดรอเมื่อถามคำถาม — ไม่มีการนับเวลาแล้วเลือกเอง จึงต้องเลี่ยงการถามตั้งแต่แรกตามกฎข้อบน)

## งานค้าง / ทำงานต่ออัตโนมัติ
- คิวงานค้างอยู่ที่ `.claude/pending-work.md` — งานตั้งเวลา `it-system-resume-pending-work` (ทุก 1 ชม. ขณะเปิดแอป Claude) ทำต่อทีละรายการ
- ถ้างานยังไม่เสร็จแล้วต้องหยุด (เช่น ใกล้ชน limit โควตา, รอผู้ใช้ตอบ) ให้เขียนสิ่งที่เหลือเป็น `- [ ]` ในคิวก่อนจบ
  พร้อมรายละเอียดครบในตัว (ไฟล์ที่เกี่ยวข้อง, ทำถึงไหนแล้ว, เกณฑ์ว่าเสร็จ) — รอบตั้งเวลาไม่เห็นบทสนทนาเดิม
- รอบที่รันจากการตั้งเวลา: ไม่มี `- [ ]` → จบทันที; ห้าม commit/push/deploy/ลบข้อมูลจริง; สิ่งที่ต้องให้ผู้ใช้ตัดสินใจ → ทำเครื่องหมาย `- [!]` แล้วข้าม

## สิทธิ์ (permission) — ตรวจที่ API
- รายการสิทธิ์อยู่ที่ `express/src/models/permission.ts` (`PERMISSIONS`: key, กลุ่ม, ชื่อ th/en, `defaults` = กลุ่มที่ได้ตอนสร้าง key)
  กลุ่ม = role (`admin`/`manager`/`viewer`) + `it_staff`/`it_head` ตาม flag — สิทธิ์จริง = สิทธิ์ของกลุ่ม (`role_permissions`) + allow − deny รายคน (`user_permissions`)
- ตรวจสิทธิ์ด้วย `can(user, "key")` (Express — middleware auth โหลด `user.perms` ทุก request) / `has(user, "key")` (frontend จาก `/auth/me.permissions`) **ห้ามเช็ค role/flag ตรงๆ เพื่อให้สิทธิ์**
- Local Admin (`role=admin` + `type=LOCAL`) ผ่านทุกสิทธิ์; การตั้งค่าการเชื่อมต่อ API / สิทธิ์ของผู้ใช้ / หน้าการมองเห็นเมนู = Local Admin เท่านั้น (`isLocalAdmin`)
- เพิ่มสิทธิ์ใหม่: เพิ่มใน `PERMISSIONS` พร้อม `defaults` — `ensurePermissions()` (ตอน start server / seed / เทสต์) สร้าง key ใหม่ + สิทธิ์ตั้งต้น **ไม่แตะ key เดิมและการกำหนดสิทธิ์ที่ admin ปรับไว้**
- การเลือกผู้รับแจ้งเตือน (SQL ตาม role/flag ใน ticket-workflow, notify-expiring) ไม่ใช่การตรวจสิทธิ์ — คงไว้ตามเดิม

## API User (login ผ่าน REST API ต้นทาง)
- โค้ดกลาง: `express/src/services/api-auth.ts` (login / JIT / session), `upstream-http.ts` (เรียกต้นทาง: https เท่านั้น, กัน SSRF + allowlist, จำกัด redirect/ขนาด), `audit.ts`
- ห้ามเก็บ/ log รหัสผ่านหรือ token ของต้นทาง — token เก็บเข้ารหัสใน `external_sessions` ผูกกับ token ของเรา; อ่านค่าจาก response ด้วย `readPath` (dot path) เท่านั้น
- JIT ครั้งถัดไปอัปเดตเฉพาะชื่อ/อีเมล — ห้ามทับ role / สิทธิ์ / สถานะ / ลายเซ็น; อีเมลซ้ำ → เว้นว่าง + audit `api_user.email_conflict` (admin ผูกบัญชีเองที่ `/api-users`)
- เทสต์ใช้ upstream จำลอง `setUpstreamTestHooks()` — ห้ามออกเน็ตจริงในเทสต์
- ทุกการเปลี่ยนสิทธิ์/การตั้งค่า/การผูกบัญชีต้องลง `audit_logs` (ใช้ `audit()` — ตัด key ที่เป็น secret ให้อัตโนมัติ)

## ลายเซ็น (user_signatures)
- โค้ดกลาง `express/src/services/signatures.ts`: ตรวจชนิดจากเนื้อไฟล์ → sharp (crop ขอบ, กว้าง ≤ 600px, PNG ใหม่ไม่มี metadata) → เก็บเข้ารหัส (`lib/file-crypt.ts`) ที่ `signatures/{user}/{uuid}.png.enc`
- ลายเซ็นใหม่ = อันเดิม `is_active=false` (ห้ามลบแถว/ไฟล์); ไฟล์ต้นฉบับส่งให้เจ้าของเท่านั้น — ใบแจ้งงานเก็บสำเนาของตัวเอง (`copySignatureTo` + audit `signature.used`)
- ใช้ลายเซ็นคนอื่นต้องมีสิทธิ์ `signature.use`; ทุกการอัปโหลด/เปลี่ยน/ลบ/นำไปใช้ลง `audit_logs`; JIT ของ API User ห้ามแตะลายเซ็น
- `users.signature_path` เป็นคอลัมน์เดิม (ไม่ใช้แล้ว — คงไว้ตามกฎ additive)

## สิทธิ์การมองเห็นเมนู/ปุ่ม (หน้า ตั้งค่าระบบ → สิทธิ์การใช้งาน)
- ตั้งค่าเก็บใน `app_settings`: `ui_permissions` (key → กลุ่มที่ซ่อน) และ `menu_order` — โค้ดกลางอยู่ที่ `frontend/src/lib/permissions.ts`
- key เมนู = `href` ของเมนูใน `components/shell/nav.ts`, key ปุ่ม = `btn:<หน้า>:<ปุ่ม>` (**ห้ามมีจุด** — validator ของ API ใช้จุดแยก path)
- เพิ่มเมนูใหม่: ใส่ใน `NAV` แล้วจะขึ้นในหน้าสิทธิ์อัตโนมัติ; เพิ่มปุ่มใหม่: เพิ่มใน `BUTTONS` แล้วครอบปุ่มด้วย `(await getAccess())("btn:...")`
- เป็นการซ่อนเพิ่มจากสิทธิ์เดิมเท่านั้น — สิทธิ์จริงต้องตรวจที่ API เสมอ

## สายอนุมัติใบแจ้งงาน (หน้า ตั้งค่าระบบ → สายอนุมัติ)
- โค้ดกลาง: `express/src/services/approval-routes.ts` (ลำดับจับคู่: รายบุคคล → สาขา+แผนก → สาขา → แผนก → ตั้งต้น → ระบบเดิม `supervisor_id`)
- ตอนแจ้งงานคัดลอกสายเป็น snapshot ใน `it_ticket_approval_steps` — แก้/ลบสายไม่กระทบใบเดิม; สถานะยังเป็น `pending_supervisor` ทุกขั้น + `it_tickets.current_step`
- โหลด TicketRow ใน Express ต้องมี `TICKET_APPROVAL_COLUMNS` (ใช้ใน `canApprove`/`canView`) — ใบที่ไม่มี snapshot ใช้กติกาเดิม (`approver_id`)

## วันที่ / หมวดสินทรัพย์
- วันที่แสดงและกรอกเป็น **dd/MM/yyyy** (ไทย = พ.ศ., อังกฤษ = ค.ศ.) — แสดงผลใช้ `fmt.date/dateTime`, ช่องกรอกใช้ `<DateInput>` (`components/date-input.tsx` — พิมพ์ได้ + ปฏิทินป๊อปอัปในตัว) **ห้ามใช้ `<input type="date">` หรือสร้าง date picker เอง**; API ยังรับส่ง `YYYY-MM-DD`
- Dropdown ทุกที่ใช้ `<AppSelect>` (`components/app-select.tsx` — รายการลอย ตัวที่เลือกพื้นจาง + เครื่องหมายถูก, คีย์บอร์ด, ค้นหาเมื่อรายการ > 8) **ห้ามใช้ `<select>` ตรงๆ หรือสร้าง dropdown เอง**; ใส่ `<option>` เป็น children หรือส่ง `options` ได้, `onChange` รับ handler เดิมของ `<select>` ได้, ฟอร์ม GET ใช้ `name` + `defaultValue` (ส่งค่าผ่าน hidden input); กล่องลอยใหม่ใช้ `useFloating`/`useDismiss` จาก `components/floating.ts`
- ใบแจ้งงาน: ฝ่าย IT (และเจ้าหน้าที่ที่ผู้แจ้งเลือก) เห็น/ได้แจ้งเตือนหลังหัวหน้าอนุมัติแล้วเท่านั้น (`PRE_APPROVAL` ใน `express/src/services/ticket-workflow.ts`)
- การติดตั้ง license (`license_installations`): นับ seat จากรายการที่ `uninstalled_at` เป็น null — บันทึกเกิน `asset_licenses.seats` ไม่ได้ และลด seats ต่ำกว่าที่ใช้อยู่ไม่ได้
- หมวดสินทรัพย์กำหนดฟอร์มเพิ่มเติมที่ `CATEGORY_FORM` (`frontend/src/lib/types.ts`) — `SOFTWARE` = ข้อมูล license (`asset_licenses`, key เข้ารหัส APP_KEY) + ไฟล์ (`asset_files`) และรวมในการแจ้งเตือนหมดอายุ

## API (Express)
- endpoint อยู่ใต้ `/api/v1` (`express/src/routes`), ข้อความ th/en ที่ `express/src/lib/i18n.ts` ตาม `Accept-Language`
- ข้อมูล audit (เช่น `asset_movements`, `audit_logs`) ห้ามแก้/ลบผ่าน API; ลบข้อมูลหลักใช้ soft delete หรือบังคับปิดใช้งานแทนถ้ามีประวัติ
- **โครงสร้างฐานข้อมูลเป็นของ Prisma migrations** (`express/prisma/`) — เพิ่ม/แก้ตาราง: แก้ `schema.prisma` → `npm run db:migrate -- --name <ชื่อ>` (ใน `express/`)
  - เพิ่มแบบ additive เท่านั้น (ไม่ลบ/เปลี่ยนชื่อ/เปลี่ยนชนิดคอลัมน์เดิม) และใส่ `down.sql` สำหรับย้อนกลับ — ทดสอบกับสำเนาฐานจริงก่อน
  - ห้ามแก้ไฟล์ migration ที่ deploy แล้ว — สร้าง migration ใหม่เสมอ; ข้อมูลตั้งต้นอยู่ที่ `express/src/cli/seed.ts`
  - Prisma ใช้จัดการ schema เท่านั้น — API เรียกฐานข้อมูลผ่าน mysql2 (`src/db.ts`) เพิ่มคอลัมน์แล้วต้องแก้ query/resource ที่เกี่ยวข้องด้วย
  - migration ที่ Prisma สร้างใส่ `COLLATE utf8mb4_unicode_ci` — **ต้องแก้เป็น `utf8mb4_0900_as_ci`** ก่อน deploy (unicode_ci/ai_ci ถือว่า "ขาย" = "ข่าย")
  - MySQL ห้าม CHECK บนคอลัมน์ที่ FK มี referential action (Prisma ตั้ง `ON UPDATE CASCADE` เป็นค่าตั้งต้น — ใส่ `onUpdate: Restrict`)
- SQL ใน Express เป็น MySQL 8.4: placeholder `?` (db.ts escape ให้ — array = รายการสำหรับ `IN (?)`, object = JSON),
  session ใช้ `ANSI_QUOTES` → ชื่อคอลัมน์ใช้ `"..."` และ**ต้องครอบคำสงวน** เช่น `"key"`, `"group"`, `"before"`, `"after"` (หลัง `alias.` ไม่ต้อง), ข้อความใช้ `'...'` เท่านั้น,
  ค้นหาข้อความใช้ `LIKE` + `likeEscape()` (collation ไม่สนตัวพิมพ์อยู่แล้ว), JSON ใช้ `JSON_EXTRACT`/`->>'$.x'`/`JSON_CONTAINS`/`JSON_TABLE`,
  upsert ใช้ `INSERT ... AS new ON DUPLICATE KEY UPDATE col = new.col`, ค่าว่างเทียบกันใช้ `<=>`, lock ตามชื่อใน transaction ใช้ `lockNamed()`,
  นิพจน์ boolean ใน SELECT (เช่น `EXISTS(...)`, `x IS NULL`) คืน 1/0 ไม่ใช่ true/false (คอลัมน์ BOOLEAN คืน true/false), ตรวจรูปแบบ uuid ด้วย `isUuid()` ก่อน query คอลัมน์ uuid
- ค่า env อยู่ใน `express/.env`
- ห้ามเปลี่ยนรูปแบบ token (Sanctum), bcrypt `$2y$`, การเข้ารหัส `APP_KEY` และ path ไฟล์ที่เก็บใน DB — ข้อมูลเดิมใช้รูปแบบนี้อยู่
- เทสต์ Express ใช้ฐาน `it_system_test` เท่านั้น (บังคับใน `vitest.config.ts` + `tests/setup.ts`) — ห้ามชี้เทสต์ไปที่ `it_system`
- งานแต่ละประเภทมี agent เฉพาะทางใน `.claude/agents/` — ใช้เมื่องานใหญ่หรือต้องการความเชี่ยวชาญเฉพาะ

## UI / Frontend (บังคับ)
- **ทุกอย่างที่กดด้วยเมาส์ได้ ต้องมี `cursor-pointer`** — ปุ่ม, ลิงก์, แท็บ, swatch, ตัวเลือก dropdown, label ของ checkbox/radio, แถวที่คลิกได้
  - ใช้ `btn.*` จาก `components/ui.ts` (มี `cursor-pointer` อยู่แล้ว) หรือใส่ class `cursor-pointer` เอง
  - สถานะ disabled ใช้ `disabled:cursor-not-allowed`
  - `globals.css` มีกฎ base เป็นตาข่ายรองรับ แต่ **ต้องใส่ class ในคอมโพเนนต์ด้วยเสมอ**
- Tooltip ใช้ `<Tooltip>` จาก `components/tooltip.tsx` เท่านั้น — **ห้ามใช้ attribute `title`** (สไตล์ไม่สวยและไม่ตรงธีม)
- สีใช้ token เท่านั้น ห้าม hard-code ชื่อสี Tailwind ในหน้าเว็บ:
  - สีธีม: `accent-*` · สีพื้น/ตัวอักษร: `canvas / surface / subtle / line / ink / muted / faint`
  - สีสถานะ: `success / info / warning / danger / idle` (เปลี่ยนตามธีมอัตโนมัติ ไม่ให้ซ้ำกับสีธีม)
  - ยกเว้น: error ใต้ช่องกรอกใช้ `inputError` + `text-red-500` (มาตรฐานฟอร์ม)
- รองรับโหมดมืดทุกหน้า (`dark:` variant) และ responsive (ตารางบนจอใหญ่ / การ์ดบนมือถือ)
- ข้อความทุกจุดผ่าน i18n: `src/i18n/th.ts` (ต้นแบบ) + `en.ts` — ห้าม hard-code ข้อความในคอมโพเนนต์
- ทุกหน้าที่โหลดข้อมูลต้องมี `loading.tsx` หรือ `<Suspense>` + skeleton; ปุ่มที่ส่งข้อมูลต้องแสดง spinner
- ฟอร์ม: error ใต้ช่องสีแดง + ล้าง error ของช่องทันทีเมื่อผู้ใช้แก้
- เรียก API ผ่าน `apiFetch` (server-side) เท่านั้น — token อยู่ใน httpOnly cookie ห้ามส่งไป browser
- Next.js 16 มี breaking changes — อ่าน `frontend/node_modules/next/dist/docs/` ก่อนใช้ API ที่ไม่แน่ใจ (เช่น `proxy.ts` แทน middleware)
